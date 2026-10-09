import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createAdmin } from '../src/admin/server.js';
import { defaults } from '../src/settings.js';
import { WorkoutRepository } from '../src/workout/repository.js';
import { WorkoutService } from '../src/workout/service.js';
import { createWorkoutHandler, sessionMessage, workoutDefinition } from '../src/workout/discord.js';
import { makeHandler } from '../src/commands/handler.js';
const user = '100000000000000001',
  other = '100000000000000002';
const p = {
  sets: 3,
  minReps: 8,
  maxReps: 12,
  resistance: { kind: 'total', value: 235, unit: 'lb', display: '' },
  rule: { type: 'double', increment: 5, loads: [], chainId: '' },
  note: '',
};
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workout-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const workout = new WorkoutService(new WorkoutRepository(dir, [user]));
  const exercise = workout.saveRecord('exercises', { name: 'Bench', defaults: p }, user);
  const program = workout.saveRecord(
    'programs',
    {
      name: 'Program',
      templates: [{ name: 'Push A', exercises: [{ exerciseId: exercise.id, ...p }] }],
    },
    user,
  );
  const deps = {
    config: {
      ownerIds: [user],
      customOwnerId: user,
      guildIds: [],
      port: 0,
      adminPassword: 'temporary-admin-password',
    },
    workout,
    settings: { read: () => defaults },
    logger: { recent: [], log() {}, redact: (x) => x },
    client: { user: { id: 'bot' } },
    runner: {},
  };
  return { ...deps, exercise, program };
}
function interaction(overrides = {}) {
  const result = {};
  return {
    id: randomUUID(),
    user: { id: user },
    context: 1,
    channelId: 'dm',
    channel: { type: 1 },
    inGuild: () => false,
    isChatInputCommand: () => false,
    isButton: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    reply: async (v) => {
      result.reply = v;
    },
    update: async (v) => {
      result.update = v;
    },
    showModal: async (v) => {
      result.modal = v.toJSON();
    },
    followUp: async (v) => {
      result.followUp = v;
    },
    deferReply: async (v) => {
      result.defer = v;
    },
    editReply: async (v) => {
      result.edit = v;
    },
    result,
    ...overrides,
  };
}
const cid = (s, action, extra = '') =>
  `wo:${s.id}:${s.revision}:${action}${extra ? ':' + extra : ''}`;
