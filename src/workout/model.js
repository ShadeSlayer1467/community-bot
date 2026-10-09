import { snowflake } from '../config.js';
export const VERSION = 1;
export const resistanceKinds = [
  'total',
  'pair',
  'per-side',
  'stack',
  'bodyweight',
  'added',
  'assisted',
  'none',
  'custom',
];
export const setTypes = ['normal', 'warmup', 'amrap', 'dropset', 'partials'];
export const clone = (v) => structuredClone(v);
export function text(value, label, max = 500, optional = false) {
  if (optional && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim()))
    throw new Error(`${label}: enter text up to ${max} characters.`);
  return value.trim();
}
export function number(value, label, min, max, integer = false) {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  )
    throw new Error(
      `${label}: enter ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}.`,
    );
  return value;
}
export function boolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('Expected a boolean Workout flag.');
  return value;
}
export function user(value) {
  if (!snowflake(value)) throw new Error('Choose a valid Discord user ID.');
  return value;
}
export function resistance(value) {
  if (!value || !resistanceKinds.includes(value.kind) || !['lb', 'kg'].includes(value.unit))
    throw new Error('Invalid resistance type or unit.');
  const result = {
    kind: value.kind,
    unit: value.unit,
    value: number(value.value ?? 0, 'Resistance', 0, 5000),
    display: text(value.display, 'Resistance display', 80, true),
  };
  if (['bodyweight', 'none'].includes(result.kind) && result.value !== 0)
    throw new Error('Use added/assisted resistance for bodyweight adjustments.');
  if (result.kind === 'custom' && !result.display)
    throw new Error('Custom resistance needs a display label.');
  return result;
}
export function formatResistance(r) {
  if (r.kind === 'custom') return r.display;
  if (r.kind === 'bodyweight') return 'BW';
  if (r.kind === 'none') return 'No external resistance';
  if (r.kind === 'pair') return `2 × ${r.value} ${r.unit}`;
  if (r.kind === 'per-side') return `${r.value} ${r.unit}/side`;
  if (r.kind === 'stack') return `${r.value} ${r.unit} stack`;
  if (r.kind === 'added') return `BW + ${r.value} ${r.unit}`;
  if (r.kind === 'assisted') return `BW − ${r.value} ${r.unit} assistance`;
  return `${r.value} ${r.unit}`;
}
export function parseResistance(input, unit = 'lb') {
  const raw = text(input, 'Resistance', 80);
  if (/^bw$/i.test(raw)) return resistance({ kind: 'bodyweight', unit, value: 0 });
  if (/^none$/i.test(raw)) return resistance({ kind: 'none', unit, value: 0 });
  let match = /^(total|pair|per-side|stack|added|assisted):\s*(\d+(?:\.\d+)?)\s*(lb|kg)?$/i.exec(
    raw,
  );
  if (match)
    return resistance({
      kind: match[1].toLowerCase(),
      value: Number(match[2]),
      unit: match[3]?.toLowerCase() || unit,
    });
  match = /^2\s*[x×]\s*(\d+(?:\.\d+)?)\s*(lb|kg)?$/i.exec(raw);
  if (match)
    return resistance({
      kind: 'pair',
      value: Number(match[1]),
      unit: match[2]?.toLowerCase() || unit,
    });
  match = /^(\d+(?:\.\d+)?)\s*(lb|kg)?$/i.exec(raw);
  if (match)
    return resistance({
      kind: 'total',
      value: Number(match[1]),
      unit: match[2]?.toLowerCase() || unit,
    });
  if (raw.startsWith('custom:'))
    return resistance({ kind: 'custom', unit, value: 0, display: raw.slice(7) });
  throw new Error(
    'Use 235 lb, 2x135, stack:30, per-side:45, BW, added:10, assisted:20, none or custom:label.',
  );
}
export function rule(value = {}) {
  const type = value.type ?? 'double';
  if (!['double', 'chain', 'manual'].includes(type)) throw new Error('Invalid progression type.');
  const increment = number(value.increment ?? 5, 'Increment', 0.01, 1000);
  const loads = value.loads ?? [];
  if (
    !Array.isArray(loads) ||
    loads.length > 100 ||
    loads.some((v, i) => !Number.isFinite(v) || v < 0 || v > 5000 || (i && v <= loads[i - 1]))
  )
    throw new Error('Available loads must be increasing nonnegative numbers.');
  return { type, increment, loads, chainId: text(value.chainId, 'Chain ID', 60, true) };
}
export function prescription(value) {
  const result = {
    sets: number(value.sets, 'Target sets', 1, 20, true),
    minReps: number(value.minReps, 'Minimum reps', 1, 200, true),
    maxReps: number(value.maxReps, 'Maximum reps', 1, 200, true),
    resistance: resistance(value.resistance),
    rule: rule(value.rule),
    note: text(value.note, 'Exercise note', 500, true),
  };
  if (result.maxReps < result.minReps)
    throw new Error('Maximum reps must be at least minimum reps.');
  return result;
}
export function exercise(value) {
  const aliases = value.aliases ?? [];
  if (!Array.isArray(aliases) || aliases.length > 20) throw new Error('At most 20 aliases.');
  return {
    id: text(value.id, 'Exercise ID', 60),
    userId: user(value.userId),
    name: text(value.name, 'Exercise name', 100),
    aliases: aliases.map((a) => text(a, 'Alias', 100)),
    variation: text(value.variation, 'Variation', 200, true),
    equipment: text(value.equipment, 'Equipment', 100, true),
    category: text(value.category, 'Category', 100, true),
    notes: text(value.notes, 'Notes', 1000, true),
    active: boolean(value.active, true),
    defaults: prescription(value.defaults),
    revision: number(value.revision ?? 0, 'Revision', 0, 1e9, true),
  };
}
export function program(value) {
  if (!Array.isArray(value.templates) || !value.templates.length || value.templates.length > 30)
    throw new Error('Programs need 1–30 planned workouts.');
  const ids = new Set();
  const templates = value.templates.map((t) => {
    const id = text(t.id, 'Template ID', 60);
    if (ids.has(id)) throw new Error('Duplicate template ID.');
    ids.add(id);
    if (!Array.isArray(t.exercises) || !t.exercises.length || t.exercises.length > 50)
      throw new Error('A planned workout needs 1–50 exercises.');
    const slots = new Set();
    return {
      id,
      name: text(t.name, 'Workout name', 100),
      exercises: t.exercises.map((e) => {
        const slotId = text(e.slotId, 'Slot ID', 60);
        if (slots.has(slotId)) throw new Error('Duplicate exercise slot.');
        slots.add(slotId);
        return { slotId, exerciseId: text(e.exerciseId, 'Exercise ID', 60), ...prescription(e) };
      }),
    };
  });
  return {
    id: text(value.id, 'Program ID', 60),
    userId: user(value.userId),
    name: text(value.name, 'Program name', 100),
    active: value.active !== false,
    revision: number(value.revision ?? 0, 'Revision', 0, 1e9, true),
    templates,
  };
}
export function chain(value) {
  if (
    !Array.isArray(value.exerciseIds) ||
    value.exerciseIds.length < 2 ||
    value.exerciseIds.length > 30 ||
    new Set(value.exerciseIds).size !== value.exerciseIds.length
  )
    throw new Error('A progression chain needs 2–30 distinct exercise IDs in order.');
  return {
    id: text(value.id, 'Chain ID', 60),
    userId: user(value.userId),
    name: text(value.name, 'Chain name', 100),
    exerciseIds: value.exerciseIds.map((v) => text(v, 'Exercise ID', 60)),
    revision: number(value.revision ?? 0, 'Revision', 0, 1e9, true),
  };
}
export function setData(value) {
  if (!setTypes.includes(value.type ?? 'normal')) throw new Error('Invalid set type.');
  return {
    resistance: resistance(value.resistance),
    reps: number(value.reps, 'Reps', 1, 1000, true),
    type: value.type ?? 'normal',
    note: text(value.note, 'Set note', 500, true),
    questionable: boolean(value.questionable),
    rpe: value.rpe == null ? null : number(value.rpe, 'RPE', 1, 10),
    rir: value.rir == null ? null : number(value.rir, 'RIR', 0, 20),
  };
}
export function envelope(records) {
  return { version: VERSION, records };
}
export function validateRecords(validate) {
  return (value) => {
    if (value?.version !== VERSION || !Array.isArray(value.records))
      throw new Error('Unsupported Workout catalog schema.');
    const records = value.records.map(validate);
    if (new Set(records.map((r) => r.id)).size !== records.length)
      throw new Error('Duplicate Workout record IDs.');
    return envelope(records);
  };
}
export function validateSession(s) {
  if (s?.version !== VERSION || !['active', 'completed', 'abandoned'].includes(s.state))
    throw new Error('Unsupported Workout session schema.');
  user(s.userId);
  text(s.id, 'Session ID', 60);
  number(s.revision, 'Session revision', 0, 1e9, true);
  if (!Array.isArray(s.exercises) || s.exercises.length > 50)
    throw new Error('Invalid session exercises.');
  for (const e of s.exercises) {
    text(e.id, 'Workout exercise ID', 60);
    text(e.exerciseId, 'Exercise ID', 60);
    text(e.name, 'Exercise name', 100);
    resistance(e.workingResistance);
    if (e.planned) prescription(e.planned);
    if (!Array.isArray(e.sets) || e.sets.length > 100)
      throw new Error('At most 100 sets per exercise.');
    for (const set of e.sets) {
      text(set.id, 'Set ID', 60);
      setData(set);
    }
  }
  return s;
}
export function validatePreferences(p) {
  if (
    p?.version !== VERSION ||
    !['lb', 'kg'].includes(p.unit) ||
    !Array.isArray(p.allowedUserIds) ||
    p.allowedUserIds.length > 100
  )
    throw new Error('Invalid Workout settings.');
  p.allowedUserIds.forEach(user);
  if (!p.plans || typeof p.plans !== 'object' || Array.isArray(p.plans))
    throw new Error('Invalid workout plan selection.');
  for (const [id, plan] of Object.entries(p.plans)) {
    user(id);
    text(plan.programId, 'Program ID', 60);
    text(plan.templateId, 'Template ID', 60);
  }
  return p;
}
