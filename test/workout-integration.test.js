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
  const workout = new WorkoutService(new WorkoutRepository(dir, [user], { seed: false }));
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
    workout: new WorkoutService(new WorkoutRepository(f.workout.repo.directory, [], { seed: false })),
  }).handle(second);
  assert.ok(second.result.update, JSON.stringify(second.result));
  s = f.workout.repo.getSession(s.id); // original repository cache can be stale; read fresh process state below.
  const restored = new WorkoutService(new WorkoutRepository(f.workout.repo.directory, [], { seed: false }));
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
  assert.match(guild.result.reply.content, /not configured/);
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
test('Workout dispatch is separate from developer execution, definitions support servers and bot DMs, today plan detects stale edits', async (t) => {
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
  const searchAdd=interaction({isModalSubmit:()=>true,customId:add.result.modal.custom_id,message:{id:'message'},fields:fields({search:'Bench'})});
  await h.handle(searchAdd);
  assert.ok(searchAdd.result.update.components[0].toJSON().components[0].options.length);
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

test('configured server workouts persist in the channel and reject other users and unconfigured servers', async (t) => {
  const f = fixture(t),
    guildId = '100000000000000010';
  f.config.guildIds = [guildId];
  const h = createWorkoutHandler(f);
  let sent;
  const channel = {
    type: 0,
    send: async (payload) => {
      sent = payload;
      return { id: 'server-message' };
    },
  };
  const slash = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    context: 0,
    inGuild: () => true,
    guildId,
    channelId: 'server-channel',
    channel,
    options: { getSubcommand: () => 'start', getBoolean: () => false, getString: () => null },
  });
  await h.handle(slash);
  assert.ok(sent);
  let s = f.workout.active(user);
  assert.equal(s.message.channelId, 'server-channel');
  const modal = interaction({
    isModalSubmit: () => true,
    customId: cid(s, 'log'),
    context: 0,
    inGuild: () => true,
    guildId,
    channelId: 'server-channel',
    channel,
    message: { id: 'server-message' },
    fields: fields({ reps: '10' }),
  });
  await h.handle(modal);
  assert.ok(modal.result.update);
  s = f.workout.active(user);
  assert.equal(s.exercises[0].sets[0].reps, 10);
  f.workout.savePreferences({ allowedUserIds: [user, other] });
  const wrong = interaction({
    isButton: () => true,
    customId: cid(s, 'repeat'),
    context: 0,
    inGuild: () => true,
    guildId,
    channelId: 'server-channel',
    channel,
    message: { id: 'server-message' },
    user: { id: other },
  });
  await h.handle(wrong);
  assert.match(wrong.result.reply.content, /another user/);
  assert.equal(f.workout.active(user).exercises[0].sets.length, 1);
  const unauthorized = interaction({
    isButton: () => true,
    customId: cid(s, 'repeat'),
    context: 0,
    inGuild: () => true,
    guildId: '100000000000000099',
    channelId: 'server-channel',
    channel,
    message: { id: 'server-message' },
  });
  await h.handle(unauthorized);
  assert.match(unauthorized.result.reply.content, /not configured/);
  const crossChannel = interaction({
    isButton: () => true,
    customId: cid(s, 'repeat'),
    context: 0,
    inGuild: () => true,
    guildId,
    channelId: 'different-channel',
    channel,
    message: { id: 'server-message' },
  });
  await h.handle(crossChannel);
  assert.match(crossChannel.result.reply.content, /stale/);
  assert.equal(workoutDefinition({ guild: true }).contexts, undefined);
});

const todayInteraction = () =>
  interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    options: {
      getSubcommand: () => 'today',
      getString: () => {
        throw new Error('UUID inputs must not be read');
      },
    },
  });
const menuOf = (payload) => payload.components[0].toJSON().components[0];
const chooseOption = (menu, value, overrides = {}) =>
  interaction({
    isStringSelectMenu: () => true,
    customId: menu.custom_id,
    values: [value],
    message: { id: 'selection-message' },
    ...overrides,
  });
