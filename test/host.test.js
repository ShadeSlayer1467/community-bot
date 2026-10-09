import test from 'node:test';
import assert from 'node:assert/strict';
import { DiscordHost } from '../src/discord-host.js';
import { defaults } from '../src/settings.js';
const id = '100000000000000001';
function createHost() {
  return new DiscordHost({
    config: {
      discordToken: 'test-only-not-a-real-token',
      applicationId: id,
      ownerIds: [id],
      guildIds: [id],
    },
    settings: { read: () => defaults },
    runner: { busy: false },
    logger: { log() {}, redact: (x) => x },
  });
}
function stubLogin(host, appId = id) {
  host.client.login = async () => {
    host.client.application = { id: appId };
  };
  host.client.isReady = () => !host.client.ws.destroyed;
}
test('registration removal validates scope and deletes only the selected command', async (t) => {
  const host = createHost();
  t.after(() => host.client.destroy());
  stubLogin(host);
  const commandId = '100000000000000002';
  const deleted = [];
  host.client.rest.get = async () => [{ id: commandId, name: 'legacy', type: 1 }];
  host.client.rest.delete = async (route) => deleted.push(route);
  await assert.rejects(
    host.removeRegistered({ commandId, guildId: '100000000000000003' }),
    /unconfigured/,
  );
  await assert.rejects(
    host.removeRegistered({ commandId: '100000000000000004' }),
    /no longer exists/,
  );
  assert.equal(deleted.length, 0);
  await host.removeRegistered({ commandId });
  assert.deepEqual(deleted, [`/applications/${id}/commands/${commandId}`]);
  assert.equal(host.registered.find((g) => g.scope === 'global').commands.length, 0);
  await host.removeRegistered({ commandId, guildId: id });
  assert.equal(deleted[1], `/applications/${id}/guilds/${id}/commands/${commandId}`);
  assert.equal(host.syncing, false);
});
test('disconnect/reconnect creates a fresh client without network access', async (t) => {
  const host = createHost();
  t.after(() => host.client.destroy());
  stubLogin(host);
  await host.connect();
  assert.equal(host.state, 'online');
  const first = host.client;
  await host.disconnect();
  assert.equal(first.ws.destroyed, true);
  const original = host.createClient.bind(host);
  host.createClient = () => {
    original();
    stubLogin(host);
  };
  await host.connect();
  assert.notEqual(host.client, first);
  assert.equal(host.state, 'online');
});
test('application mismatch fails closed and destroys the authenticated client', async (t) => {
  const host = createHost();
  t.after(() => host.client.destroy());
  stubLogin(host, 'other');
  await assert.rejects(host.connect(), /does not match/);
  assert.equal(host.state, 'offline');
  assert.equal(host.client.ws.destroyed, true);
  assert.equal(host.lifecycleBusy, false);
});

test('sync registers Workout in configured servers and globally and removes it when disabled', async (t) => {
  const host = createHost();
  t.after(() => host.client.destroy());
  stubLogin(host);
  const put = [],
    post = [],
    deleted = [];
  host.client.rest.put = async (route, { body }) => {
    put.push(body);
    return body;
  };
  host.client.rest.get = async () => [{ id: '100000000000000004', name: 'workout', type: 1 }];
  host.client.rest.post = async (route, { body }) => {
    post.push(body);
    return body;
  };
  host.client.rest.delete = async (route) => deleted.push(route);
  await host.sync();
  assert.ok(put.every((commands) => commands.some((c) => c.name === 'workout')));
  assert.ok(
    put.every((commands) => commands.find((c) => c.name === 'workout').contexts === undefined),
  );
  assert.deepEqual(post.find((c) => c.name === 'workout').contexts, [1]);
  host.settings = { read: () => ({ ...defaults, disabled: [...defaults.disabled, 'workout'] }) };
  post.length = 0;
  await host.sync();
  assert.ok(!post.some((c) => c.name === 'workout'));
  assert.ok(deleted.some((route) => route.endsWith('/100000000000000004')));
});
