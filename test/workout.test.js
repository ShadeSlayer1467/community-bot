import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkoutRepository } from '../src/workout/repository.js';
import { WorkoutService } from '../src/workout/service.js';
import { parseResistance, formatResistance } from '../src/workout/model.js';
import { recommend } from '../src/workout/progression.js';
const user = '100000000000000001',
  other = '100000000000000002';
const load = (value = 225, kind = 'total', unit = 'lb') => ({ kind, value, unit, display: '' });
const prescription = (extra = {}) => ({
  sets: 3,
  minReps: 8,
  maxReps: 12,
  resistance: load(),
  rule: { type: 'double', increment: 5, loads: [], chainId: '' },
  note: '',
  ...extra,
});
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-workout-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let now = Date.parse('2026-10-09T10:00:00Z');
  const repo = new WorkoutRepository(dir, [user], { seed: false }),
    service = new WorkoutService(repo, { now: () => now });
  const exercise = service.saveRecord(
    'exercises',
    { name: 'Bench', variation: 'Paused', defaults: prescription() },
    user,
  );
  const program = service.saveRecord(
    'programs',
    {
      name: 'Strength',
      templates: [{ name: 'Push A', exercises: [{ exerciseId: exercise.id, ...prescription() }] }],
    },
    user,
  );
  const start = () => service.start(user, { programId: program.id, requestId: randomUUID() });
  const apply = (s, action, input = {}) =>
    service.mutate(user, s.id, {
      action,
      expectedRevision: s.revision,
      requestId: randomUUID(),
      ...input,
    });
  const finish = (s) => {
    now += 48 * 60000;
    const c = service.confirmation(user, s.id, { action: 'finish', expectedRevision: s.revision });
    return apply(s, 'finish', { confirmationToken: c.token });
  };
  return { dir, repo, service, exercise, program, start, apply, finish, tick: (ms) => (now += ms) };
}
test('exercise/program CRUD, template IDs, ordering, revisions and no cross-user edits', (t) => {
  const f = fixture(t),
    { service, exercise, program } = f;
  const second = service.saveRecord(
    'exercises',
    {
      name: 'Cable Fly',
      variation: 'Setting 9',
      defaults: prescription({ resistance: load(25, 'pair') }),
    },
    user,
  );
  let p = service.saveRecord(
    'programs',
    {
      ...program,
      name: 'New name',
      templates: [
        {
          ...program.templates[0],
          exercises: [
            { exerciseId: second.id, ...second.defaults },
            ...program.templates[0].exercises,
          ],
        },
      ],
    },
    user,
    program.revision,
  );
  assert.deepEqual(
    p.templates[0].exercises.map((e) => e.exerciseId),
    [second.id, exercise.id],
  );
  const stable = p.templates[0].exercises[0].slotId;
  p = service.saveRecord(
    'programs',
    {
      ...p,
      templates: [{ ...p.templates[0], exercises: [...p.templates[0].exercises].reverse() }],
    },
    user,
    p.revision,
  );
  assert.equal(p.templates[0].exercises[1].slotId, stable);
  assert.throws(() => service.saveRecord('programs', p, user, 0), /changed/);
  assert.throws(() => service.saveRecord('exercises', exercise, other, 0), /not found/);
  assert.throws(
    () =>
      service.saveRecord(
        'programs',
        {
          name: 'Broken',
          templates: [{ name: 'x', exercises: [{ exerciseId: 'missing', ...prescription() }] }],
        },
        user,
      ),
    /not found/,
  );
});
test('planned snapshot survives program edits, restart, load carry-forward and duplicate requests', (t) => {
  const f = fixture(t);
  let s = f.start();
  const initial = structuredClone(s.exercises[0].planned);
  s = f.apply(s, 'log', { reps: 10 });
  assert.equal(s.exercises[0].sets[0].resistance.value, 225);
  s = f.apply(s, 'weight', { resistance: load(205) });
  s = f.apply(s, 'log', { reps: 9 });
  assert.equal(s.exercises[0].sets.at(-1).resistance.value, 205);
  const requestId = randomUUID();
  s = f.service.mutate(user, s.id, {
    action: 'repeat',
    expectedRevision: s.revision,
    requestId,
    reps: 8,
  });
  const repeat = f.service.mutate(user, s.id, {
    action: 'repeat',
    expectedRevision: 0,
    requestId,
    reps: 8,
  });
  assert.equal(repeat.exercises[0].sets.length, 3);
  f.service.saveRecord(
    'programs',
    {
      ...f.program,
      templates: [
        {
          ...f.program.templates[0],
          exercises: [{ ...f.program.templates[0].exercises[0], resistance: load(100) }],
        },
      ],
    },
    user,
    f.program.revision,
  );
  const restarted = new WorkoutService(new WorkoutRepository(f.dir, [user], { seed: false }));
  const recovered = restarted.active(user);
  assert.deepEqual(recovered.exercises[0].planned, initial);
  assert.equal(recovered.exercises[0].workingResistance.value, 205);
  assert.equal(restarted.start(user, { free: true }).id, s.id);
  assert.throws(
    () =>
      restarted.mutate(user, s.id, {
        action: 'log',
        reps: 8,
        expectedRevision: 0,
        requestId: randomUUID(),
      }),
    /changed/,
  );
  assert.throws(() => restarted.session(s.id, other), /another user/);
});
test('set correction, notes, invalid reps/loads and confirmation-bound deletion safety', (t) => {
  const f = fixture(t);
  let s = f.apply(f.start(), 'log', { reps: 10 });
  const setId = s.exercises[0].sets[0].id;
  s = f.apply(s, 'edit-set', {
    setId,
    reps: 11,
    resistance: load(230),
    note: 'Paused',
    questionable: true,
    rpe: 8.5,
    rir: 1,
  });
  assert.equal(s.exercises[0].workingResistance.value, 230);
  assert.equal(s.exercises[0].sets[0].rpe, 8.5);
  assert.throws(() => f.apply(s, 'log', { reps: 0 }), /Reps/);
  assert.throws(() => f.apply(s, 'weight', { resistance: load(-1) }), /Resistance/);
  assert.throws(() => f.apply(s, 'log', { reps: 2.5 }), /Reps/);
  assert.throws(() => f.apply(s, 'log', { reps: 10, resistance: load(10000) }), /Resistance/);
  assert.throws(() => f.apply(s, 'delete-set', { setId }), /Confirm/);
  const c = f.service.confirmation(user, s.id, {
    action: 'delete-set',
    targetId: setId,
    expectedRevision: s.revision,
  });
  assert.throws(
    () => f.apply(s, 'delete-set', { setId: 'missing', confirmationToken: c.token }),
    /Confirm/,
  );
  s = f.apply(s, 'delete-set', { setId, confirmationToken: c.token });
  assert.equal(s.exercises[0].sets.length, 0);
  assert.throws(() => f.apply(s, 'finish', { confirmationToken: c.token }), /Confirm/);
  const expires = f.service.confirmation(user, s.id, {
    action: 'abandon',
    expectedRevision: s.revision,
  });
  f.tick(120001);
  assert.throws(() => f.apply(s, 'abandon', { confirmationToken: expires.token }), /expired/);
});
test('confirmation cannot follow state changes, skip/abandon need confirmation and do not erase history', (t) => {
  const f = fixture(t);
  let s = f.start();
  const e = s.exercises[0];
  const c = f.service.confirmation(user, s.id, { action: 'finish', expectedRevision: s.revision });
  s = f.apply(s, 'log', { reps: 8 });
  assert.throws(() => f.apply(s, 'finish', { confirmationToken: c.token }), /state changed/);
  assert.throws(() => f.apply(s, 'skip', { entryId: e.id }), /Confirm/);
  const skip = f.service.confirmation(user, s.id, {
    action: 'skip',
    targetId: e.id,
    expectedRevision: s.revision,
  });
  s = f.apply(s, 'skip', { entryId: e.id, confirmationToken: skip.token });
  assert.equal(s.exercises[0].skipped, true);
  const abandon = f.service.confirmation(user, s.id, {
    action: 'abandon',
    expectedRevision: s.revision,
  });
  s = f.apply(s, 'abandon', { confirmationToken: abandon.token });
  assert.equal(s.state, 'abandoned');
  assert.equal(s.exercises[0].sets.length, 1);
  assert.throws(() => f.apply(s, 'log', { reps: 8 }), /ended/);
});
test('completion persists, previous performance stays distinct, archived histories remain and free mode is unprescribed', (t) => {
  const f = fixture(t);
  let s = f.start();
  s = f.apply(s, 'log', { reps: 10 });
  s = f.finish(s);
  assert.equal(s.state, 'completed');
  assert.equal(s.recommendations[0].outcome, 'MAINTAIN');
  const saved = structuredClone(s);
  const prior = f.service.previous(user, f.exercise.id);
  assert.equal(prior.exercises[0].sets[0].reps, 10);
  assert.equal(prior.exercises[0].previous, undefined);
  let free = f.service.start(user, { free: true });
  free = f.apply(free, 'add-exercise', { exerciseId: f.exercise.id });
  assert.equal(free.exercises[0].planned, null);
  assert.equal(free.exercises[0].previous.sessionId, s.id);
  free = f.apply(free, 'log', { reps: 2, resistance: load(300) });
  free = f.finish(free);
  assert.equal(free.recommendations[0].outcome, 'MAINTAIN');
  assert.match(free.recommendations[0].reason, /Free workout/);
  f.service.saveRecord('exercises', { ...f.exercise, active: false }, user, f.exercise.revision);
  const restarted = new WorkoutService(new WorkoutRepository(f.dir, [], { seed: false }));
  assert.deepEqual(restarted.session(saved.id, user), saved);
  assert.throws(() => restarted.start(user, { programId: f.program.id }), /archived/);
  assert.equal(restarted.previous(user, 'other-variation'), null);
});
function result(reps, p = prescription(), extra = {}) {
  return {
    id: 'entry',
    exerciseId: 'bench',
    planned: p,
    sets: reps.map((n) => ({
      reps: n,
      resistance: p.resistance,
      type: 'normal',
      questionable: false,
    })),
    ...extra,
  };
}
test('transparent double progression distinguishes mastery, fatigue and clearly too hard; incomplete and mixed work cannot progress', () => {
  assert.equal(recommend(result([12, 12, 12])).outcome, 'PROGRESS');
  assert.equal(recommend(result([12, 10, 8])).outcome, 'MAINTAIN');
  assert.equal(recommend(result([12, 10, 7])).outcome, 'MAINTAIN');
  assert.equal(recommend(result([5, 4, 3])).outcome, 'REVIEW');
  assert.equal(recommend(result([12, 12])).outcome, 'MAINTAIN');
  const changed = result([12, 12, 12]);
  changed.sets[2].resistance = load(200);
  assert.equal(recommend(changed).outcome, 'REVIEW');
  assert.equal(
    recommend(result([12, 12, 12], prescription(), { questionable: true })).outcome,
    'QUESTIONABLE',
  );
  assert.equal(recommend(result([12, 12, 12]), { questionable: true }).outcome, 'QUESTIONABLE');
  const questionable = result([12, 12, 12]);
  questionable.sets[2].questionable = true;
  assert.equal(recommend(questionable).proposed, null);
  const warmup = result([12, 12, 12]);
  warmup.sets[0].type = 'warmup';
  assert.equal(recommend(warmup).outcome, 'MAINTAIN');
});
test('configurable increments, available loads, pair/per-side/assistance and bodyweight chains never conflate loads', () => {
  const pair = prescription({
    resistance: load(135, 'pair'),
    rule: { type: 'double', increment: 20, loads: [], chainId: '' },
  });
  assert.equal(recommend(result([12, 12, 12], pair)).proposed.resistance.value, 155);
  assert.equal(recommend(result([12, 12, 12], pair)).proposed.resistance.kind, 'pair');
  const next = prescription({
    rule: { type: 'double', increment: 5, loads: [225, 240, 260], chainId: '' },
  });
  assert.equal(recommend(result([12, 12, 12], next)).proposed.resistance.value, 240);
  const assisted = prescription({
    resistance: load(30, 'assisted'),
    rule: { type: 'double', increment: 5, loads: [], chainId: '' },
  });
  assert.equal(recommend(result([12, 12, 12], assisted)).proposed.resistance.value, 25);
  const bw = prescription({
    minReps: 6,
    maxReps: 10,
    resistance: load(0, 'bodyweight'),
    rule: { type: 'chain', increment: 5, loads: [], chainId: 'push' },
  });
  const context = {
    chains: [{ id: 'push', exerciseIds: ['bench', 'floor'] }],
    exercises: [
      {
        id: 'floor',
        active: true,
        name: 'Floor Push-up',
        defaults: prescription({ resistance: load(0, 'bodyweight') }),
      },
    ],
  };
  assert.equal(recommend(result([8, 6, 6], bw), context).outcome, 'MAINTAIN');
  assert.equal(recommend(result([10, 10, 10], bw), context).proposed.exerciseId, 'floor');
  assert.equal(parseResistance('2x135').kind, 'pair');
  assert.equal(formatResistance(parseResistance('2x135')), '2 × 135 lb');
  for (const input of ['-5', '2x-10', 'NaN', '5001', 'unknown'])
    assert.throws(() => parseResistance(input));
});
test('progression decisions are opt-in, revision checked, idempotent and can accept, keep or override', (t) => {
  const f = fixture(t);
  let s = f.start();
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  assert.equal(f.repo.records('programs')[0].templates[0].exercises[0].resistance.value, 225);
  const requestId = randomUUID();
  const input = {
    entryId: s.exercises[0].id,
    choice: 'accept',
    expectedRevision: s.revision,
    expectedProgramRevision: f.program.revision,
    requestId,
  };
  s = f.service.decide(user, s.id, input);
  assert.equal(f.repo.records('programs')[0].templates[0].exercises[0].resistance.value, 230);
  assert.deepEqual(f.service.decide(user, s.id, input), s);
  const startAgain = f.start();
  assert.equal(startAgain.exercises[0].planned.resistance.value, 230);
  let second = startAgain;
  for (let i = 0; i < 3; i++) second = f.apply(second, 'log', { reps: 12 });
  second = f.finish(second);
  const kept = f.service.decide(user, second.id, {
    entryId: second.exercises[0].id,
    choice: 'keep',
    expectedRevision: second.revision,
    requestId: randomUUID(),
  });
  assert.equal(kept.decisions[0].choice, 'keep');
  assert.equal(f.repo.records('programs')[0].revision, 1);
  let third = f.start();
  third = f.apply(third, 'log', { reps: 5 });
  third = f.finish(third);
  third = f.service.decide(user, third.id, {
    entryId: third.exercises[0].id,
    choice: 'manual',
    manual: { resistance: load(215) },
    expectedRevision: third.revision,
    expectedProgramRevision: 1,
    requestId: randomUUID(),
  });
  assert.equal(f.repo.records('programs')[0].templates[0].exercises[0].resistance.value, 215);
});
test('program edits block stale acceptance; historical corrections recalculate and invalidate decisions without silently reverting program', (t) => {
  const f = fixture(t);
  let s = f.start();
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  let p = f.service.saveRecord('programs', { ...f.program, name: 'Renamed' }, user, 0);
  assert.throws(
    () =>
      f.service.decide(user, s.id, {
        entryId: s.exercises[0].id,
        choice: 'accept',
        expectedRevision: s.revision,
        expectedProgramRevision: 0,
        requestId: randomUUID(),
      }),
    /Program changed/,
  );
  s = f.service.decide(user, s.id, {
    entryId: s.exercises[0].id,
    choice: 'accept',
    expectedRevision: s.revision,
    expectedProgramRevision: p.revision,
    requestId: randomUUID(),
  });
  const input = {
    entryId: s.exercises[0].id,
    setId: s.exercises[0].sets[0].id,
    patch: { reps: 5, questionable: true },
    expectedRevision: s.revision,
    requestId: randomUUID(),
    confirmed: true,
  };
  assert.throws(() => f.service.correct(user, s.id, { ...input, confirmed: false }), /Confirm/);
  s = f.service.correct(user, s.id, input);
  assert.equal(s.recommendations[0].outcome, 'QUESTIONABLE');
  assert.equal(s.decisions[0].valid, false);
  assert.equal(s.corrections.length, 1);
  assert.equal(f.repo.records('programs')[0].templates[0].exercises[0].resistance.value, 230);
  assert.throws(
    () =>
      f.service.decide(user, s.id, {
        entryId: s.exercises[0].id,
        choice: 'accept',
        expectedRevision: s.revision,
        expectedProgramRevision: 2,
        requestId: randomUUID(),
      }),
    /No automatic/,
  );
});
test('ordered chains save and preserve active session progression context; schema and journal recovery fail safely', (t) => {
  const f = fixture(t);
  const low = f.service.saveRecord(
    'exercises',
    { name: 'Low incline', defaults: prescription({ resistance: load(0, 'bodyweight') }) },
    user,
  );
  const high = f.service.saveRecord(
    'exercises',
    { name: 'Floor', defaults: prescription({ resistance: load(0, 'bodyweight') }) },
    user,
  );
  const chain = f.service.saveRecord(
    'chains',
    { name: 'Push-up chain', exerciseIds: [low.id, high.id] },
    user,
  );
  const p = f.service.saveRecord(
    'programs',
    {
      ...f.program,
      templates: [
        {
          ...f.program.templates[0],
          exercises: [
            {
              exerciseId: low.id,
              ...prescription({
                resistance: load(0, 'bodyweight'),
                rule: { type: 'chain', increment: 5, loads: [], chainId: chain.id },
              }),
            },
          ],
        },
      ],
    },
    user,
    0,
  );
  let s = f.start();
  f.service.saveRecord(
    'chains',
    { ...chain, exerciseIds: [high.id, low.id] },
    user,
    chain.revision,
  );
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  assert.equal(s.recommendations[0].proposed.exerciseId, high.id);
  s = f.service.decide(user, s.id, {
    entryId: s.exercises[0].id,
    choice: 'accept',
    expectedRevision: s.revision,
    expectedProgramRevision: p.revision,
    requestId: randomUUID(),
  });
  assert.equal(f.repo.records('programs')[0].templates[0].exercises[0].exerciseId, high.id);
  // Simulate a crash after durable intent, before writes. Restart replays the whole transaction.
  const prefs = { ...f.repo.preferences(), unit: 'kg' };
  f.repo.journal.save({ writes: [{ key: 'preferences', value: prefs }] });
  const restored = new WorkoutRepository(f.dir, [], { seed: false });
  assert.equal(restored.preferences().unit, 'kg');
  assert.equal(restored.journal.read(), null);
  assert.throws(() => restored.getSession('../escape'), /Invalid/);
  fs.writeFileSync(
    path.join(f.dir, 'exercises.json'),
    JSON.stringify({ version: 999, records: [] }),
  );
  assert.throws(() => new WorkoutRepository(f.dir, [], { seed: false }), /schema/);
});