function severalTemplates(f) {
  return f.workout.saveRecord(
    'programs',
    {
      ...f.program,
      templates: [
        f.program.templates[0],
        { name: 'Strength B', exercises: [{ exerciseId: f.exercise.id, ...p }] },
      ],
    },
    user,
    f.program.revision,
  );
}
function secondProgram(f) {
  return f.workout.saveRecord(
    'programs',
    {
      name: 'Second Program',
      templates: [{ name: 'Second Workout', exercises: [{ exerciseId: f.exercise.id, ...p }] }],
    },
    user,
  );
}
test('no active programs gives actionable guidance without creating a session', async (t) => {
  const f = fixture(t);
  f.workout.saveRecord('programs', { ...f.program, active: false }, user, f.program.revision);
  const i = todayInteraction();
  await createWorkoutHandler(f).handle(i);
  assert.match(i.result.reply.content, /Create or activate.*Workout → Programs/);
  assert.equal(f.workout.active(user), null);
});
test('one program/one template resolves automatically, preview has human names and raw slash ID options are absent', async (t) => {
  const f = fixture(t),
    i = todayInteraction();
  await createWorkoutHandler(f).handle(i);
  assert.equal(i.result.reply.embeds[0].toJSON().title, 'Push A');
  assert.match(i.result.reply.embeds[0].toJSON().description, /Program/);
  assert.equal(
    i.result.reply.components[0].toJSON().components[1].label,
    'Choose Different Workout',
  );
  assert.equal(f.workout.repo.preferences().plans[user].templateId, f.program.templates[0].id);
  const definition = workoutDefinition();
  assert.equal(definition.options.find((o) => o.name === 'today').options?.length ?? 0, 0);
  assert.deepEqual(
    definition.options.find((o) => o.name === 'start').options.map((o) => o.name),
    ['free'],
  );
});
test('one program/several templates prompts a named template menu and persists the chosen next workout', async (t) => {
  const f = fixture(t),
    program = severalTemplates(f),
    h = createWorkoutHandler(f),
    i = todayInteraction();
  await h.handle(i);
  const menu = menuOf(i.result.reply);
  assert.deepEqual(
    menu.options.map((o) => o.label),
    ['Push A', 'Strength B'],
  );
  const select = chooseOption(menu, program.templates[1].id);
  await h.handle(select);
  assert.equal(select.result.update.embeds[0].toJSON().title, 'Strength B');
  const saved = todayInteraction();
  await h.handle(saved);
  assert.equal(saved.result.reply.embeds[0].toJSON().title, 'Strength B');
  assert.equal(f.workout.active(user), null);
});
test('multiple programs prompt program then template menus; Choose Different ignores saved selection without changing active history', async (t) => {
  const f = fixture(t),
    program = severalTemplates(f);
  secondProgram(f);
  const h = createWorkoutHandler(f),
    i = todayInteraction();
  await h.handle(i);
  const programs = menuOf(i.result.reply);
  assert.deepEqual(
    programs.options.map((o) => o.label),
    ['Program', 'Second Program'],
  );
  const pickedProgram = chooseOption(programs, program.id);
  await h.handle(pickedProgram);
  const templates = menuOf(pickedProgram.result.update);
  assert.deepEqual(
    templates.options.map((o) => o.label),
    ['Push A', 'Strength B'],
  );
  const pickedTemplate = chooseOption(templates, program.templates[1].id);
  await h.handle(pickedTemplate);
  assert.equal(pickedTemplate.result.update.embeds[0].toJSON().title, 'Strength B');
  const active = f.workout.start(user, { free: true });
  const before = structuredClone(f.workout.repo.sessions());
  const different = interaction({
    isButton: () => true,
    customId: pickedTemplate.result.update.components[0].toJSON().components[1].custom_id,
    message: { id: 'selection-message' },
  });
  await h.handle(different);
  assert.equal(menuOf(different.result.update).options.length, 2);
  assert.deepEqual(f.workout.repo.sessions(), before);
  assert.equal(f.workout.active(user).id, active.id);
});
test('stale selection menus and removed-template previews reject changes; selection is isolated by user and channel', async (t) => {
  const f = fixture(t),
    program = severalTemplates(f),
    h = createWorkoutHandler(f),
    i = todayInteraction();
  await h.handle(i);
  const menu = menuOf(i.result.reply);
  f.workout.savePreferences({ allowedUserIds: [user, other] });
  const wrong = chooseOption(menu, program.templates[0].id, { user: { id: other } });
  await h.handle(wrong);
  assert.match(wrong.result.reply.content, /another user/);
  const wrongChannel = chooseOption(menu, program.templates[0].id, { channelId: 'another' });
  await h.handle(wrongChannel);
  assert.match(wrongChannel.result.reply.content, /another user or channel/);
  f.workout.saveRecord('programs', { ...program, name: 'Edited' }, user, program.revision);
  const stale = chooseOption(menu, program.templates[0].id);
  await h.handle(stale);
  assert.match(stale.result.reply.content, /Plan changed.*review again/);
  const fresh = todayInteraction();
  await h.handle(fresh);
  const chosen = chooseOption(menuOf(fresh.result.reply), program.templates[1].id);
  await h.handle(chosen);
  const startId = chosen.result.update.components[0].toJSON().components[0].custom_id;
  const current = f.workout.owned('programs', program.id, user);
  f.workout.saveRecord(
    'programs',
    { ...current, templates: [current.templates[0]] },
    user,
    current.revision,
  );
  const start = interaction({
    isButton: () => true,
    customId: startId,
    message: { id: 'selection-message' },
  });
  await h.handle(start);
  assert.match(start.result.reply.content, /Plan changed/);
  assert.equal(f.workout.active(user), null);
});
test('preview Start resumes existing active session, and free start bypasses ambiguous programs without replacing active work', async (t) => {
  const f = fixture(t),
    h = createWorkoutHandler(f),
    i = todayInteraction();
  await h.handle(i);
  const preview = i.result.reply;
  secondProgram(f);
  const channel = {
    type: 1,
    send: async () => ({ id: 'active-message' }),
    messages: {
      fetch: async () => ({ id: 'active-message', author: { id: 'bot' }, edit: async () => {} }),
    },
  };
  const free = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options: {
      getSubcommand: () => 'start',
      getBoolean: () => true,
      getString: () => {
        throw new Error('No UUID typing');
      },
    },
  });
  await h.handle(free);
  const active = f.workout.active(user);
  assert.equal(active.mode, 'free');
  const start = interaction({
    isButton: () => true,
    customId: preview.components[0].toJSON().components[0].custom_id,
    message: { id: 'selection-message' },
    channel,
  });
  await h.handle(start);
  assert.ok(start.result.edit);
  assert.equal(f.workout.active(user).id, active.id);
  assert.equal(f.workout.repo.sessions().length, 1);
});
test('planned start uses named selection when ambiguous, and stale saved preferences recover by asking again', async (t) => {
  const f = fixture(t),
    program = severalTemplates(f),
    h = createWorkoutHandler(f);
  f.workout.setNext(user, program.id, program.templates[1].id, program.revision);
  f.workout.saveRecord(
    'programs',
    {
      ...program,
      templates: [
        { ...program.templates[0] },
        { name: 'New workout', exercises: [{ exerciseId: f.exercise.id, ...p }] },
      ],
    },
    user,
    program.revision,
  );
  const i = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    options: {
      getSubcommand: () => 'start',
      getBoolean: () => false,
      getString: () => {
        throw new Error('No UUID options');
      },
    },
  });
  await h.handle(i);
  assert.equal(menuOf(i.result.reply).type, 3);
  assert.equal(f.workout.active(user), null);
  assert.equal(f.workout.state(user).savedNext, null);
});

