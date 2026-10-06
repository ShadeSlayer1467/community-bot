import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import http from 'node:http';
import { Store } from '../src/persistence.js';
import { NotificationCredential } from '../src/notifications/credential.js';
import { notificationDefaults, validateNotificationSettings } from '../src/notifications/model.js';
import { NotificationDelivery } from '../src/notifications/delivery.js';
import { NotificationService } from '../src/notifications/service.js';
import { createAdmin } from '../src/admin/server.js';
import { createLogger } from '../src/logging.js';
import { defaults } from '../src/settings.js';

const guildId = '100000000000000001',
  channelId = '100000000000000002',
  userId = '100000000000000003';
const payload = {
  source: 'Example App',
  title: 'Needs attention',
  message: 'Please inspect the workflow.',
  severity: 'attention',
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(
    path.join(dir, 'settings.json'),
    { ...notificationDefaults({ ownerIds: [userId] }), enabled: true, guildId, channelId },
    validateNotificationSettings,
  );
  const credentialStore = new Store(path.join(dir, 'credential.json'), {});
  const credential = new NotificationCredential(credentialStore);
  const token = credential.rotate();
  const sent = [],
    logs = [];
  const logger = { redact: (s) => String(s), log: (...args) => logs.push(args), recent: [] };
  const channel = {
    id: channelId,
    guildId,
    name: 'notifications',
    type: 0,
    permissionsFor: () => ({ has: () => true }),
    send: async (p) => {
      sent.push({ destination: 'guild', p });
    },
  };
  const guild = {
    id: guildId,
    name: 'Test Server',
    channels: { fetch: async () => channel },
    members: { fetchMe: async () => ({}) },
  };
  const user = {
    id: userId,
    tag: 'Test User',
    createDM: async () => ({ id: 'dm-channel' }),
    send: async (p) => {
      sent.push({ destination: 'dm', p });
    },
  };
  const client = {
    isReady: () => true,
    guilds: { fetch: async () => guild },
    users: { fetch: async () => user },
    rest: {
      post: async (route, { body }) =>
        route.includes('dm-channel') ? user.send(body) : channel.send(body),
    },
  };
  const host = { client, status: () => ({ state: 'online' }) };
  const clock = { value: Date.now() };
  const service = new NotificationService({
    settings: store,
    credential,
    delivery: new NotificationDelivery(host),
    logger,
    now: () => clock.value,
  });
  t.after(() => service.close());
  return {
    service,
    store,
    credential,
    credentialStore,
    token,
    sent,
    logs,
    logger,
    client,
    guild,
    channel,
    user,
    host,
    clock,
    dir,
  };
}

test('configured guild channel delivery uses embeds, no mentions, and owner-derived DM defaults', async (t) => {
  const f = fixture(t);
  let selectedGuild, selectedChannel;
  f.client.guilds.fetch = async (id) => {
    selectedGuild = id;
    return f.guild;
  };
  f.guild.channels.fetch = async (id) => {
    selectedChannel = id;
    return f.channel;
  };
  assert.equal(f.store.read().userId, userId);
  assert.equal(
    (await f.service.submit({ ...payload, message: '@everyone @here <@123> <@&123>' })).status,
    'delivered',
  );
  assert.equal(selectedGuild, guildId);
  assert.equal(selectedChannel, channelId);
  assert.deepEqual(f.sent[0].p.allowed_mentions, {
    parse: [],
    users: [],
    roles: [],
    replied_user: false,
  });
  assert.equal(f.sent[0].p.embeds[0].author.name, payload.source);
  assert.equal(f.sent[0].p.embeds[0].footer.text, 'ATTENTION');
});

test('switching saved destination changes future sends including test notifications', async (t) => {
  const f = fixture(t);
  await f.service.test();
  f.service.save({ ...f.store.read(), mode: 'dm' });
  let recipient;
  f.client.users.fetch = async (id) => {
    recipient = id;
    return f.user;
  };
  await f.service.test();
  assert.equal(recipient, userId);
  f.service.save({ ...f.store.read(), mode: 'guild', channelId: '100000000000000004' });
  await f.service.test();
  assert.deepEqual(
    f.sent.map((x) => x.destination),
    ['guild', 'dm', 'guild'],
  );
  assert.match((await f.service.validateDestination()).label, /Test Server/);
});