test('history uncertainty at exercise/session scope suppresses progress and current prescription changes require manual review', (t) => {
  const f = fixture(t);
  let s = f.start();
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  const changed = f.service.saveRecord(
    'programs',
    {
      ...f.program,
      templates: [
        {
          ...f.program.templates[0],
          exercises: [{ ...f.program.templates[0].exercises[0], resistance: load(250) }],
        },
      ],
    },
    user,
    0,
  );
  assert.throws(
    () =>
      f.service.decide(user, s.id, {
        entryId: s.exercises[0].id,
        choice: 'accept',
        expectedRevision: s.revision,
        expectedProgramRevision: changed.revision,
        requestId: randomUUID(),
      }),
    /differs/,
  );
  s = f.service.correct(user, s.id, {
    scope: 'exercise',
    entryId: s.exercises[0].id,
    patch: { note: 'Machine position uncertain', questionable: true },
    expectedRevision: s.revision,
    requestId: randomUUID(),
    confirmed: true,
  });
  assert.equal(s.recommendations[0].outcome, 'QUESTIONABLE');
  s = f.service.correct(user, s.id, {
    scope: 'session',
    patch: { note: 'Uncertain day', questionable: true },
    expectedRevision: s.revision,
    requestId: randomUUID(),
    confirmed: true,
  });
  assert.equal(s.questionable, true);
  assert.equal(s.corrections.length, 2);
});

