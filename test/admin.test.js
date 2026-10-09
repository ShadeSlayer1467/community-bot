import { adminModules } from '../src/admin/public/registry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createAdmin } from '../src/admin/server.js';
import { defaults, validateSettings } from '../src/settings.js';
import { securityFixture } from './helpers.js';
import { generate } from 'otplib';
test('local panel requires authentication, enforces origin/CSRF and saves settings', async (t) => {
  const { security, clock } = await securityFixture();
  const config = { port: 0, adminPassword: 'offline-test-password' };
  let saved = structuredClone(defaults);
  const server = createAdmin({
    config,
    settings: {
      read: () => saved,
      save: (s) => {
        saved = validateSettings(s);
        return saved;
      },
    },
    host: { status: () => ({ state: 'offline' }) },
    logger: { recent: [], log() {}, redact: (x) => x },
    runner: {},
    security,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${config.port}`;
  assert.equal((await fetch(url + '/api/state')).status, 401);
  for (const module of adminModules.filter(m => m.route !== '/')) {
    const response = await fetch(url + module.route, { redirect: 'manual' });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/?next=' + encodeURIComponent(module.route));
  }
  assert.equal(
    (
      await fetch(url + '/api/totp/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(url + '/api/state', { headers: { Origin: 'https://untrusted.example' } })).status,
    403,
  );
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http
      .get(url + '/api/state', { headers: { Host: 'untrusted.example' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  const login = await fetch(url + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: config.adminPassword }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await login.json();
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  assert.equal((await fetch(url + '/api/state', { headers })).status, 200);
  for (const module of adminModules) {
    const page = await fetch(url + module.route, { headers });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Primary navigation/);
    assert.equal((await fetch(url + '/modules/' + module.id + '.js', { headers })).status, 200);
  }
  assert.equal((await (await fetch(url + '/api/session', { headers })).json()).csrf, csrf);
  assert.equal((await fetch(url + '/unknown', { headers })).status, 404);
  assert.equal(
    (
      await fetch(url + '/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(defaults),
      })
    ).status,
    403,
  );
  headers['X-CSRF-Token'] = csrf;
  const start = await fetch(url + '/api/totp/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ password: config.adminPassword }),
  });
  assert.equal(start.status, 200);
  const provisioning = await start.json();
  assert.ok(provisioning.qr.startsWith('data:image/png;base64,'));
  const secret = new URL(provisioning.uri).searchParams.get('secret');
  assert.ok(!(await (await fetch(url + '/api/state', { headers })).text()).includes(secret));
  const code = await generate({ secret, epoch: Math.floor(clock.value / 1000) });
  assert.equal(
    (
      await fetch(url + '/api/totp/confirm', {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + '/api/totp/confirm', {
        method: 'POST',
        headers,
        body: JSON.stringify({ code }),
      })
    ).status,
    200,
  );
  assert.equal(security.status().elevatedUntil, null);
  assert.equal(
    (
      await fetch(url + '/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...defaults, disabled: ['ban'] }),
      })
    ).status,
    200,
  );
  assert.deepEqual(saved.disabled, ['ban']);
  assert.equal(
    (
      await fetch(url + '/api/settings', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...defaults, customTimeoutSeconds: 10000 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (await fetch(url + '/api/logout', { method: 'POST', headers, body: '{}' })).status,
    200,
  );
  assert.equal((await fetch(url + '/api/state', { headers })).status, 401);
  const html = await fetch(url);
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