for (const [name, mutate, code] of [
  [
    'disconnected Discord',
    (f) => {
      f.client.isReady = () => false;
    },
    'disconnected',
  ],
  [
    'invalid guild',
    (f) => {
      f.client.guilds.fetch = async () => {
        throw Error('private transport body');
      };
    },
    'invalid_guild',
  ],
  [
    'missing channel',
    (f) => {
      f.guild.channels.fetch = async () => null;
    },
    'invalid_channel',
  ],
  [
    'channel in wrong guild',
    (f) => {
      f.channel.guildId = '100000000000000099';
    },
    'invalid_channel',
  ],
  [
    'missing send/view/embed permission',
    (f) => {
      f.channel.permissionsFor = () => ({ has: () => false });
    },
    'missing_permissions',
  ],
  [
    'invalid DM user',
    (f) => {
      f.service.save({ ...f.store.read(), mode: 'dm' });
      f.client.users.fetch = async () => {
        throw Error('invalid');
      };
    },
    'invalid_recipient',
  ],
  [
    'blocked DMs',
    (f) => {
      f.service.save({ ...f.store.read(), mode: 'dm' });
      f.user.send = async () => {
        throw Error('blocked');
      };
    },
    'dm_delivery_failed',
  ],
  [
    'Discord send failure',
    (f) => {
      f.channel.send = async () => {
        throw Error('sensitive request');
      };
    },
    'delivery_failed',
  ],
  [
    'Discord rate limit',
    (f) => {
      f.channel.send = async () => {
        throw Object.assign(Error('rate'), { status: 429 });
      };
    },
    'discord_rate_limit',
  ],
])
  test(name + ' fails cleanly and records a safe failure', async (t) => {
    const f = fixture(t);
    mutate(f);
    await assert.rejects(f.service.submit(payload), (e) => e.code === code);
    assert.equal(f.service.status().history[0].code, code);
    assert.ok(!JSON.stringify(f.logs).includes('sensitive request'));
  });

test('payload validation rejects destinations, executable fields, bad lengths, context, and timestamps', async (t) => {
  const f = fixture(t);
  for (const bad of [
    null,
    [],
    { ...payload, channelId },
    { ...payload, userId },
    { ...payload, guildId },
    { ...payload, command: 'customcommand' },
    { ...payload, settings: {} },
    { ...payload, title: 'a'.repeat(201) },
    { ...payload, message: 'a'.repeat(1501) },
    { ...payload, severity: 'bad' },
    { ...payload, context: { nested: {} } },
    { ...payload, timestamp: 'yesterday' },
  ])
    await assert.rejects(f.service.submit(bad), (e) => e.code === 'invalid_payload');
  assert.equal(f.sent.length, 0);
  f.service.save({ ...f.store.read(), enabled: false });
  await assert.rejects(f.service.submit(payload), (e) => e.code === 'disabled');
  assert.throws(() => f.service.save({ ...f.store.read(), channelId: 'bad' }), /channelId/);
});

test('sliding rate limit, dedup window, and retry delay are enforced across sources', async (t) => {
  const f = fixture(t);
  f.service.save({ ...f.store.read(), perMinute: 1, dedupSeconds: 60 });
  const first = await f.service.submit(payload);
  const duplicate = await f.service.submit({ ...payload, timestamp: new Date().toISOString() });
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(duplicate.originalId, first.id);
  await assert.rejects(
    f.service.submit({ ...payload, source: 'Other app' }),
    (e) => e.code === 'rate_limited' && e.retryAfter === 60,
  );
  f.clock.value += 61000;
  await f.service.submit(payload);
  assert.equal(f.sent.length, 2);
});

test('bounded serial queue suppresses pending duplicates and cancels queued work on settings changes', async (t) => {
  const f = fixture(t);
  f.service.save({ ...f.store.read(), queueLimit: 2 });
  let release;
  f.service.delivery.send = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const active = f.service.submit(payload);
  const duplicate = await f.service.submit(payload);
  assert.equal(duplicate.originalStatus, 'pending');
  const queued = f.service.submit({ ...payload, title: 'second' });
  const rejection = assert.rejects(queued, (e) => e.code === 'settings_changed');
  await assert.rejects(
    f.service.submit({ ...payload, title: 'third' }),
    (e) => e.code === 'queue_full',
  );
  f.service.save({ ...f.store.read(), mode: 'dm' });
  await rejection;
  release('original destination');
  await active;
  assert.equal(f.service.status().pending, 0);
});

test('failed sends do not poison dedup; service can deliver after failure', async (t) => {
  const f = fixture(t);
  const original = f.channel.send;
  f.channel.send = async () => {
    throw Error('failure');
  };
  await assert.rejects(f.service.submit(payload));
  f.channel.send = original;
  assert.equal((await f.service.submit(payload)).status, 'delivered');
});