test('named selection paginates beyond Discord’s 25-option limit and changing next preserves the active session', async (t) => {
  const f = fixture(t);
  for (let n = 0; n < 25; n++)
    f.workout.saveRecord(
      'programs',
      {
        name: 'Program ' + n,
        templates: [{ name: 'Workout ' + n, exercises: [{ exerciseId: f.exercise.id, ...p }] }],
      },
      user,
    );
  const h = createWorkoutHandler(f),
    i = todayInteraction();
  await h.handle(i);
  assert.equal(menuOf(i.result.reply).options.length, 25);
  const more = i.result.reply.components[1].toJSON().components[1];
  const page = interaction({
    isButton: () => true,
    customId: more.custom_id,
    message: { id: 'selection-message' },
  });
  await h.handle(page);
  const last = menuOf(page.result.update);
  assert.equal(last.options.length, 1);
  const active = f.workout.start(user, { free: true }),
    before = structuredClone(f.workout.repo.sessions());
  const select = chooseOption(last, last.options[0].value);
  await h.handle(select);
  assert.equal(select.result.update.embeds[0].toJSON().title, 'Workout 24');
  assert.deepEqual(f.workout.repo.sessions(), before);
  assert.equal(f.workout.active(user).id, active.id);
  const replay = chooseOption(last, last.options[0].value);
  await h.handle(replay);
  assert.match(replay.result.reply.content, /expired/);
});

test('large starter library Add Exercise searches aliases in a modal, supports no matches and logs normally', async t => {
 const f=fixture(t); f.workout.repo.seedEnabled=true; f.workout.repo.seedStarters(user);
 const h=createWorkoutHandler(f);
 let s=f.workout.start(user,{free:true,requestId:randomUUID()});
 f.workout.bindMessage(user,s.id,{channelId:'dm',messageId:'message'}); s=f.workout.active(user);
 const add=button(s,'add'); await h.handle(add); assert.equal(add.result.modal.title,'Find an exercise');
 const search=interaction({isModalSubmit:()=>true,customId:add.result.modal.custom_id,message:{id:'message'},fields:fields({search:'BW squat'})});
 await h.handle(search);
 const menu=search.result.update.components[0].toJSON().components[0];
 assert.equal(menu.options.length,1); assert.equal(menu.options[0].label,'Bodyweight Squat');
 assert.ok(menu.options.length<=25);
 const pick=interaction({isStringSelectMenu:()=>true,customId:menu.custom_id,message:{id:'message'},values:[menu.options[0].value]});
 await h.handle(pick); s=f.workout.active(user); assert.equal(s.exercises.length,1); assert.equal(s.exercises[0].name,'Bodyweight Squat');
 const log=button(s,'log'); await h.handle(log); assert.equal(log.result.modal.components.length,1);
 const empty=interaction({isModalSubmit:()=>true,customId:cid(s,'add-search'),message:{id:'message'},fields:fields({search:'no such exercise xyz'})});
 await h.handle(empty); assert.match(empty.result.update.content,/No matching/);
 const stale=interaction({isModalSubmit:()=>true,customId:add.result.modal.custom_id,message:{id:'message'},fields:fields({search:'bench'})});
 await h.handle(stale); assert.match(stale.result.reply.content,/changed|stale/i);
});
