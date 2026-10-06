import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { AgentChannels } from '../src/notifications/agent-channels.js';
import { NotificationDelivery } from '../src/notifications/delivery.js';
import { validateNotificationSettings, notificationDefaults } from '../src/notifications/model.js';
function fixture() {
  let records = [];
  const store = {
    read: () => structuredClone(records),
    save: (value) => {
      records = structuredClone(value);
    },
  };
  const category = {
    id: 'category',
    guildId: 'guild',
    name: 'Agent Notifications',
    type: 4,
    permissionsFor: () => ({ has: () => true }),
  };
  const channels = new Collection([[category.id, category]]);
  let count = 0;
  const guild = {
    id: 'guild',
    name: 'Server',
    members: { fetchMe: async () => ({}) },
    channels: {
      fetch: async (id) => (id ? channels.get(id) : channels),
      create: async (options) => {
        count++;
        const c = {
          ...options,
          id: `channel-${count}`,
          guildId: 'guild',
          parentId: options.parent,
          permissionsFor: category.permissionsFor,
        };
        channels.set(c.id, c);
        return c;
      },
    },
  };
  return { store, guild, channels, category, router: new AgentChannels(store), count: () => count };
}
test('first source creates a channel; concurrent and restarted callers reuse it', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([
    f.router.resolve(f.guild, 'category', 'Build Agent'),
    f.router.resolve(f.guild, 'category', 'Build Agent'),
  ]);
  assert.equal(a.name, 'build-agent');
  assert.equal(a.id, b.id);
  assert.equal(f.count(), 1);
  const restarted = new AgentChannels(f.store);
  assert.equal((await restarted.resolve(f.guild, 'category', 'BUILD AGENT')).id, a.id);
  f.store.save([]); // Recovery after losing local mapping must not duplicate a Discord channel.
  assert.equal((await restarted.resolve(f.guild, 'category', 'Build Agent')).id, a.id);
  assert.equal(f.count(), 1);
});
test('distinct sources create distinct channels even with colliding slugs', async () => {
  const f = fixture();
  const a = await f.router.resolve(f.guild, 'category', 'Agent A');
  const b = await f.router.resolve(f.guild, 'category', 'Agent-A');
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.name, b.name);
  assert.equal(a.parentId, 'category');
  assert.equal(b.parentId, 'category');
});
test('deleted channel is recreated; moved channel cannot become an arbitrary destination', async () => {
  const f = fixture();
  const a = await f.router.resolve(f.guild, 'category', 'Agent');
  f.channels.delete(a.id);
  const b = await f.router.resolve(f.guild, 'category', 'Agent');
  assert.notEqual(a.id, b.id);
  b.parentId = 'elsewhere';
  await assert.rejects(
    f.router.resolve(f.guild, 'category', 'Agent'),
    (e) => e.code === 'agent_channel_moved',
  );
});
test('invalid category, permissions, and channel cap fail closed', async () => {
  const f = fixture();
  await assert.rejects(
    f.router.resolve(f.guild, 'missing', 'Agent'),
    (e) => e.code === 'invalid_category',
  );
  f.category.permissionsFor = () => ({ has: () => false });
  await assert.rejects(
    f.router.resolve(f.guild, 'category', 'Agent'),
    (e) => e.code === 'missing_permissions',
  );
  f.category.permissionsFor = () => ({ has: () => true });
  for (let i = 0; i < 25; i++) f.channels.set(`existing-${i}`, { parentId: 'category' });
  await assert.rejects(
    f.router.resolve(f.guild, 'category', 'Agent'),
    (e) => e.code === 'agent_limit',
  );
  assert.equal(f.count(), 0);
});
test('agent delivery routes by source and validation does not create channels', async () => {
  const f = fixture();
  const sent = [];
  const delivery = new NotificationDelivery(
    {
      client: {
        isReady: () => true,
        guilds: { fetch: async () => f.guild },
        rest: { post: async (route) => sent.push(route) },
      },
    },
    f.router,
  );
  const settings = { mode: 'agents', guildId: 'guild', categoryId: 'category' };
  assert.equal((await delivery.resolve(settings)).mode, 'agents');
  assert.equal(f.count(), 0);
  for (const source of ['Agent A', 'Agent B', 'Agent A'])
    await delivery.send(settings, {
      source,
      title: 'Test',
      message: 'Hello',
      severity: 'info',
      timestamp: new Date().toISOString(),
      context: {},
    });
  assert.equal(sent[0], sent[2]);
  assert.notEqual(sent[0], sent[1]);
  assert.equal(f.count(), 2);
});
test('settings migrate old destinations and require an explicit agent category', () => {
  const old = notificationDefaults({});
  delete old.categoryId;
  assert.equal(validateNotificationSettings(old).categoryId, '');
  assert.throws(() =>
    validateNotificationSettings({
      ...old,
      enabled: true,
      mode: 'agents',
      guildId: '100000000000000001',
    }),
  );
});

test('admin category creation is private to owners/bot and avoids duplicate categories', async () => {
  const f = fixture();
  await assert.rejects(f.router.createCategory(f.guild, ['owner'], 'bot'), e => e.code === 'category_exists');
  f.channels.delete('category');
  const id = await f.router.createCategory(f.guild, ['owner'], 'bot');
  const category = f.channels.get(id);
  assert.equal(category.type, 4);
  assert.equal(category.permissionOverwrites[0].id, 'guild');
  assert.ok(category.permissionOverwrites[0].deny.length);
  assert.deepEqual(category.permissionOverwrites.slice(1).map(o => o.id), ['owner', 'bot']);
});