test('delivery deadline aborts the Discord request and reports uncertainty', async (t) => {
  const f = fixture(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  f.service.delivery.send = async (_s, _p, cancellation) => {
    signal = cancellation;
    await new Promise(() => {});
  };
  const delivery = f.service.submit(payload);
  const rejected = assert.rejects(
    delivery,
    (e) => e.code === 'delivery_timeout' && e.status === 504,
  );
  t.mock.timers.tick(30001);
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(f.service.status().pending, 0);
});

test('old queued notifications expire rather than producing a delayed burst', async (t) => {
  const f = fixture(t);
  let release;
  f.service.delivery.send = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const first = f.service.submit(payload);
  const queued = f.service.submit({ ...payload, title: 'second' });
  const rejected = assert.rejects(queued, (e) => e.code === 'queue_expired');
  f.clock.value += 61000;
  release('original');
  await first;
  await rejected;
});

test('credential is one-time, hashed at rest, rotated, persisted, and redacted from messages and logs', async (t) => {
  const f = fixture(t);
  assert.ok(f.credential.accepts('Bearer ' + f.token));
  assert.ok(!JSON.stringify(f.credentialStore.read()).includes(f.token));
  assert.ok(!JSON.stringify(f.service.status()).includes(f.token));
  const second = f.credential.rotate();
  assert.ok(!f.credential.accepts('Bearer ' + f.token));
  assert.ok(
    new NotificationCredential(new Store(f.credentialStore.file, {})).accepts('Bearer ' + second),
  );
  const logger = createLogger(path.join(f.dir, 'logs'));
  logger.log('info', second, { secret: second });
  assert.ok(!fs.readFileSync(path.join(f.dir, 'logs', 'events.jsonl'), 'utf8').includes(second));
  await f.service.submit({ ...payload, message: second, context: { token: second } });
  assert.ok(!JSON.stringify(f.sent).includes(second));
});

test('loopback HTTP notification auth cannot grant admin or CustomCommand access', async (t) => {
  const f = fixture(t);
  const config = { port: 0, adminPassword: 'temporary-admin-password' };
  let executed = 0;
  const server = createAdmin({
    config,
    settings: { read: () => defaults },
    host: f.host,
    logger: f.logger,
    runner: {
      run: () => {
        executed++;
      },
    },
    notifications: f.service,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  assert.equal(server.address().address, '127.0.0.1');
  assert.match(
    fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'),
    /server.listen\(config.port, '127.0.0.1'/,
  );
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${config.port}`;
  const post = (route, body, headers = {}) =>
    fetch(url + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const auth = { Authorization: 'Bearer ' + f.token };
  assert.equal((await post('/api/notifications', payload)).status, 401);
  assert.equal(
    (await post('/api/notifications', payload, { Authorization: 'Bearer invalid' })).status,
    401,
  );
  assert.equal(
    (await post('/api/notifications', payload, { ...auth, Origin: 'https://evil.example' })).status,
    403,
  );
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.request(
      url + '/api/notifications',
      { method: 'POST', headers: { ...auth, Host: 'evil.example' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end('{}');
  });
  assert.equal(wrongHost, 403);
  assert.equal((await post('/api/notifications', { ...payload, channelId }, auth)).status, 400);
  assert.equal(
    (await post('/api/notifications', { ...payload, command: 'customcommand' }, auth)).status,
    400,
  );
  for (const route of [
    '/api/settings',
    '/api/notifications/settings',
    '/api/notifications/credential',
    '/api/notifications/test',
    '/api/totp/start',
    '/api/cancel',
  ])
    assert.equal((await post(route, {}, auth)).status, 401);
  assert.equal((await post('/api/notifications', payload, auth)).status, 200);
  assert.equal(
    (await (await post('/api/notifications', payload, auth)).json()).status,
    'duplicate',
  );
  assert.equal(executed, 0);
  const login = await post('/api/login', { password: config.adminPassword });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { csrf } = await login.json();
  const admin = { Cookie: cookie, 'X-CSRF-Token': csrf };
  assert.equal((await post('/api/notifications/credential', {}, { Cookie: cookie })).status, 403);
  assert.equal((await post('/api/notifications', payload, admin)).status, 401);
  const rotated = await (await post('/api/notifications/credential', {}, admin)).json();
  assert.match(rotated.token, /^cbnotify_/);
  const state = await (await fetch(url + '/api/state', { headers: admin })).text();
  assert.ok(!state.includes(rotated.token));
  assert.ok(!state.includes(f.token));
  assert.equal((await post('/api/notifications', payload, auth)).status, 401);
  assert.equal(
    (await post('/api/notifications/settings', { ...f.store.read(), mode: 'dm' }, admin)).status,
    200,
  );
  assert.equal((await post('/api/notifications/test', {}, admin)).status, 200);
  assert.equal(f.sent.at(-1).destination, 'dm');
  assert.equal((await post('/api/notifications/validate', {}, admin)).status, 200);
  f.service.save({ ...f.store.read(), perMinute: 1, dedupSeconds: 0 });
  const limited = await post('/api/notifications', payload, {
    Authorization: 'Bearer ' + rotated.token,
  });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  assert.ok(!JSON.stringify(f.logs).includes(rotated.token));
});
