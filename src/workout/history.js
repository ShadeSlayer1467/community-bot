import { formatResistance } from './model.js';

// Split between sets, never within a recorded set or by dropping older sets.
export function exerciseHistoryPages(history) {
  const fields = [];
  for (const session of history.sessions) {
    for (const entry of session.exercises) {
      const questionable = session.questionable || entry.questionable;
      const heading = `${session.startedAt.slice(0, 10)}${questionable ? ' · ⚠ questionable' : ''} · ${session.name.slice(0, 80)}${entry.variation ? ' · ' + entry.variation.slice(0, 70) : ''}`;
      const lines = entry.sets.map(set =>
        `${set.order}. ${formatResistance(set.resistance)} × ${set.reps} [${set.type}]${set.questionable ? ' ⚠ questionable' : ''}`.replace(/@/g, '＠'));
      if (!lines.length) continue;
      let chunk = '', part = 1;
      const push = () => fields.push({
        name: `${heading}${part > 1 ? ' (continued ' + part + ')' : ''}`.replace(/@/g, '＠').slice(0, 256),
        value: chunk,
      });
      for (const line of lines) {
        if (chunk && chunk.length + line.length + 1 > 1000) {
          push(); part++; chunk = '';
        }
        chunk += (chunk ? '\n' : '') + line;
      }
      if (chunk) push();
    }
  }
  const pages = [];
  // Four fields keeps even the longest chunks safely below the aggregate embed limit.
  for (let index = 0; index < fields.length; index += 4) pages.push(fields.slice(index, index + 4));
  return pages.length ? pages : [[]];
}
