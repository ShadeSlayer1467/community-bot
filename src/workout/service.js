import { randomUUID, randomBytes } from 'node:crypto';
import {
  exercise,
  program,
  chain,
  resistance,
  setData,
  text,
  user,
  clone,
  envelope,
  validatePreferences,
  boolean,
} from './model.js';
import { recommend } from './progression.js';
const id = () => randomUUID();
export class WorkoutService {
  constructor(repository, { now = () => Date.now() } = {}) {
    this.repo = repository;
    this.now = now;
    this.confirmations = new Map();
  }
  stamp() {
    return new Date(this.now()).toISOString();
  }
  catalog(userId) {
    user(userId);
    this.repo.seedStarters(userId);
    return {
      exercises: this.repo.records('exercises').filter((e) => e.userId === userId),
      programs: this.repo.records('programs').filter((p) => p.userId === userId),
      chains: this.repo.records('chains').filter((c) => c.userId === userId),
      preferences: this.repo.preferences(),
    };
  }
  allowed(userId) {
    return this.repo.preferences().allowedUserIds.includes(userId);
  }
  owned(key, recordId, userId) {
    const item = this.repo.records(key).find((e) => e.id === recordId && e.userId === userId);
    if (!item) throw new Error(`${key}: record not found for this user.`);
    return item;
  }
  saveRecord(key, input, userId, expectedRevision) {
    user(userId);
    const records = this.repo.records(key);
    const old = input.id ? this.owned(key, input.id, userId) : null;
    if (old && old.revision !== expectedRevision)
      throw new Error('Catalog changed. Refresh before saving.');
    const normalized = {
      ...input,
      id: old?.id ?? id(),
      userId,
      revision: (old?.revision ?? -1) + 1,
    };
    if (key === 'programs')
      normalized.templates = (input.templates ?? []).map((t) => ({
        ...t,
        id: t.id || id(),
        exercises: (t.exercises ?? []).map((e) => ({ ...e, slotId: e.slotId || id() })),
      }));
    const validate = { exercises: exercise, programs: program, chains: chain }[key];
    if (!validate) throw new Error('Unknown catalog.');
    const value = validate(normalized);
    if (key === 'programs')
      for (const t of value.templates)
        for (const entry of t.exercises) {
          const ex = this.owned('exercises', entry.exerciseId, userId);
          if (
            !ex.active &&
            !old?.templates.some((t) => t.exercises.some((e) => e.exerciseId === ex.id))
          )
            throw new Error('Archived exercise cannot be newly added to a program.');
          if (entry.rule.type === 'chain')
            this.checkChain(entry.rule.chainId, entry.exerciseId, userId);
        }
    if (key === 'chains')
      for (const exerciseId of value.exerciseIds) this.owned('exercises', exerciseId, userId);
    if (key === 'exercises' && value.defaults.rule.type === 'chain' && value.defaults.rule.chainId)
      this.checkChain(value.defaults.rule.chainId, value.id, userId);
    this.repo.commit([
      { key, value: envelope([...records.filter((r) => r.id !== value.id), value]) },
    ]);
    return value;
  }
  checkChain(chainId, exerciseId, userId) {
    const c = this.owned('chains', chainId, userId);
    if (!c.exerciseIds.includes(exerciseId))
      throw new Error('Exercise is not a member of that progression chain.');
  }
  savePreferences(input) {
    const old = this.repo.preferences();
    const next = validatePreferences({ ...old, ...input, version: 1 });
    for (const [userId, plan] of Object.entries(next.plans)) {
      const p = this.owned('programs', plan.programId, userId);
      if (!p.templates.some((t) => t.id === plan.templateId))
        throw new Error('Planned workout does not exist.');
    }
    this.repo.commit([{ key: 'preferences', value: next }]);
    return next;
  }
  selection(userId, { ignoreSaved = false, programId, templateId, expectedProgramRevision } = {}) {
    const programs = this.catalog(userId).programs.filter((p) => p.active);
    const saved = this.repo.preferences().plans[userId];
    if (!programId && !ignoreSaved && saved) {
      const p = programs.find((p) => p.id === saved.programId),
        t = p?.templates.find((t) => t.id === saved.templateId);
      if (p && t) return { kind: 'resolved', program: p, template: t };
    }
    if (programId && !programs.some((p) => p.id === programId))
      throw new Error('Plan changed. Choose/review again with /workout today.');
    if (!programs.length) return { kind: 'empty' };
    let p;
    if (programId) {
      p = programs.find((p) => p.id === programId);
      if (!p || (expectedProgramRevision !== undefined && p.revision !== expectedProgramRevision))
        throw new Error('Plan changed. Choose/review again with /workout today.');
    } else if (programs.length === 1) p = programs[0];
    else return { kind: 'programs', programs };
    if (templateId) {
      const t = p.templates.find((t) => t.id === templateId);
      if (!t) throw new Error('Plan changed. Choose/review again with /workout today.');
      return { kind: 'resolved', program: p, template: t };
    }
    if (p.templates.length === 1) return { kind: 'resolved', program: p, template: p.templates[0] };
    return { kind: 'templates', program: p, templates: p.templates };
  }
  setNext(userId, programId, templateId, expectedProgramRevision) {
    const plan = this.selection(userId, { programId, templateId, expectedProgramRevision });
    if (plan.kind !== 'resolved') throw new Error('Choose an active program and planned workout.');
    const prefs = this.repo.preferences();
    prefs.plans[userId] = { programId, templateId };
    this.repo.commit([{ key: 'preferences', value: prefs }]);
    return plan;
  }
  planned(userId, programId, templateId) {
    const plan = this.selection(userId, { programId, templateId });
    if (plan.kind === 'empty')
      throw new Error('Create or activate a program in Workout → Programs.');
    if (plan.kind !== 'resolved')
      throw new Error(
        'Choose a workout with /workout today or set your next workout in Workout → Programs.',
      );
    return { program: plan.program, template: plan.template };
  }
  active(userId) {
    return this.repo.sessions().find((s) => s.userId === userId && s.state === 'active') ?? null;
  }
  session(sessionId, userId) {
    const s = this.repo.getSession(sessionId);
    if (s.userId !== userId) throw new Error('Workout belongs to another user.');
    return s;
  }
  previous(userId, exerciseId, excludeId) {
    const session = this.repo
      .sessions()
      .filter((s) => s.userId === userId && s.state === 'completed' && s.id !== excludeId)
      .find((s) => s.exercises.some((e) => e.exerciseId === exerciseId && e.sets.length));
    return session
      ? {
          sessionId: session.id,
          date: session.startedAt,
          questionable: session.questionable,
          exercises: session.exercises
            .filter((e) => e.exerciseId === exerciseId)
            .map((e) => ({
              name: e.name,
              variation: e.variation,
              questionable: e.questionable,
              sets: clone(e.sets),
            })),
        }
      : null;
  }
  progressionContext(userId, entries) {
    const chainIds = new Set(entries.map((e) => e.planned?.rule.chainId).filter(Boolean));
    const chains = this.repo
      .records('chains')
      .filter((c) => c.userId === userId && chainIds.has(c.id));
    const exerciseIds = new Set(chains.flatMap((c) => c.exerciseIds));
    const exercises = this.repo
      .records('exercises')
      .filter((e) => e.userId === userId && exerciseIds.has(e.id))
      .map((e) => ({
        id: e.id,
        name: e.name,
        active: e.active,
        defaults: { resistance: clone(e.defaults.resistance) },
      }));
    return { chains, exercises };
  }
  snapshot(userId, planned) {
    const ex = this.owned('exercises', planned.exerciseId, userId);
    if (!ex.active)
      throw new Error(`Exercise archived: ${ex.name}. Edit the program before starting.`);
    const { slotId, exerciseId, ...p } = planned;
    return {
      id: id(),
      exerciseId,
      name: ex.name,
      variation: ex.variation,
      notes: ex.notes,
      planned: clone(p),
      slotId,
      workingResistance: clone(p.resistance),
      sets: [],
      skipped: false,
      questionable: false,
      note: '',
      previous: this.previous(userId, exerciseId),
    };
  }
  start(userId, { free = false, programId, templateId, requestId } = {}) {
    user(userId);
    const active = this.active(userId);
    if (active) return active; // Start/resume is naturally idempotent: never replace a workout.
    if (requestId) {
      const prior = this.repo
        .sessions()
        .find((s) => s.userId === userId && s.startRequestId === requestId);
      if (prior) return prior;
    }
    const plan = free ? null : this.planned(userId, programId, templateId);
    const s = {
      version: 1,
      id: id(),
      userId,
      state: 'active',
      revision: 0,
      mode: free ? 'free' : 'planned',
      programId: plan?.program.id ?? null,
      programRevision: plan?.program.revision ?? null,
      templateId: plan?.template.id ?? null,
      name: plan?.template.name ?? 'Free workout',
      startedAt: this.stamp(),
      finishedAt: null,
      currentIndex: 0,
      exercises: plan ? plan.template.exercises.map((e) => this.snapshot(userId, e)) : [],
      questionable: false,
      note: '',
      recommendations: [],
      decisions: [],
      corrections: [],
      requests: [],
      progressionContext: null,
      startRequestId: requestId ?? null,
      message: null,
    };
    s.progressionContext = this.progressionContext(userId, s.exercises);
    this.repo.commit([{ key: 'session:' + s.id, value: s }]);
    return s;
  }
  assertRevision(s, expectedRevision) {
    if (s.revision !== expectedRevision)
      throw new Error('Workout changed. Refresh or use /workout resume before retrying.');
  }
  confirmation(userId, sessionId, { action, targetId, expectedRevision }) {
    const s = this.session(sessionId, userId);
    this.assertRevision(s, expectedRevision);
    if (!['delete-set', 'skip', 'finish', 'abandon'].includes(action) || s.state !== 'active')
      throw new Error('Invalid confirmation action.');
    const token = randomBytes(12).toString('hex');
    for (const [key, value] of this.confirmations)
      if (value.until < this.now()) this.confirmations.delete(key);
    this.confirmations.set(token, {
      userId,
      sessionId,
      action,
      targetId: targetId ?? null,
      revision: s.revision,
      until: this.now() + 120000,
    });
    return { token, expiresAt: this.now() + 120000 };
  }
  checkConfirmation(s, userId, action, targetId, token) {
    const c = this.confirmations.get(token);
    if (
      !c ||
      c.until < this.now() ||
      c.userId !== userId ||
      c.sessionId !== s.id ||
      c.action !== action ||
      c.targetId !== (targetId ?? null) ||
      c.revision !== s.revision
    )
      throw new Error('Confirm this action again; confirmation expired or state changed.');
  }
  mutate(userId, sessionId, { action, expectedRevision, requestId, confirmationToken, ...input }) {
    const s = this.session(sessionId, userId);
    if (!requestId || typeof requestId !== 'string' || requestId.length > 100)
      throw new Error('A unique request ID is required.');
    if (s.requests.includes(requestId)) return s;
    this.assertRevision(s, expectedRevision);
    if (s.state !== 'active')
      throw new Error('This workout has ended. Use history corrections instead.');
    const entry = input.entryId
      ? s.exercises.find((e) => e.id === input.entryId)
      : s.exercises[s.currentIndex];
    const destructive = ['delete-set', 'skip', 'finish', 'abandon'].includes(action);
    const targetId = action === 'delete-set' ? input.setId : action === 'skip' ? entry?.id : null;
    if (destructive) this.checkConfirmation(s, userId, action, targetId, confirmationToken);
    if (
      ['log', 'repeat', 'weight', 'edit-set', 'delete-set', 'skip', 'exercise-note'].includes(
        action,
      ) &&
      !entry
    )
      throw new Error('Add or choose an exercise first.');
    switch (action) {
      case 'add-exercise': {
        if (s.exercises.length >= 50) throw new Error('At most 50 exercises.');
        const ex = this.owned('exercises', input.exerciseId, userId);
        if (!ex.active) throw new Error('Exercise archived.');
        s.exercises.push({
          id: id(),
          exerciseId: ex.id,
          name: ex.name,
          variation: ex.variation,
          notes: ex.notes,
          planned: null,
          slotId: null,
          workingResistance: clone(ex.defaults.resistance),
          sets: [],
          skipped: false,
          questionable: false,
          note: '',
          previous: this.previous(userId, ex.id, s.id),
        });
        s.currentIndex = s.exercises.length - 1;
        break;
      }
      case 'navigate': {
        const index = input.index;
        if (!Number.isInteger(index) || index < 0 || index >= s.exercises.length)
          throw new Error('Exercise index out of range.');
        s.currentIndex = index;
        break;
      }
      case 'weight':
        entry.workingResistance = resistance(input.resistance);
        break;
      case 'log':
      case 'repeat': {
        if (entry.sets.length >= 100) throw new Error('At most 100 sets per exercise.');
        const last = entry.sets.at(-1);
        if (action === 'repeat' && !last) throw new Error('No last set to repeat.');
        const actual = setData({
          ...input,
          resistance:
            input.resistance ?? (action === 'repeat' ? last.resistance : entry.workingResistance),
          reps: input.reps ?? (action === 'repeat' ? last.reps : undefined),
        });
        if (actual.resistance.kind === 'custom' && actual.resistance.display === 'Set working resistance')
          throw new Error('Set working resistance with Change Weight before logging this exercise. Use BW or none if appropriate.');
        entry.sets.push({
          id: id(),
          order: entry.sets.length + 1,
          ...actual,
          loggedAt: this.stamp(),
        });
        entry.workingResistance = clone(actual.resistance);
        entry.skipped = false;
        break;
      }
      case 'edit-set': {
        const at = entry.sets.findIndex((set) => set.id === input.setId);
        if (at < 0) throw new Error('Set not found.');
        entry.sets[at] = {
          ...entry.sets[at],
          ...setData({ ...entry.sets[at], ...input }),
          editedAt: this.stamp(),
        };
        if (at === entry.sets.length - 1)
          entry.workingResistance = clone(entry.sets[at].resistance);
        break;
      }
      case 'delete-set': {
        if (!entry.sets.some((set) => set.id === input.setId)) throw new Error('Set not found.');
        entry.sets = entry.sets
          .filter((set) => set.id !== input.setId)
          .map((set, index) => ({ ...set, order: index + 1 }));
        break;
      }
      case 'skip':
        entry.skipped = true;
        break;
      case 'exercise-note':
        entry.note = text(input.note, 'Exercise note', 500, true);
        entry.questionable = boolean(input.questionable);
        break;
      case 'session-note':
        s.note = text(input.note, 'Session note', 1000, true);
        s.questionable = boolean(input.questionable);
        break;
      case 'finish':
        s.state = 'completed';
        s.finishedAt = this.stamp();
        s.recommendations = this.recommendations(s);
        break;
      case 'abandon':
        s.state = 'abandoned';
        s.finishedAt = this.stamp();
        break;
      default:
        throw new Error('Unknown Workout action.');
    }
    s.revision++;
    s.requests.push(requestId);
    s.requests = s.requests.slice(-500);
    this.repo.commit([{ key: 'session:' + s.id, value: s }]);
    if (destructive) this.confirmations.delete(confirmationToken);
    return s;
  }
  recommendations(s) {
    return s.exercises.map((e) =>
      recommend(e, {
        questionable: s.questionable,
        chains: s.progressionContext?.chains ?? [],
        exercises: s.progressionContext?.exercises ?? [],
      }),
    );
  }
  decide(
    userId,
    sessionId,
    { entryId, choice, manual, expectedRevision, expectedProgramRevision, requestId },
  ) {
    const s = this.session(sessionId, userId);
    if (s.requests.includes(requestId)) return s;
    if (!requestId || typeof requestId !== 'string' || requestId.length > 100)
      throw new Error('A unique request ID is required.');
    this.assertRevision(s, expectedRevision);
    if (s.state !== 'completed' || !['accept', 'keep', 'manual'].includes(choice))
      throw new Error('Choose accept, keep or manual on a completed workout.');
    const entry = s.exercises.find((e) => e.id === entryId),
      recommendation = s.recommendations.find((r) => r.id === entryId);
    if (!entry || !recommendation) throw new Error('Recommendation not found.');
    if (s.decisions.some((d) => d.entryId === entryId && d.valid !== false))
      throw new Error('This recommendation was already decided.');
    let proposed = null,
      before = null,
      programId = null;
    const writes = [];
    if (choice !== 'keep') {
      if (!s.programId || !entry.slotId)
        throw new Error('Free/added exercises have no program prescription to change.');
      if (
        choice === 'accept' &&
        (recommendation.outcome !== 'PROGRESS' || !recommendation.proposed)
      )
        throw new Error('No automatic progression to accept. Review or set manually.');
      proposed =
        choice === 'accept'
          ? recommendation.proposed
          : {
              exerciseId: manual?.exerciseId ?? entry.exerciseId,
              resistance: resistance(manual?.resistance),
            };
      const ex = this.owned('exercises', proposed.exerciseId, userId);
      if (!ex.active) throw new Error('Next exercise is archived.');
      const programs = this.repo.records('programs');
      const p = this.owned('programs', s.programId, userId);
      if (p.revision !== expectedProgramRevision)
        throw new Error('Program changed. Review its current prescription before applying.');
      const t = p.templates.find((t) => t.id === s.templateId),
        slot = t?.exercises.find((e) => e.slotId === entry.slotId);
      if (!slot || slot.exerciseId !== entry.exerciseId)
        throw new Error('Program slot changed or removed. Set the program manually.');
      if (
        choice === 'accept' &&
        (['sets', 'minReps', 'maxReps'].some((key) => slot[key] !== entry.planned[key]) ||
          JSON.stringify(slot.resistance) !== JSON.stringify(entry.planned.resistance) ||
          JSON.stringify(slot.rule) !== JSON.stringify(entry.planned.rule))
      )
        throw new Error(
          'Current prescription differs from the session plan. Review it and use Set Manually.',
        );
      before = clone(slot);
      slot.exerciseId = proposed.exerciseId;
      slot.resistance = resistance(proposed.resistance);
      p.revision++;
      programId = p.id;
      writes.push({
        key: 'programs',
        value: envelope(programs.map((old) => (old.id === p.id ? p : old))),
      });
    }
    s.decisions.push({
      id: id(),
      entryId,
      choice,
      before,
      after: proposed,
      programId,
      at: this.stamp(),
      valid: true,
    });
    s.revision++;
    s.requests.push(requestId);
    s.requests = s.requests.slice(-500);
    writes.push({ key: 'session:' + s.id, value: s });
    this.repo.commit(writes);
    return s;
  }
  correct(
    userId,
    sessionId,
    { entryId, setId, patch, scope = 'set', expectedRevision, requestId, confirmed },
  ) {
    const s = this.session(sessionId, userId);
    if (s.requests.includes(requestId)) return s;
    this.assertRevision(s, expectedRevision);
    if (s.state !== 'completed' || confirmed !== true)
      throw new Error('Confirm a completed-history correction.');
    if (!requestId || typeof requestId !== 'string' || requestId.length > 100)
      throw new Error('A unique request ID is required.');
    const entry = s.exercises.find((e) => e.id === entryId);
    let target;
    if (scope === 'set') target = entry?.sets.find((set) => set.id === setId);
    else if (scope === 'exercise') target = entry;
    else if (scope === 'session') target = s;
    else throw new Error('Invalid correction scope.');
    if (!target) throw new Error('Historical result not found.');
    const before =
      scope === 'set' ? clone(target) : { note: target.note, questionable: target.questionable };
    const after =
      scope === 'set'
        ? setData({ ...target, ...patch })
        : {
            note: text(patch?.note, 'History note', scope === 'session' ? 1000 : 500, true),
            questionable: boolean(patch?.questionable),
          };
    Object.assign(target, after, { editedAt: this.stamp() });
    s.corrections.push({
      id: id(),
      at: this.stamp(),
      scope,
      entryId: entryId ?? null,
      setId: setId ?? null,
      before,
      after: clone(after),
      note: 'Recommendations recalculated. Prior decisions invalidated; program changes deliberately retained for manual review.',
    });
    for (const decision of s.decisions) decision.valid = false;
    s.recommendations = this.recommendations(s);
    s.revision++;
    s.requests.push(requestId);
    s.requests = s.requests.slice(-500);
    this.repo.commit([{ key: 'session:' + s.id, value: s }]);
    return s;
  }
  bindMessage(userId, sessionId, message) {
    const s = this.session(sessionId, userId);
    s.message = message;
    this.repo.commit([{ key: 'session:' + s.id, value: s }]);
    return s;
  }
  historyExercises(userId) {
    user(userId);
    const records = this.repo.records('exercises').filter(e => e.userId === userId);
    const known = new Set(records.map(e => e.id));
    for (const session of this.repo.sessions().filter(s => s.userId === userId && s.state === 'completed'))
      for (const entry of session.exercises)
        if (!known.has(entry.exerciseId)) {
          records.push({ id: entry.exerciseId, name: entry.name, variation: entry.variation || '',
            aliases: [], category: '', equipment: '', active: false });
          known.add(entry.exerciseId);
        }
    return records;
  }
  exerciseHistory(userId, exerciseId) {
    const exercise = this.historyExercises(userId).find(e => e.id === exerciseId);
    if (!exercise) throw new Error('Exercise history not found for this user. Choose an exercise again.');
    const sessions = this.repo.sessions()
      .filter(s => s.userId === userId && s.state === 'completed')
      .map(s => ({ ...s, exercises: s.exercises.filter(e => e.exerciseId === exerciseId && e.sets.length) }))
      .filter(s => s.exercises.length);
    return { exercise, sessions };
  }
  state(userId) {
    const catalog = this.catalog(userId),
      sessions = this.repo.sessions().filter((s) => s.userId === userId);
    let next = null;
    try {
      const p = this.planned(userId);
      next = {
        programId: p.program.id,
        programName: p.program.name,
        templateId: p.template.id,
        name: p.template.name,
      };
    } catch {}
    return {
      ...catalog,
      userId,
      sessions,
      active: sessions.find((s) => s.state === 'active') ?? null,
      next,
      savedNext:
        next &&
        this.repo.preferences().plans[userId]?.programId === next.programId &&
        this.repo.preferences().plans[userId]?.templateId === next.templateId
          ? next
          : null,
    };
  }
  summary(userId) {
    if (!userId) return { available: true, active: null, next: null, last: null };
    const s = this.state(userId),
      active = s.active;
    return {
      available: true,
      active: active
        ? {
            name: active.name,
            exercise: active.currentIndex + 1,
            exercises: active.exercises.length,
            sets: active.exercises.reduce(
              (n, e) => n + e.sets.filter((s) => s.type !== 'warmup').length,
              0,
            ),
          }
        : null,
      next: s.next?.name ?? null,
      last: s.sessions.find((s) => s.state === 'completed')?.finishedAt ?? null,
    };
  }
}