test('multi-file progression recovery completes a partially applied journal transaction', (t) => {
  const f = fixture(t);
  let s = f.start();
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  const programs = f.repo.records('programs');
  programs[0].templates[0].exercises[0].resistance = load(230);
  programs[0].revision++;
  const completed = structuredClone(s);
  completed.decisions.push({
    id: 'recovered-decision',
    entryId: s.exercises[0].id,
    choice: 'accept',
    valid: true,
    programId: f.program.id,
    after: { exerciseId: f.exercise.id, resistance: load(230) },
  });
  completed.revision++;
  const journal = {
    writes: [
      { key: 'programs', value: { version: 1, records: programs } },
      { key: 'session:' + s.id, value: completed },
    ],
  };
  f.repo.journal.save(journal);
  f.repo.stores.get('programs').save(journal.writes[0].value);
  const recovered = new WorkoutRepository(f.dir, [], { seed: false });
  assert.equal(recovered.records('programs')[0].revision, 1);
  assert.equal(recovered.getSession(s.id).decisions[0].id, 'recovered-decision');
  assert.equal(recovered.journal.read(), null);
});

test('a failed session write cannot lose a durable progression intent on the next request', (t) => {
  const f = fixture(t);
  let s = f.start();
  for (let i = 0; i < 3; i++) s = f.apply(s, 'log', { reps: 12 });
  s = f.finish(s);
  const store = f.repo.sessionStore(s.id),
    save = store.save.bind(store);
  let fail = true;
  store.save = (value) => {
    if (fail) {
      fail = false;
      throw new Error('Simulated disk failure');
    }
    return save(value);
  };
  const requestId = randomUUID();
  const decision = {
    entryId: s.exercises[0].id,
    choice: 'accept',
    expectedRevision: s.revision,
    expectedProgramRevision: 0,
    requestId,
  };
  assert.throws(() => f.service.decide(user, s.id, decision), /disk failure/);
  assert.ok(f.repo.journal.read());
  const recovered = f.service.decide(user, s.id, decision);
  assert.equal(recovered.decisions.length, 1);
  assert.equal(f.repo.records('programs')[0].revision, 1);
  assert.equal(f.repo.journal.read(), null);
});
