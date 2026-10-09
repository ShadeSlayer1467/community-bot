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
async function explicitlyStart(h, slash, messageId = 'message') {
  const shared={user:slash.user,context:slash.context,channel:slash.channel,channelId:slash.channelId,inGuild:slash.inGuild,guildId:slash.guildId,message:{id:messageId}};
  let payload=slash.result.reply;
  const menu=payload.components?.flatMap(r=>r.toJSON().components).find(c=>c.type===3);
  if(menu) {
    const select=interaction({...shared,isStringSelectMenu:()=>true,customId:menu.custom_id,values:[menu.options[0].value]});
    await h.handle(select);payload=select.result.update;
  }
  const start=payload.components.flatMap(r=>r.toJSON().components).find(c=>['Start Workout','Start Free Workout'].includes(c.label));
  const confirm=interaction({...shared,isButton:()=>true,customId:start.custom_id});await h.handle(confirm);return confirm;
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
  assert.equal(f.workout.active(user), null);
  await explicitlyStart(h, slash);
  assert.equal(sends, 0);
  let s = f.workout.active(user);
  assert.equal(s.message.messageId, 'message');
  const resume = interaction({
    isChatInputCommand: () => true,
    commandName: 'workout',
    channel,
    options: { getSubcommand: () => 'resume' },
  });
  await h.handle(resume);
  assert.equal(sends, 0);
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
    ['today', 'start', 'resume', 'history', 'exercise'],
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
  const chooser=interaction({isChatInputCommand:()=>true,commandName:'workout',channel,options:{getSubcommand:()=> 'start',getBoolean:()=>true}});
  await h.handle(chooser);
  const customId=chooser.result.reply.components[0].toJSON().components[0].custom_id;
  const first=interaction({isButton:()=>true,customId,channel,message:{id:'selection-message'}});
  const second=interaction({isButton:()=>true,customId,channel,message:{id:'selection-message'}});
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
  const started = await explicitlyStart(h, slash, 'server-message');
  sent = started.result.update;
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
  assert.equal(f.workout.repo.preferences().plans[user], undefined);
  const definition = workoutDefinition();
  assert.equal(definition.options.find((o) => o.name === 'today').options?.length ?? 0, 0);
  assert.deepEqual(
    definition.options.find((o) => o.name === 'start').options.map((o) => o.name),
    ['free'],
  );
});
test('one program/several templates previews without changing next preferences', async (t) => {
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
  assert.ok(menuOf(saved.result.reply).options.some(o=>o.label==='Strength B'));
  assert.equal(f.workout.repo.preferences().plans[user],undefined);
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
  assert.equal(f.workout.active(user),null);
  await explicitlyStart(h,free,'selection-message');
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

function recordedHistory(f, count = 1, setCount = 5) {
 const sessions=[];
 for(let day=0;day<count;day++) {
  const session=f.workout.start(user,{free:true,requestId:randomUUID()});
  session.state='completed'; session.startedAt=new Date(Date.UTC(2025,0,day+1)).toISOString(); session.finishedAt=session.startedAt;
  session.questionable=day===0;
  session.exercises=[{id:randomUUID(),exerciseId:f.exercise.id,name:'Bench',variation:'Paused',notes:'',workingResistance:p.resistance,planned:null,slotId:null,skipped:false,questionable:false,note:'',previous:null,
   sets:Array.from({length:setCount},(_,index)=>({id:randomUUID(),order:index+1,type:['normal','warmup','dropset','amrap','partials'][index%5],reps:6+index,
   resistance:index%4===0?{kind:'pair',value:135,unit:'lb',display:''}:index%4===1?{kind:'stack',value:30,unit:'kg',display:''}:index%4===2?{kind:'bodyweight',value:0,unit:'lb',display:''}:{kind:'total',value:225,unit:'lb',display:''},
   questionable:index===2,note:'',rpe:null,rir:null,loggedAt:session.startedAt}))}];
  f.workout.repo.commit([{key:'session:'+session.id,value:session}]); sessions.push(session);
 }
 return sessions;
}
const historySlash=(name=null)=>interaction({isChatInputCommand:()=>true,commandName:'workout',options:{getSubcommand:()=> 'exercise',getString:()=>name}});
const historyAction=(payload,label,overrides={})=>{
 const component=payload.components.flatMap(r=>r.toJSON().components).find(c=>c.label===label);
 return interaction({isButton:()=>true,customId:component.custom_id,message:{id:'history-message'},...overrides});
};
test('exercise history searches aliases, includes archived exercises and every actual resistance/set type and questionable marker',async t=>{
 const f=fixture(t); recordedHistory(f);
 f.workout.saveRecord('exercises',{...f.exercise,aliases:['flat bench'],active:false},user,f.exercise.revision);
 const before=JSON.stringify(f.workout.repo.sessions());
 const h=createWorkoutHandler(f), slash=historySlash('flat bench'); await h.handle(slash);
 const embed=slash.result.reply.embeds[0].toJSON();
 assert.match(embed.title,/Bench.*HISTORY/); assert.match(embed.description,/Archived/);
 const text=embed.fields.map(f=>f.name+'\n'+f.value).join('\n');
 for(const pattern of [/2025-01-01/,/2 × 135 lb × 6/,/30 kg stack × 7/,/BW × 8/,/225 lb × 9/,/\[normal\]/,/\[warmup\]/,/\[dropset\]/,/\[amrap\]/,/\[partials\]/,/⚠ questionable/]) assert.match(text,pattern);
 assert.equal(JSON.stringify(f.workout.repo.sessions()),before);
 assert.deepEqual(workoutDefinition().options.find(s=>s.name==='exercise').options.map(o=>o.name),['name']);
});
test('exercise history search selection, no matches, change exercise and newer/older navigation remain user/channel isolated',async t=>{
 const f=fixture(t); recordedHistory(f,10);
 const h=createWorkoutHandler(f), slash=historySlash(); await h.handle(slash);
 const search=historyAction(slash.result.reply,'Search by name or alias'); await h.handle(search);
 const query=interaction({isModalSubmit:()=>true,customId:search.result.modal.custom_id,message:{id:'history-message'},fields:fields({search:'Bench'})}); await h.handle(query);
 let payload=query.result.update; assert.match(payload.embeds[0].toJSON().footer.text,/Page 1\/3/);
 const otherUser=historyAction(payload,'Older',{user:{id:other}}); f.workout.repo.commit([{key:'preferences',value:{...f.workout.repo.preferences(),allowedUserIds:[user,other]}}]);
 await h.handle(otherUser); assert.match(otherUser.result.reply.content,/another user/);
 const otherChannel=historyAction(payload,'Older',{channelId:'other-dm'}); await h.handle(otherChannel); assert.match(otherChannel.result.reply.content,/another user or channel/);
 const older=historyAction(payload,'Older'); await h.handle(older); payload=older.result.update;
 assert.match(payload.embeds[0].toJSON().footer.text,/Page 2\/3/);
 const newer=historyAction(payload,'Newer'); await h.handle(newer); assert.match(newer.result.update.embeds[0].toJSON().footer.text,/Page 1\/3/);
 const different=historyAction(payload,'Choose another exercise'); await h.handle(different); assert.ok(different.result.update.components[0].toJSON().components[0].options);
 const menu=different.result.update.components[0].toJSON().components[0];
 const select=interaction({isStringSelectMenu:()=>true,customId:menu.custom_id,message:{id:'history-message'},values:[f.exercise.id]}); await h.handle(select); assert.ok(select.result.update.embeds.length);
 const noMatchSearch=historyAction(different.result.update,'Search by name or alias'); await h.handle(noMatchSearch);
 const noMatch=interaction({isModalSubmit:()=>true,customId:noMatchSearch.result.modal.custom_id,message:{id:'history-message'},fields:fields({search:'zzzz nonexistent'})}); await h.handle(noMatch); assert.match(noMatch.result.update.content,/No matching/);
 const restarted=createWorkoutHandler(f); const expired=historyAction(payload,'Older'); await restarted.handle(expired); assert.match(expired.result.reply.content,/expired/);
});
test('exercise history splits large sessions without losing sets and respects Discord field and aggregate limits',async t=>{
 const f=fixture(t); const sessions=recordedHistory(f,2,100);
 const h=createWorkoutHandler(f), slash=historySlash('Bench'); await h.handle(slash);
 let payload=slash.result.reply; const lines=[];
 for(let page=0;page<20;page++) {
  const embed=payload.embeds[0].toJSON();
  let length=(embed.title?.length||0)+(embed.description?.length||0)+(embed.footer?.text.length||0);
  for(const field of embed.fields||[]) { assert.ok(field.name.length<=256); assert.ok(field.value.length<=1024); length+=field.name.length+field.value.length;lines.push(...field.value.split('\n')); }
  assert.ok(length<=6000);
  const buttonData=payload.components[0].toJSON().components.find(c=>c.label==='Older');
  if(buttonData.disabled) break;
  const next=historyAction(payload,'Older'); await h.handle(next);payload=next.result.update;
 }
 assert.equal(lines.length,200);
 assert.equal(lines.filter(l=>l.startsWith('100.')).length,2);
 assert.deepEqual(f.workout.repo.sessions(),sessions.reverse());
});
test('exercise history excludes active/abandoned sessions and foreign user data while handling no recorded sets and missing catalog entries',async t=>{
 const f=fixture(t); const h=createWorkoutHandler(f);
 let empty=historySlash('Bench');await h.handle(empty);assert.match(empty.result.reply.embeds[0].toJSON().description,/No completed sets/);
 const history=recordedHistory(f);
 const foreign=structuredClone(history[0]);foreign.id=randomUUID();foreign.userId=other; foreign.exercises[0].sets[0].reps=999;
 f.workout.repo.commit([{key:'session:'+foreign.id,value:foreign}]);
 f.workout.start(user,{free:true,requestId:randomUUID()});
 assert.equal(f.workout.exerciseHistory(user,f.exercise.id).sessions.length,1);
 assert.throws(()=>f.workout.exerciseHistory(other,f.exercise.id+'wrong'),/not found/);
 f.workout.repo.commit([{key:'exercises',value:{version:1,records:[]}}]);
 assert.equal(f.workout.historyExercises(user)[0].name,'Bench');
 empty=historySlash('Bench');await h.handle(empty);assert.match(empty.result.reply.embeds[0].toJSON().description,/historical/);
 assert.doesNotMatch(JSON.stringify(empty.result.reply.embeds[0].toJSON()),/999/);
 const active=f.workout.active(user); active.state='abandoned';f.workout.repo.commit([{key:'session:'+active.id,value:active}]);
 assert.equal(f.workout.exerciseHistory(user,f.exercise.id).sessions.length,1);
});

test('exercise history large-library choices paginate and name search narrows distinct variations without IDs',async t=>{
 const f=fixture(t); f.workout.repo.seedEnabled=true; f.workout.repo.seedStarters(user);
 const h=createWorkoutHandler(f), slash=historySlash(); await h.handle(slash);
 assert.equal(slash.result.reply.components[0].toJSON().components[0].options.length,25);
 const next=historyAction(slash.result.reply,'More choices'); await h.handle(next);
 const first=slash.result.reply.components[0].toJSON().components[0].options[0].value;
 const second=next.result.update.components[0].toJSON().components[0].options[0].value;
 assert.notEqual(first,second);
 const search=historySlash('bench');await h.handle(search);
 const options=search.result.reply.components[0].toJSON().components[0].options;
 assert.ok(options.length>1&&options.length<=25);
 assert.ok(options.some(o=>o.label==='Incline Barbell Bench Press'));
 const invalid=interaction({isStringSelectMenu:()=>true,customId:search.result.reply.components[0].toJSON().components[0].custom_id,message:{id:'history-message'},values:['not-a-real-exercise']});
 await h.handle(invalid); assert.match(invalid.result.reply.content,/Invalid exercise history/);
});

const startSlash=(free=false,overrides={})=>interaction({isChatInputCommand:()=>true,commandName:'workout',options:{getSubcommand:()=> 'start',getBoolean:()=>free},...overrides});
const draftSubmit=(modal,values)=>interaction({isModalSubmit:()=>true,customId:modal.custom_id,message:{id:'history-message'},fields:fields(values)});
async function addDraftExercise(h,payload,exercise,values) {
 const add=historyAction(payload,'Add Exercise');await h.handle(add);
 const search=draftSubmit(add.result.modal,{search:exercise.name});await h.handle(search);
 const menu=search.result.update.components[0].toJSON().components[0];
 const choice=chooseOption(menu,exercise.id,{message:{id:'history-message'}});await h.handle(choice);
 const submit=draftSubmit(choice.result.modal,values);await h.handle(submit);return {submit,modal:choice.result.modal};
}
test('start chooser exposes Strength A/B and next hint; previews never change preferences; only Start creates a session',async t=>{
 const f=fixture(t);let program=severalTemplates(f);
 program=f.workout.saveRecord('programs',{...program,templates:program.templates.map((p,index)=>({...p,name:index?'Strength B':'Strength A'}))},user,program.revision);
 f.workout.setNext(user,program.id,program.templates[0].id,program.revision);
 const h=createWorkoutHandler(f),slash=startSlash();const before=JSON.stringify(f.workout.repo.preferences());await h.handle(slash);
 assert.equal(f.workout.active(user),null);assert.match(slash.result.reply.content,/Current next workout.*Strength A/);
 const menu=menuOf(slash.result.reply);assert.deepEqual(menu.options.map(o=>o.label),['Program — Strength A','Program — Strength B']);
 const select=chooseOption(menu,menu.options[1].value);await h.handle(select);
 assert.equal(select.result.update.embeds[0].toJSON().title,'Strength B');assert.equal(f.workout.active(user),null);assert.equal(JSON.stringify(f.workout.repo.preferences()),before);
 const start=historyAction(select.result.update,'Start Workout');await h.handle(start);const session=f.workout.active(user);assert.equal(session.name,'Strength B');
 assert.equal(f.workout.repo.sessions().length,1);assert.equal(f.workout.repo.preferences().plans[user].templateId,program.templates[1].id);
 const resumeChannel={type:1,messages:{fetch:async()=>({author:{id:'bot'},edit:async()=>{}})}};
 const duplicate=historyAction(select.result.update,'Start Workout',{channel:resumeChannel});await h.handle(duplicate);
 assert.equal(f.workout.active(user).id,session.id);assert.equal(f.workout.repo.sessions().length,1);
 const resume=startSlash();await h.handle(resume);assert.match(resume.result.reply.content,/active workout/);assert.equal(resume.result.reply.components[0].toJSON().components[0].label,'Resume Workout');
 assert.deepEqual(f.workout.repo.sessions(),[session]);
});
test('free workout is available without any program and requires Start Free confirmation',async t=>{
 const f=fixture(t);f.workout.repo.commit([{key:'programs',value:{version:1,records:[]}}]);
 const h=createWorkoutHandler(f),slash=startSlash();await h.handle(slash);assert.equal(f.workout.active(user),null);
 const free=historyAction(slash.result.reply,'Free Workout');await h.handle(free);assert.equal(f.workout.active(user),null);
 const confirm=historyAction(free.result.update,'Start Free Workout',{channel:{type:1,send:async()=>({id:'free-message'})}});await h.handle(confirm);
 assert.equal(f.workout.active(user).mode,'free');assert.ok(confirm.result.edit);
});
test('Discord builder creates a named program/template, edits order/prescriptions, saves once and returns preview without starting',async t=>{
 const f=fixture(t);const historical=recordedHistory(f);const existing=structuredClone(f.program);
 const h=createWorkoutHandler(f),slash=startSlash();await h.handle(slash);
 const create=historyAction(slash.result.reply,'Create Saved Workout');await h.handle(create);
 const newProgram=historyAction(create.result.update,'New program');await h.handle(newProgram);
 const name=draftSubmit(newProgram.result.modal,{program:'Mobile Program',workout:'Mobile Strength'});await h.handle(name);
 assert.equal(f.workout.catalog(user).programs.length,1);
 const first=await addDraftExercise(h,name.result.update,f.exercise,{sets:'3',min:'6',max:'10',resistance:'135 lb',note:'Controlled reps'});
 const second=await addDraftExercise(h,first.submit.result.update,f.exercise,{sets:'2',min:'8',max:'12',resistance:'BW',note:'Second slot'});
 const stale=draftSubmit(second.modal,{sets:'2',min:'8',max:'12',resistance:'BW'});await h.handle(stale);assert.match(stale.result.reply.content,/draft changed/);
 const entries=menuOf(second.submit.result.update);
 const entry=chooseOption(entries,'1',{message:{id:'history-message'}});await h.handle(entry);
 const up=historyAction(entry.result.update,'Move Up');await h.handle(up);
 const edit=historyAction(up.result.update,'Edit Prescription');await h.handle(edit);
 const edited=draftSubmit(edit.result.modal,{sets:'2',min:'9',max:'13',resistance:'BW',note:'Edited note'});await h.handle(edited);
 const save=historyAction(edited.result.update,'Save Workout');await h.handle(save);
 assert.equal(save.result.update.embeds[0].toJSON().title,'Mobile Strength');assert.equal(f.workout.active(user),null);
 const program=f.workout.catalog(user).programs.find(p=>p.name==='Mobile Program');assert.equal(program.templates.length,1);
 assert.deepEqual(program.templates[0].exercises.map(e=>[e.sets,e.minReps,e.maxReps]),[[2,9,13],[3,6,10]]);
 assert.equal(program.templates[0].exercises[1].resistance.value,135);
 assert.deepEqual(f.workout.owned('programs',existing.id,user),existing);assert.deepEqual(f.workout.repo.sessions(),historical);
 assert.equal(f.workout.repo.preferences().plans[user],undefined);
 const duplicate=historyAction(edited.result.update,'Save Workout');await h.handle(duplicate);assert.equal(f.workout.catalog(user).programs.length,2);
 const next=startSlash();await h.handle(next);assert.ok(menuOf(next.result.reply).options.some(o=>o.label==='Mobile Program — Mobile Strength'));
});
test('builder appends through existing program service, preserves active/history and rejects stale program/library and foreign drafts',async t=>{
 const f=fixture(t);const active=f.workout.start(user,{free:true});
 // A planned preview also provides Create Saved Workout while an active session exists.
 const h=createWorkoutHandler(f),today=todayInteraction();await h.handle(today);
 const create=historyAction(today.result.reply,'Create Saved Workout');await h.handle(create);
 const menu=menuOf(create.result.update);const program=chooseOption(menu,f.program.id,{message:{id:'history-message'}});await h.handle(program);
 const named=draftSubmit(program.result.modal,{workout:'New Plan'});await h.handle(named);
 const added=await addDraftExercise(h,named.result.update,f.exercise,{sets:'2',min:'5',max:'8',resistance:'235 lb'});
 f.workout.saveRecord('programs',{...f.program,name:'Changed Program'},user,f.program.revision);
 const save=historyAction(added.submit.result.update,'Save Workout');await h.handle(save);assert.match(save.result.reply.content,/Program changed/);
 assert.equal(f.workout.catalog(user).programs[0].templates.length,1);assert.deepEqual(f.workout.active(user),active);
 f.workout.savePreferences({allowedUserIds:[user,other]});
 const wrong=historyAction(added.submit.result.update,'Save Workout',{user:{id:other}});await h.handle(wrong);assert.match(wrong.result.reply.content,/another user/);
 const foreign=historyAction(added.submit.result.update,'Save Workout',{channelId:'other-channel'});await h.handle(foreign);assert.match(foreign.result.reply.content,/another user or channel/);
 f.workout.saveRecord('exercises',{...f.exercise,active:false},user,f.exercise.revision);
 const archived=historyAction(added.submit.result.update,'Save Workout');await h.handle(archived);assert.match(archived.result.reply.content,/Exercise changed/);
 const restarted=createWorkoutHandler(f);const expired=historyAction(added.submit.result.update,'Save Workout');await restarted.handle(expired);assert.match(expired.result.reply.content,/expired/);
});

test('saving a template in an existing program appends without altering earlier prescriptions or active sessions',async t=>{
 const f=fixture(t),h=createWorkoutHandler(f);const existing=structuredClone(f.program);const active=f.workout.start(user,{free:true});
 const today=todayInteraction();await h.handle(today);
 const create=historyAction(today.result.reply,'Create Saved Workout');await h.handle(create);
 const chosen=chooseOption(menuOf(create.result.update),f.program.id,{message:{id:'history-message'}});await h.handle(chosen);
 const named=draftSubmit(chosen.result.modal,{workout:'Strength C'});await h.handle(named);
 const badAdd=historyAction(named.result.update,'Add Exercise');await h.handle(badAdd);
 const searched=draftSubmit(badAdd.result.modal,{search:f.exercise.name});await h.handle(searched);
 const ex=chooseOption(menuOf(searched.result.update),f.exercise.id,{message:{id:'history-message'}});await h.handle(ex);
 const invalid=draftSubmit(ex.result.modal,{sets:'0',min:'8',max:'6'});await h.handle(invalid);assert.match(invalid.result.reply.content,/Target sets/);
 const valid=draftSubmit(ex.result.modal,{sets:'4',min:'8',max:'12',resistance:'stack:30 kg',note:'New prescription'});await h.handle(valid);
 const save=historyAction(valid.result.update,'Save Workout');await h.handle(save);assert.equal(save.result.update.embeds[0].toJSON().title,'Strength C');
 const program=f.workout.owned('programs',f.program.id,user);assert.equal(program.templates.length,2);assert.deepEqual(program.templates[0],existing.templates[0]);
 assert.equal(program.templates[1].exercises[0].resistance.kind,'stack');assert.equal(program.templates[1].exercises[0].resistance.unit,'kg');
 assert.deepEqual(f.workout.active(user),active);
});

test('used Start confirmations cannot create new sessions after completion/abandon, and cross-channel or expired previews fail cleanly',async t=>{
 const f=fixture(t),h=createWorkoutHandler(f),today=todayInteraction();await h.handle(today);
 const foreign=historyAction(today.result.reply,'Start Workout',{channelId:'wrong-channel'});await h.handle(foreign);assert.match(foreign.result.reply.content,/another user or channel/);assert.equal(f.workout.active(user),null);
 const start=historyAction(today.result.reply,'Start Workout');await h.handle(start);const session=f.workout.active(user);
 session.state='abandoned';f.workout.repo.commit([{key:'session:'+session.id,value:session}]);
 const reuse=historyAction(today.result.reply,'Start Workout');await h.handle(reuse);assert.match(reuse.result.reply.content,/already used/);assert.equal(f.workout.repo.sessions().length,1);
 const reopened=todayInteraction();await h.handle(reopened);const restarted=createWorkoutHandler(f);const expired=historyAction(reopened.result.reply,'Start Workout');await restarted.handle(expired);assert.match(expired.result.reply.content,/expired/);
 const free=startSlash(true);await h.handle(free);const freeStart=historyAction(free.result.reply,'Start Free Workout',{channel:{type:1,send:async()=>({id:'free-message'})}});await h.handle(freeStart);
 const freeSession=f.workout.active(user);freeSession.state='completed';freeSession.finishedAt=freeSession.startedAt;f.workout.repo.commit([{key:'session:'+freeSession.id,value:freeSession}]);
 const freeReuse=historyAction(free.result.reply,'Start Free Workout');await h.handle(freeReuse);assert.match(freeReuse.result.reply.content,/already used/);assert.equal(f.workout.repo.sessions().length,2);
});
