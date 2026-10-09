import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { exercise } from './model.js';

export const starterCatalog = JSON.parse(fs.readFileSync(new URL('./starter-catalog.json', import.meta.url), 'utf8'));
export const normalizeExercise = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
export function filterExercises(records, { search = '', category = '', equipment = '', status = 'active' } = {}) {
  const query = normalizeExercise(search);
  return records.filter(e => (status === 'all' || e.active === (status !== 'archived')) &&
    (!category || e.category === category) && (!equipment || e.equipment === equipment) &&
    (!query || [e.name, ...e.aliases, e.variation].some(v => normalizeExercise(v).includes(query))))
    .sort((a, b) => a.name.localeCompare(b.name) || a.variation.localeCompare(b.variation));
}
export function starterExercise(entry, userId, unit) {
  const unloaded = entry.equipment === 'Bodyweight' && !/Weighted|Assisted/.test(entry.name);
  return exercise({ ...entry, userId,
    id: 'starter_' + createHash('sha256').update(userId + ':' + entry.name).digest('hex').slice(0, 40),
    active: true, revision: 0,
    notes: 'Starter library exercise. Configure resistance and program prescriptions for your workout. Machine settings belong in a separate variation.',
    defaults: { sets: 1, minReps: 1, maxReps: 1,
      resistance: { kind: unloaded ? 'bodyweight' : 'custom', value: 0, unit,
        display: unloaded ? '' : 'Set working resistance' },
      rule: { type: 'manual', increment: 5, loads: [], chainId: '' },
      note: 'Neutral placeholders; set the actual prescription in your program.' }
  });
}
