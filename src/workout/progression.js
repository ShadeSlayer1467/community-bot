import { formatResistance, clone } from './model.js';
const same = (a, b) =>
  a.kind === b.kind && a.unit === b.unit && a.value === b.value && a.display === b.display;
export function recommend(entry, { questionable = false, chains = [], exercises = [] } = {}) {
  const p = entry.planned;
  const base = {
    id: entry.id,
    exerciseId: entry.exerciseId,
    outcome: 'MAINTAIN',
    reason: 'Free workout: record performance without judging it against a prescription.',
    proposed: null,
  };
  if (questionable || entry.questionable || entry.sets.some((s) => s.questionable))
    return {
      ...base,
      outcome: 'QUESTIONABLE',
      reason: 'Uncertain data: review the result before changing difficulty.',
    };
  if (!p) return base;
  const sets = entry.sets.filter((s) => ['normal', 'amrap'].includes(s.type));
  if (entry.skipped || sets.length < p.sets)
    return {
      ...base,
      reason: `Only ${sets.length}/${p.sets} prescribed working sets logged; no increase recommended.`,
    };
  // All sets at the prescription participate: warmups/dropsets/partials never prove mastery.
  if (sets.some((s) => !same(s.resistance, p.resistance)))
    return {
      ...base,
      outcome: 'REVIEW',
      reason: 'Working resistance differs from the plan; review mixed-load performance manually.',
    };
  const target = sets.slice(0, p.sets);
  const allMax = target.every((s) => s.reps >= p.maxReps) && sets.every((s) => s.reps >= p.minReps);
  const allLow = target.every((s) => s.reps < p.minReps);
  const average = target.reduce((sum, s) => sum + s.reps, 0) / target.length;
  if (
    allLow ||
    (average < p.minReps * 0.75 &&
      target.filter((s) => s.reps < p.minReps).length > target.length / 2)
  )
    return {
      ...base,
      outcome: 'REVIEW',
      reason: `Working sets clearly below the ${p.minReps}-rep minimum; consider reducing or revisiting difficulty.`,
    };
  if (!allMax)
    return {
      ...base,
      reason: `Build toward ${p.sets} × ${p.maxReps}. A late fatigue drop alone does not require reducing difficulty.`,
    };
  const reason = `All ${p.sets} prescribed sets reached ${p.maxReps} reps.`;
  if (p.rule.type === 'chain') {
    const c = chains.find((c) => c.id === p.rule.chainId);
    const index = c?.exerciseIds.indexOf(entry.exerciseId) ?? -1;
    const next =
      index >= 0 ? exercises.find((e) => e.id === c.exerciseIds[index + 1] && e.active) : null;
    if (!next)
      return {
        ...base,
        outcome: 'PROGRESS',
        reason: reason + ' No active next variation configured; set manually.',
      };
    return {
      ...base,
      outcome: 'PROGRESS',
      reason: reason + ` Next variation: ${next.name}.`,
      proposed: { exerciseId: next.id, resistance: clone(next.defaults.resistance) },
    };
  }
  if (p.rule.type === 'manual' || ['bodyweight', 'none', 'custom'].includes(p.resistance.kind))
    return {
      ...base,
      outcome: 'PROGRESS',
      reason: reason + ' Choose the next difficulty manually.',
    };
  let value;
  if (p.rule.loads.length)
    value =
      p.resistance.kind === 'assisted'
        ? [...p.rule.loads].reverse().find((v) => v < p.resistance.value)
        : p.rule.loads.find((v) => v > p.resistance.value);
  else
    value =
      p.resistance.value +
      (p.resistance.kind === 'assisted' ? -p.rule.increment : p.rule.increment);
  if (value === undefined || value < 0 || value > 5000)
    return { ...base, outcome: 'PROGRESS', reason: reason + ' No valid next load; set manually.' };
  const proposed = {
    exerciseId: entry.exerciseId,
    resistance: { ...p.resistance, value: Number(value.toFixed(4)) },
  };
  return {
    ...base,
    outcome: 'PROGRESS',
    reason: reason + ` Recommend ${formatResistance(proposed.resistance)}.`,
    proposed,
  };
}
