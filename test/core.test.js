import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PermissionsBitField, Collection } from 'discord.js';
import { validateConfig, connectionIssues, loadConfig } from '../src/config.js';
import {
  requireOwner,
  requireAccess,
  requirePermissions,
  checkTarget,
  P,
} from '../src/authorization.js';
import { defaults, validateSettings } from '../src/settings.js';
import { Store } from '../src/persistence.js';
import { purge, moderate, BULK_AGE } from '../src/services/moderation.js';
import { taskAction } from '../src/services/tasks.js';
import { ask } from '../src/services/ai.js';
import { definitions, developerDefinitions } from '../src/commands/definitions.js';
import { securityFixture, dm } from './helpers.js';
import { makeHandler } from '../src/commands/handler.js';
const owner = '100000000000000001',
  guild = '100000000000000002';
const config = {
  discordToken: '',
  applicationId: '',
  ownerIds: [owner],
  guildIds: [guild],
  adminPassword: '',
  port: 3210,
  openaiApiKey: '',
  openaiModel: '',
};
const interaction = (overrides) => ({
  inGuild: () => true,
  guildId: guild,
  user: { id: owner },
  member: { roles: [] },
  memberPermissions: new PermissionsBitField(P.Administrator),
  appPermissions: new PermissionsBitField(P.Administrator),
  ...overrides,
});
const temp = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-bot-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};
test('blank credentials give actionable setup diagnostics; unsafe ID types rejected', () => {
  assert.equal(validateConfig(config), config);
  assert.match(connectionIssues(config).join(' '), /discordToken/);
  assert.throws(() => validateConfig({ ...config, ownerIds: [123] }), /quoted strings/);
  assert.throws(() => validateConfig({ ...config, adminPassword: 'short' }), /16 characters/);
  assert.throws(() => loadConfig('nonexistent-config.json'), /Copy config.example/);
});
test('owner authorization never accepts role/admin claims or blanks', () => {
  requireOwner(owner, config);
  assert.throws(() => requireOwner('other', config), /owner/);
  assert.throws(() => requireOwner(owner, { ownerIds: [] }), /owner/);
  assert.throws(
    () => requireAccess(interaction({ user: { id: 'other' } }), config, defaults, 'owner'),
    /owner/,
  );
  assert.throws(
    () => requireAccess(interaction({ guildId: 'other' }), config, defaults, 'everyone'),
    /server/,
  );
  assert.throws(
    () => requireAccess(interaction({ inGuild: () => false }), config, defaults, 'owner'),
    /server/,
  );
});
test('moderator allowlists and caller/bot permission checks are independent', () => {
  assert.throws(
    () => requireAccess(interaction({ user: { id: 'other' } }), config, defaults, 'moderator'),
    /allowlist/,
  );
  requireAccess(
    interaction({ user: { id: 'other' }, member: { roles: ['role'] } }),
    config,
    { ...defaults, moderatorRoleIds: ['role'] },
    'moderator',
  );
  assert.throws(
    () =>
      requirePermissions(
        interaction({ memberPermissions: new PermissionsBitField() }),
        P.BanMembers,
      ),
    /You lack/,
  );
  assert.throws(
    () =>
      requirePermissions(interaction({ appPermissions: new PermissionsBitField() }), P.BanMembers),
    /bot lacks/,
  );
});
test('hierarchy denies same/higher roles and protected targets', () => {
  const member = (id, position) => ({
    id,
    roles: { highest: { position, comparePositionTo: (other) => position - other.position } },
  });
  const actor = member('actor', 5),
    bot = member('bot', 8);
  assert.throws(
    () => checkTarget(actor, member('target', 5), bot, 'guild-owner'),
    /Your highest role/,
  );
  assert.throws(
    () => checkTarget(member('guild-owner', 1), member('target', 9), bot, 'guild-owner'),
    /bot role/,
  );
  assert.throws(
    () => checkTarget(actor, member('guild-owner', 1), bot, 'guild-owner'),
    /server owner/,
  );
  checkTarget(actor, member('target', 2), bot, 'guild-owner');
});
test('moderation refreshes role membership before executing and includes an audit reason', async () => {
  const member = (id, position) => ({
    id,
    user: { tag: id },
    roles: { highest: { position, comparePositionTo: (other) => position - other.position } },
  });
  const actor = member(owner, 5),
    target = member('target', 2),
    bot = member('bot', 8);
  let request;
  target.bannable = true;
  target.ban = async (options) => {
    request = options;
  };
  const i = interaction({
    guild: {
      ownerId: 'guild-owner',
      members: {
        fetch: async (options) => {
          assert.equal(options.force, true);
          return options.user === owner ? actor : target;
        },
        fetchMe: async (options) => {
          assert.equal(options.force, true);
          return bot;
        },
      },
    },
  });
  assert.match(await moderate(i, 'ban', 'target', 'Test reason'), /Banned/);
  assert.equal(request.deleteMessageSeconds, 0);
  assert.equal(request.reason, `${owner}: Test reason`);
});
test('settings prevent reserved command replacement and survive restart atomically', (t) => {
  const file = path.join(temp(t), 'settings.json');
  const store = new Store(file, defaults, validateSettings);
  assert.throws(
    () =>
      store.save({ ...defaults, responses: [{ ...defaults.responses[0], name: 'customcommand' }] }),
    /reserved/,
  );
  assert.throws(() => store.save({ ...defaults, customTimeoutSeconds: 0 }), /timeout/);
  store.save({ ...defaults, disabled: ['purge'] });
  assert.deepEqual(new Store(file, defaults, validateSettings).read().disabled, ['purge']);
  const snapshot = store.read();
  snapshot.disabled.push('ban');
  assert.deepEqual(store.read().disabled, ['purge']);
});
function channel(pages) {
  const calls = [];
  return {
    calls,
    messages: {
      fetch: async (options) => {
        calls.push(['fetch', options]);
        return new Collection((pages.shift() ?? []).map((m) => [m.id, m]));
      },
    },
    bulkDelete: async (ids) => {
      calls.push(['bulk', ids]);
      return new Collection(ids.map((id) => [id, {}]));
    },
  };
}
const message = (id, age = 1000, author = owner, pinned = false) => ({
  id,
  createdTimestamp: Date.now() - age,
  author: { id: author },
  pinned,
  delete: async () => {},
});
test('purge paginates, filters users/pins/age and reports actual deletions', async () => {
  const ch = channel([
    [message('1', 1000, 'other'), message('2', 1000, owner, true)],
    [message('3'), message('4'), message('5', BULK_AGE + 1000)],
  ]);
  const result = await purge(interaction({ channel: ch }), {
    count: 50,
    userId: owner,
    scan: 1000,
  });
  assert.equal(result.deleted, 2);
  assert.equal(result.scanned, 5);
  assert.equal(result.skippedOld, 1);
  assert.deepEqual(ch.calls.filter((c) => c[0] === 'bulk')[0][1], ['3', '4']);
  assert.equal(ch.calls[1][1].before, '2');
});
test('purge handles zero/single messages without invalid bulk calls and supports cancellation', async () => {
  let single = 0;
  const m = message('1');
  m.delete = async () => single++;
  const ch = channel([[m]]);
  assert.equal((await purge(interaction({ channel: ch }), { count: 1 })).deleted, 1);
  assert.equal(single, 1);
  assert.equal(ch.calls.filter((c) => c[0] === 'bulk').length, 0);
  assert.equal((await purge(interaction({ channel: channel([[]]) }), { count: 50 })).deleted, 0);
  await assert.rejects(purge(interaction({ channel: ch }), { count: 1001 }), /Count/);
  await assert.rejects(purge(interaction({ channel: ch }), {}, AbortSignal.abort()), /abort/i);
});
test('task mutations cannot cross user or guild boundaries', (t) => {
  const store = new Store(path.join(temp(t), 'tasks.json'), []);
  const task = taskAction(store, guild, owner, 'add', 'Test')[0];
  assert.throws(() => taskAction(store, guild, 'other', 'remove', task.id), /not found/);
  assert.throws(() => taskAction(store, 'other', owner, 'toggle', task.id), /not found/);
  assert.equal(taskAction(store, guild, owner, 'toggle', task.id)[0].done, true);
});
test('slash definitions reserve sensitive commands and serialize successfully', () => {
  const defs = definitions(defaults);
  assert.equal(
    defs.find((c) => c.name === 'customcommand'),
    undefined,
  );
  for (const command of developerDefinitions(defaults)) {
    assert.deepEqual(command.contexts, [1]);
    assert.deepEqual(command.integration_types, [0]);
  }
  assert.equal(
    defs.find((c) => c.name === 'purge').default_member_permissions,
    String(P.ManageMessages),
  );
  assert.ok(!defs.find((c) => c.name === 'ask'));
  assert.equal(new Set(defs.map((c) => c.name)).size, defs.length);
});
test('AI uses Responses API and exposes no provider body on errors', async () => {
  await assert.rejects(ask(config, 'hi'), /configure/);
  const c = { ...config, openaiApiKey: 'test-key', openaiModel: 'configured-model' };
  const value = await ask(c, 'hello', async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.store, false);
    assert.equal(body.input, 'hello');
    return {
      ok: true,
      json: async () => ({ output: [{ content: [{ type: 'output_text', text: 'Hello!' }] }] }),
    };
  });
  assert.equal(value, 'Hello!');
  await assert.rejects(
    ask(c, 'hello', async () => ({ ok: false, status: 429 })),
    /HTTP 429/,
  );
});
test('interaction boundary denies non-owner before worker creation even with administrator', async () => {
  const { security } = await securityFixture(true);
  let ran = false,
    reply;
  const handler = makeHandler({
    config,
    security,
    settings: { read: () => defaults },
    logger: { log() {}, redact: (x) => x },
    runner: {
      run() {
        ran = true;
      },
    },
  });
  await handler(
    dm({
      user: { id: 'other' },
      commandName: 'customcommand',
      isChatInputCommand: () => true,
      reply: async (data) => {
        reply = data;
      },
    }),
  );
  assert.equal(ran, false);
  assert.match(reply.content, /owner/);
});
