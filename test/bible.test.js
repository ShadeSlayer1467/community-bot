import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/persistence.js';
import { BibleService, books, chapters, plan } from '../src/bible/service.js';
import { bibleDefinition, createBibleHandler, readingMessage, fullPlanMessage } from '../src/bible/discord.js';
import { definitions } from '../src/commands/definitions.js';
import { defaults } from '../src/settings.js';

function fixture(t, start = '2026-10-14T18:00:00Z') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bible-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bible.json');
  const clock = { value: Date.parse(start) };
  const service = new BibleService(new Store(file, {}), () => clock.value, 'America/Chicago');
  return { service, clock, file };
}
test('365 readings cover every chapter once, NT first, with no gaps', () => {
  assert.equal(books.length, 66);
  assert.equal(chapters.length, 1189);
  assert.equal(plan.length, 365);
  const expanded = plan.flatMap(p => p.split('; ').flatMap(part => {
    const [, book, first, last] = /^(.*) (\d+)(?:-(\d+))?$/.exec(part);
    return Array.from({ length: +(last ?? first) - +first + 1 }, (_, n) => ({ book, chapter: +first + n }));
  }));
  assert.deepEqual(expanded, chapters);
  assert.equal(plan[0], 'Matthew 1-3');
  assert.equal(expanded[259].book, 'Revelation');
  assert.deepEqual(expanded[260], { book: 'Genesis', chapter: 1 });
  assert.equal(plan.at(-1), 'Malachi 1-4');
});
test('day 4 returns reading 2 and 2 behind; history and state survive restart', t => {
  const { service, clock, file } = fixture(t);
  assert.equal(service.history('a'), null);
  const first = service.today('a');
  assert.equal(first.behind, 0);
  service.act('a', first.active, 'complete');
  clock.value += 3 * 86400000;
  const restarted = new BibleService(new Store(file, {}), () => clock.value);
  const second = restarted.today('a');
  assert.equal(second.day, 2);
  assert.equal(second.passage, plan[1]);
  assert.equal(second.behind, 2);
  assert.equal(restarted.history('a').completed.length, 1);
  assert.equal(restarted.today('b').day, 1);
  restarted.act('a', second.active, 'complete');
  assert.equal(restarted.today('a').behind, 1);
});
test('abandon preserves progress; stale, double and foreign-user actions cannot advance', t => {
  const { service } = fixture(t);
  const first = service.today('a');
  assert.equal(service.today('a').active, first.active);
  assert.throws(() => service.act('b', first.active, 'complete'));
  service.act('a', first.active, 'abandon');
  assert.throws(() => service.act('a', first.active, 'complete'));
  const resumed = service.today('a');
  assert.equal(resumed.day, 1);
  assert.notEqual(resumed.active, first.active);
  service.act('a', resumed.active, 'complete');
  assert.throws(() => service.act('a', resumed.active, 'complete'));
  assert.equal(service.today('a').day, 2);
});
test('calendar boundaries respect DST and support catching up or finishing early', t => {
  const { service, clock } = fixture(t, '2026-11-01T04:30:00Z');
  service.today('a'); // Oct 31, 23:30 CDT
  clock.value = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(service.today('a').behind, 1);
  for (let n = 0; n < 365; n++) service.act('a', service.today('a').active, 'complete');
  const done = service.today('a');
  assert.equal(done.finished, true);
  assert.equal(done.behind, 0);
  assert.equal(done.completed.length, 365);
  assert.deepEqual(readingMessage(done, 'a').components, []);
});
test('schemas, private replies, button dispatch and history pagination', async t => {
  const { service } = fixture(t);
  assert.deepEqual(bibleDefinition().contexts, [1]);
  assert.ok(definitions(defaults).some(c => c.name === 'bible'));
  assert.ok(!definitions({ ...defaults, disabled: ['bible'] }).some(c => c.name === 'bible'));
  const handler = createBibleHandler({ config: { guildIds: ['g'] }, settings: { read: () => defaults },
    bible: service, logger: { log() {} } });
  const replies = [];
  const interaction = { user: { id: 'a' }, inGuild: () => true, guildId: 'g',
    isChatInputCommand: () => true, isButton: () => false, commandName: 'bible',
    options: { getSubcommand: () => 'today' },
    deferReply: async p => { replies.push(p); }, editReply: async p => { replies.push(p); } };
  assert.equal(handler.handles(interaction), true);
  await handler.handle(interaction);
  assert.equal(replies[0].flags, 64);
  assert.equal(replies[1].embeds[0].description, plan[0]);
  const customId = replies[1].components[0].components[1].custom_id;
  const button = { ...interaction, isChatInputCommand: () => false, isButton: () => true,
    customId, deferUpdate: async () => {} };
  await handler.handle(button);
  assert.equal(service.history('a').completed.length, 1);
  const foreign = [];
  await handler.handle({ ...button, user: { id: 'b' }, reply: async p => foreign.push(p) });
  assert.match(foreign[0].content, /another user/);
  for (let n = 1; n < 25; n++) service.act('a', service.today('a').active, 'complete');
  await handler.handle({ ...interaction, options: { getSubcommand: () => 'history', getInteger: () => 2 } });
  assert.match(replies.at(-1).embeds[0].footer.text, /Page 2\/2/);
  assert.equal(replies.at(-1).embeds[0].description.split('\n').length, 5);
  await handler.handle({ ...interaction, options: { getSubcommand: () => 'full', getInteger: () => null } });
  assert.match(replies.at(-1).embeds[0].fields[0].value, /✅ 1\. Matthew 1-3/);
  await handler.handle({ ...button, customId: 'bible:a:full:2' });
  assert.match(replies.at(-1).embeds[0].footer.text, /Page 2\/19/);
  assert.match(replies.at(-1).embeds[0].fields[0].value, /❌ 26\./);
  assert.equal(service.history('a').completed.length, 25);
});

test('full plan pages cover all readings, preserve progress and fit embed limits', t => {
  const { service } = fixture(t);
  const lines = [];
  assert.ok(bibleDefinition().options.some(s => s.name === 'full'));
  for (let page = 1; page <= 19; page++) {
    const message = fullPlanMessage(service.history('a'), 'a', page);
    const embed = message.embeds[0];
    assert.ok(embed.fields.length <= 2);
    for (const field of embed.fields) {
      assert.ok(field.inline);
      assert.ok(field.value.length <= 1024);
      lines.push(...field.value.split('\n'));
    }
    assert.ok(JSON.stringify(embed).length < 6000);
    assert.equal(message.components[0].components[0].disabled, page === 1);
    assert.equal(message.components[0].components[1].disabled, page === 19);
  }
  assert.deepEqual(lines, plan.map((passage, index) => `❌ ${index + 1}. ${passage}`));
  assert.equal(service.history('a'), null);
  const first = service.today('a');
  service.act('a', first.active, 'complete');
  const updated = fullPlanMessage(service.history('a'), 'a');
  assert.match(updated.embeds[0].fields[0].value, /^✅ 1\. Matthew 1-3\n❌ 2\./);
});
