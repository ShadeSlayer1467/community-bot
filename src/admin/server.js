import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { builtinNames } from '../settings.js';
import QRCode from 'qrcode';
import { NotificationError } from '../notifications/model.js';
import { snowflake } from '../config.js';
const hash = (v) => createHash('sha256').update(String(v)).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
async function jsonBody(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('Expected application/json.');
  let content = '';
  for await (const chunk of req) {
    content += chunk;
    if (Buffer.byteLength(content) > 64000) throw new Error('Request too large.');
  }
  try {
    return JSON.parse(content || '{}');
  } catch {
    throw new Error('Invalid JSON request.');
  }
}
export function createAdmin({ config, settings, host, logger, runner, security, notifications }) {
  const sessions = new Map();
  let failed = 0;
  let retryAt = 0;
  const publicDir = path.join(import.meta.dirname, 'public');
  return http.createServer(async (req, res) => {
    const authority = `127.0.0.1:${config.port}`;
    const origin = `http://${authority}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    try {
      if (
        !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) ||
        req.headers.host !== authority ||
        (req.headers.origin && req.headers.origin !== origin) ||
        req.headers['sec-fetch-site'] === 'cross-site'
      )
        return send(403, { error: 'Local same-origin requests only.' });
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed.' });
      const url = new URL(req.url, origin);
      // Dedicated content-only endpoint: never creates an admin or developer session.
      if (url.pathname === '/api/notifications' && req.method === 'POST') {
        if (!notifications)
          return send(503, { error: 'Notification service unavailable.', code: 'unavailable' });
        if (!notifications.credential.accepts(req.headers.authorization)) {
          notifications.record('rejected', 'authentication', 'unauthorized');
          return send(401, { error: 'Invalid notification credential.', code: 'unauthorized' });
        }
        try {
          let payload;
          try {
            payload = await jsonBody(req);
          } catch {
            throw new NotificationError(
              'invalid_payload',
              'Expected a JSON object no larger than 64000 bytes.',
            );
          }
          return send(200, await notifications.submit(payload));
        } catch (e) {
          const error = notifications.safeError(e);
          if (error.code === 'invalid_payload')
            notifications.record('rejected', 'payload', error.code);
          if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
          return send(error.status, {
            error: error.message,
            code: error.code,
            ...(error.retryAfter ? { retryAfterSeconds: error.retryAfter } : {}),
          });
        }
      }
      if (
        req.method === 'GET' &&
        ['/', '/app.js', '/backdrop.js', '/style.css'].includes(url.pathname)
      ) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        res.writeHead(200, {
          'Content-Type': file.endsWith('.js')
            ? 'text/javascript'
            : file.endsWith('.css')
              ? 'text/css'
              : 'text/html',
        });
        return res.end(fs.readFileSync(path.join(publicDir, file)));
      }
      if (url.pathname === '/api/login' && req.method === 'POST') {
        if (Date.now() < retryAt)
          return send(429, { error: 'Too many login attempts. Wait one minute.' });
        const { password } = await jsonBody(req);
        if (!config.adminPassword || !equal(password, config.adminPassword)) {
          if (++failed >= 5) {
            retryAt = Date.now() + 60000;
            failed = 0;
          }
          return send(401, { error: 'Incorrect admin password.' });
        }
        failed = 0;
        const id = randomBytes(32).toString('hex');
        const csrf = randomBytes(32).toString('hex');
        for (const [key, value] of sessions) if (value.until < Date.now()) sessions.delete(key);
        if (sessions.size >= 10) sessions.delete(sessions.keys().next().value);
        sessions.set(id, { csrf, until: Date.now() + 8 * 60 * 60 * 1000 });
        res.setHeader(
          'Set-Cookie',
          `session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return send(200, { csrf });
      }
      const id = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
      const session = sessions.get(id);
      if (!session || session.until < Date.now())
        return send(401, { error: 'Sign in to the local admin panel.' });
      if (req.method === 'POST' && !equal(req.headers['x-csrf-token'] ?? '', session.csrf))
        return send(403, { error: 'Invalid request token. Sign in again.' });
      if (req.method === 'GET' && url.pathname === '/api/state')
        return send(200, {
          status: host.status(),
          settings: settings.read(),
          builtinNames,
          logs: logger.recent,
          security: security?.status() ?? { enrolled: false, ownerId: null, elevatedUntil: null },
          notifications: notifications?.status() ?? null,
        });
      if (req.method === 'POST') {
        const body = await jsonBody(req);
        switch (url.pathname) {
          case '/api/notifications/category': {
            if (!notifications?.delivery.agents || !host.client.isReady())
              throw new Error('Connect the bot first.');
            if (!snowflake(body.guildId)) throw new Error('Enter a valid notification Guild ID.');
            const guild = await host.client.guilds.fetch(body.guildId);
            const categoryId = await notifications.delivery.agents.createCategory(
              guild,
              config.ownerIds,
              host.client.user.id,
            );
            logger.log('info', 'Agent notification category created', {
              guildId: guild.id,
              categoryId,
            });
            return send(200, { categoryId });
          }
          case '/api/notifications/settings':
            if (!notifications) throw new Error('Notification service unavailable.');
            return send(200, notifications.save(body));
          case '/api/notifications/credential':
            if (!notifications) throw new Error('Notification service unavailable.');
            logger.log('info', 'Notification API credential rotated');
            return send(200, { token: notifications.credential.rotate() });
          case '/api/notifications/validate':
            if (!notifications) throw new Error('Notification service unavailable.');
            return send(200, await notifications.validateDestination());
          case '/api/notifications/test':
            if (!notifications) throw new Error('Notification service unavailable.');
            return send(200, await notifications.test(body.source));
          case '/api/totp/start': {
            if (!security) throw new Error('Developer authentication is not configured.');
            if (Date.now() < retryAt)
              return send(429, { error: 'Wait one minute before retrying the password.' });
            if (!equal(body.password, config.adminPassword)) {
              if (++failed >= 5) {
                retryAt = Date.now() + 60000;
                failed = 0;
              }
              return send(401, {
                error: 'Re-enter your local admin password to enroll or replace the authenticator.',
              });
            }
            failed = 0;
            const enrollment = security.beginEnrollment(id);
            return send(200, {
              ...enrollment,
              qr: await QRCode.toDataURL(enrollment.uri, { width: 256, margin: 2 }),
            });
          }
          case '/api/totp/confirm': {
            if (!security) throw new Error('Developer authentication is not configured.');
            const status = await security.confirmEnrollment(id, body.code);
            logger.log('info', 'Authenticator enrollment confirmed locally');
            return send(200, status);
          }
          case '/api/totp/revoke':
            security?.revoke();
            return send(200, { message: 'Developer session revoked.' });
          case '/api/settings': {
            const saved = settings.save(body);
            logger.log('info', 'Settings saved from local panel');
            return send(200, saved);
          }
          case '/api/connect':
            await host.connect();
            return send(200, host.status());
          case '/api/disconnect':
            await host.disconnect();
            return send(200, host.status());
          case '/api/sync':
            return send(200, await host.sync());
          case '/api/registered':
            return send(200, await host.refreshRegistered());
          case '/api/registered/remove':
            return send(200, await host.removeRegistered(body));
          case '/api/cancel':
            runner.cancel?.();
            return send(200, { message: 'Cancellation requested.' });
          case '/api/logout':
            security?.cancelEnrollment(id);
            sessions.delete(id);
            res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
            return send(200, {});
        }
      }
      return send(404, { error: 'Not found.' });
    } catch (error) {
      logger.log('error', 'Admin request failed', { message: error.message });
      if (!res.headersSent) send(400, { error: logger.redact(error.message) });
      else res.end();
    }
  });
}