function button(s, action, extra, overrides = {}) {
  return interaction({
    isButton: () => true,
    customId: cid(s, action, extra),
    message: { id: 'message' },
    ...overrides,
  });
}
const fields = (values) => ({ getTextInputValue: (key) => values[key] ?? '' });
test('Discord start/resume uses one durable DM, recovered session buttons log reps-only and carry new load', async (t) => {
  const f = fixture(t),
    h = createWorkoutHandler(f);
  let sends = 0,
    edits = 0;
  const channel = {
    type: 1,
    messages: {
      fetch: async () => ({ id: 'message', author: { id: 'bot' }, edit: async () => edits++ }),
    },
    send: async () => {
      sends++;
      return { id: 'message' };
    },
  };
  const slash = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options: { getSubcommand: () => 'start', getBoolean: () => false, getString: () => null },
  });
  await h.handle(slash);
  assert.equal(sends, 1);
  let s = f.workout.active(user);
  assert.equal(s.message.messageId, 'message');
  const resume = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options: { getSubcommand: () => 'resume' },
  });
  await h.handle(resume);
  assert.equal(sends, 1);
  assert.equal(edits, 1);
  const log = button(s, 'log');
  await h.handle(log);
  assert.equal(log.result.modal.components.length, 1);
  assert.equal(log.result.modal.components[0].components[0].custom_id, 'reps');
  const submit = interaction({
    isModalSubmit: () => true,
    customId: log.result.modal.custom_id,
    message: { id: 'message' },
    fields: fields({ reps: '8' }),
  });
  await h.handle(submit);
  assert.ok(submit.result.update);
  s = f.workout.active(user);
  assert.equal(s.exercises[0].sets[0].resistance.value, 235);
  await h.handle(submit);
  assert.equal(f.workout.active(user).exercises[0].sets.length, 1);
  const weight = button(s, 'weight');
  await h.handle(weight);
  const changed = interaction({
    isModalSubmit: () => true,
    customId: weight.result.modal.custom_id,
    message: { id: 'message' },
    fields: fields({ weight: '2x135' }),
  });
  await h.handle(changed);
  s = f.workout.active(user);
  const second = interaction({
    isModalSubmit: () => true,
    customId: cid(s, 'log'),
    message: { id: 'message' },
    fields: fields({ reps: '9' }),
  });
  await createWorkoutHandler({
    ...f,
    workout: new WorkoutService(new WorkoutRepository(f.workout.repo.directory)),
  }).handle(second);
  assert.ok(second.result.update, JSON.stringify(second.result));
  s = f.workout.repo.getSession(s.id); // original repository cache can be stale; read fresh process state below.
  const restored = new WorkoutService(new WorkoutRepository(f.workout.repo.directory));
  s = restored.active(user);
  assert.equal(s.exercises[0].sets[1].resistance.kind, 'pair');
  assert.equal(s.exercises[0].sets[1].resistance.value, 135);
  const payload = sessionMessage(s);
  const labels = payload.components.flatMap((r) => r.toJSON().components.map((c) => c.label));
  assert.ok(!labels.some((l) => /dismiss|close/i.test(l)));
  assert.ok(labels.includes('Finish Workout'));
  assert.ok(payload.components.length <= 5);
  for (const r of payload.components)
    for (const c of r.toJSON().components) assert.ok(c.custom_id.length <= 100);
});
test('Discord confirmations, stale messages/revisions, exact DM and user isolation fail closed', async (t) => {
  const f = fixture(t),
    h = createWorkoutHandler(f);
  let s = f.workout.start(user, { programId: f.program.id });
  f.workout.bindMessage(user, s.id, { channelId: 'dm', messageId: 'message' });
  s = f.workout.active(user);
  const guild = button(s, 'log', null, { inGuild: () => true, context: 0 });
  await h.handle(guild);
  assert.match(guild.result.reply.content, /direct message/);
  const unauthorized = button(s, 'log', null, { user: { id: other } });
  await h.handle(unauthorized);
  assert.match(unauthorized.result.reply.content, /not allowed/);
  f.workout.savePreferences({ allowedUserIds: [user, other] });
  const wrong = button(s, 'log', null, { user: { id: other } });
  await h.handle(wrong);
  assert.match(wrong.result.reply.content, /another user/);
  const stale = button(s, 'log', null, { message: { id: 'old' } });
  await h.handle(stale);
  assert.match(stale.result.reply.content, /stale/);
  const finish = button(s, 'finish');
  await h.handle(finish);
  assert.equal(f.workout.active(user).state, 'active');
  const rows = finish.result.update.components[0].toJSON().components;
  assert.ok(rows.some((b) => b.label === 'Keep Training'));
  assert.ok(rows.some((b) => b.label === 'Confirm Finish Workout'));
  const confirm = interaction({
    isButton: () => true,
    customId: rows[0].custom_id,
    message: { id: 'message' },
  });
  await h.handle(confirm);
  assert.equal(f.workout.active(user), null);
  assert.equal(f.workout.repo.getSession(s.id).state, 'completed');
  const old = button(s, 'log');
  await h.handle(old);
  assert.match(old.result.reply.content, /changed/);
});
test('Workout dispatch is separate from developer execution, definitions are bot-DM only, today plan detects stale edits', async (t) => {
  const f = fixture(t),
    handler = makeHandler(f);
  const today = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    options: { getSubcommand: () => 'today', getString: () => null },
  });
  await handler(today);
  assert.equal(today.result.reply.embeds[0].toJSON().title, 'Push A');
  const startId = today.result.reply.components[0].toJSON().components[0].custom_id;
  f.workout.saveRecord('programs', { ...f.program, name: 'Edited' }, user, f.program.revision);
  const start = interaction({
    isButton: () => true,
    customId: startId,
    message: { id: 'message' },
  });
  await handler(start);
  assert.match(start.result.reply.content, /Plan changed/);
  const definition = workoutDefinition();
  assert.deepEqual(definition.contexts, [1]);
  assert.deepEqual(
    definition.options.map((o) => o.name),
    ['today', 'start', 'resume', 'history'],
  );
});
test('authenticated Workout APIs and every subpage preserve CSRF/Origin, module isolation and dashboard contribution', async (t) => {
  const f = fixture(t);
  const server = createAdmin({ ...f, host: { status: () => ({ state: 'offline' }) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  f.config.port = server.address().port;
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${f.config.port}`;
  for (const path of [
    '/workout',
    '/workout/programs',
    '/workout/exercises',
    '/workout/history',
    '/workout/progression',
    '/workout/active',
    '/workout/settings',
  ])
    assert.equal((await fetch(base + path, { redirect: 'manual' })).status, 302);
  assert.equal((await fetch(base + '/api/workout/state')).status, 401);
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: f.config.adminPassword }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0],
    csrf = (await login.json()).csrf;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
  const post = async (route, body, override = {}) =>
    fetch(base + '/api/workout/' + route, {
      method: 'POST',
      headers: { ...headers, ...override },
      body: JSON.stringify({ userId: user, ...body }),
    });
  assert.equal((await post('start', {}, { 'X-CSRF-Token': '' })).status, 403);
  assert.equal((await post('start', {}, { Origin: 'https://evil.example' })).status, 403);
  const initial = await (await fetch(base + '/api/workout/state', { headers })).json();
  assert.equal(initial.programs[0].name, 'Program');
  const otherCatalog = await (
    await fetch(base + '/api/workout/state?userId=' + other, { headers })
  ).json();
  assert.equal(otherCatalog.exercises.length, 0);
  const create = await post('exercises', { record: { name: 'Fly', defaults: p } });
  assert.equal(create.status, 200);
  let s = await (await post('start', { programId: f.program.id, requestId: randomUUID() })).json();
  assert.equal(
    (
      await post('action', {
        sessionId: s.id,
        action: 'log',
        expectedRevision: s.revision,
        requestId: randomUUID(),
        reps: 10,
        userId: other,
      })
    ).status,
    400,
  );
  s = await (
    await post('action', {
      sessionId: s.id,
      action: 'log',
      expectedRevision: s.revision,
      requestId: randomUUID(),
      reps: 10,
    })
  ).json();
  assert.equal(s.exercises[0].sets.length, 1);
  assert.equal(
    (
      await post('action', {
        sessionId: s.id,
        action: 'finish',
        expectedRevision: s.revision,
        requestId: randomUUID(),
      })
    ).status,
    400,
  );
  const confirm = await (
    await post('confirm', { sessionId: s.id, action: 'finish', expectedRevision: s.revision })
  ).json();
  s = await (
    await post('action', {
      sessionId: s.id,
      action: 'finish',
      expectedRevision: s.revision,
      confirmationToken: confirm.token,
      requestId: randomUUID(),
    })
  ).json();
  assert.equal(s.state, 'completed');
  const data = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(data.workout.next, 'Push A');
  assert.ok(data.workout.last);
  const module = await import('../src/admin/public/modules/workout.js');
  assert.match(module.summary(data), /Next: Push A/);
  for (const route of ['programs', 'exercises', 'history', 'progression', 'active', 'settings'])
    assert.equal((await fetch(base + '/workout/' + route, { headers })).status, 200);
  assert.equal((await fetch(base + '/workout/invented', { headers })).status, 404);
  assert.equal(
    (await fetch(base + '/api/logout', { method: 'POST', headers, body: '{}' })).status,
    200,
  );
  assert.equal((await fetch(base + '/api/workout/state', { headers })).status, 401);
});

test('DM edits, repeat, selection/addition, delete confirmation and progression acceptance update the same source message', async (t) => {
  const f = fixture(t),
    h = createWorkoutHandler(f);
  let s = f.workout.start(user, { programId: f.program.id });
  f.workout.bindMessage(user, s.id, { channelId: 'dm', messageId: 'message' });
  s = f.workout.active(user);
  const submit = async (action, values, extra) => {
    const i = interaction({
      isModalSubmit: () => true,
      customId: cid(s, action, extra),
      message: { id: 'message' },
      fields: fields(values),
    });
    await h.handle(i);
    assert.ok(i.result.update, JSON.stringify(i.result));
    s = f.workout.active(user);
  };
  await submit('log', { reps: '12' });
  const edit = button(s, 'edit');
  await h.handle(edit);
  assert.equal(edit.result.modal.components[0].components[0].value, '12');
  await submit(
    'edit',
    { reps: '11', weight: '235 lb', note: 'Paused', uncertain: 'no' },
    s.exercises[0].sets[0].id,
  );
  assert.equal(s.exercises[0].sets[0].reps, 11);
  await submit('repeat', { reps: '12' });
  assert.equal(s.exercises[0].sets[1].resistance.value, 235);
  const select = interaction({
    isStringSelectMenu: () => true,
    customId: cid(s, 'delete-choice'),
    values: [s.exercises[0].sets[0].id],
    message: { id: 'message' },
  });
  await h.handle(select);
  assert.equal(f.workout.active(user).exercises[0].sets.length, 2);
  const confirmId = select.result.update.components[0].toJSON().components[0].custom_id;
  await h.handle(
    interaction({ isButton: () => true, customId: confirmId, message: { id: 'message' } }),
  );
  s = f.workout.active(user);
  assert.equal(s.exercises[0].sets.length, 1);
  assert.equal(s.exercises[0].sets[0].order, 1);
  await submit('log', { reps: '12' });
  await submit('log', { reps: '12' });
  const finish = button(s, 'finish');
  await h.handle(finish);
  await h.handle(
    interaction({
      isButton: () => true,
      customId: finish.result.update.components[0].toJSON().components[0].custom_id,
      message: { id: 'message' },
    }),
  );
  s = f.workout.repo.getSession(s.id);
  const choice = interaction({
    isStringSelectMenu: () => true,
    customId: cid(s, 'recommend'),
    values: [s.exercises[0].id],
    message: { id: 'message' },
  });
  await h.handle(choice);
  assert.match(choice.result.update.content, /PROGRESS/);
  const accept = button(s, 'accept', s.exercises[0].id);
  await h.handle(accept);
  assert.ok(accept.result.update);
  assert.equal(f.workout.catalog(user).programs[0].templates[0].exercises[0].resistance.value, 240);
  let free = f.workout.start(user, { free: true });
  f.workout.bindMessage(user, free.id, { channelId: 'dm', messageId: 'message' });
  free = f.workout.active(user);
  const add = button(free, 'add');
  await h.handle(add);
  assert.ok(add.result.update.components[0].toJSON().components[0].options.length);
  const chosen = interaction({
    isStringSelectMenu: () => true,
    customId: cid(free, 'add-choice'),
    values: [f.exercise.id],
    message: { id: 'message' },
  });
  await h.handle(chosen);
  assert.equal(f.workout.active(user).exercises[0].planned, null);
});

test('concurrent Discord start requests cannot create competing active messages', async (t) => {
  const f = fixture(t),
    h = createWorkoutHandler(f);
  let sends = 0,
    release;
  const gate = new Promise((resolve) => (release = resolve));
  const channel = {
    type: 1,
    send: async () => {
      sends++;
      await gate;
      return { id: 'message' };
    },
  };
  const options = { getSubcommand: () => 'start', getBoolean: () => false, getString: () => null };
  const first = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options,
  });
  const second = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options,
  });
  const running = h.handle(first);
  await new Promise((resolve) => setImmediate(resolve));
  await h.handle(second);
  assert.match(second.result.reply.content, /still updating/);
  release();
  await running;
  assert.equal(sends, 1);
  assert.equal(f.workout.repo.sessions().length, 1);
});
