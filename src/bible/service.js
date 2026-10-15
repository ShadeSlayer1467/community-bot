import { randomUUID } from 'node:crypto';

// Canonical chapter counts. Reading order is the New Testament, then the Old Testament.
export const books = [
  ['Matt',28],['Mark',16],['Luke',24],['John',21],['Acts',28],['Rom',16],
  ['1 Cor',16],['2 Cor',13],['Gal',6],['Eph',6],['Phil',4],['Col',4],
  ['1 Thess',5],['2 Thess',3],['1 Tim',6],['2 Tim',4],['Titus',3],['Phlm',1],
  ['Heb',13],['Jas',5],['1 Pet',5],['2 Pet',3],['1 John',5],['2 John',1],
  ['3 John',1],['Jude',1],['Rev',22],
  ['Gen',50],['Exod',40],['Lev',27],['Num',36],['Deut',34],['Josh',24],
  ['Judg',21],['Ruth',4],['1 Sam',31],['2 Sam',24],['1 Kgs',22],['2 Kgs',25],
  ['1 Chr',29],['2 Chr',36],['Ezra',10],['Neh',13],['Esth',10],['Job',42],
  ['Ps',150],['Prov',31],['Eccl',12],['Song',8],['Isa',66],['Jer',52],
  ['Lam',5],['Ezek',48],['Dan',12],['Hos',14],['Joel',3],['Amos',9],
  ['Obad',1],['Jonah',4],['Mic',7],['Nah',3],['Hab',3],['Zeph',3],
  ['Hag',2],['Zech',14],['Mal',4],
];
export const chapters = books.flatMap(([book, count]) =>
  Array.from({ length: count }, (_, n) => ({ book, chapter: n + 1 })));
export const plan = Array.from({ length: 365 }, (_, day) => {
  const reading = chapters.slice(Math.floor(day * chapters.length / 365),
    Math.floor((day + 1) * chapters.length / 365));
  const groups = [];
  for (const { book, chapter } of reading) {
    const last = groups.at(-1);
    if (last?.book === book) last.end = chapter;
    else groups.push({ book, start: chapter, end: chapter });
  }
  return groups.map(g => `${g.book} ${g.start}${g.end === g.start ? '' : '-' + g.end}`).join('; ');
});

// Calendar-day arithmetic in the timezone captured when the personal plan starts (DST safe).
function dayNumber(time, timezone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
  }).formatToParts(new Date(time)).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000;
}
export class BibleService {
  constructor(store, now = () => Date.now(), timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
    Object.assign(this, { store, now, timezone });
  }
  status(record) {
    const day = record.completed.length + 1;
    const elapsed = Math.max(1, dayNumber(this.now(), record.timezone) - dayNumber(record.startedAt, record.timezone) + 1);
    return { ...record, day, passage: plan[day - 1],
      behind: Math.max(0, Math.min(365, elapsed) - day), finished: day > 365 };
  }
  today(userId) {
    const data = this.store.read();
    let record = data[userId];
    if (!record) record = data[userId] = {
      startedAt: this.now(), timezone: this.timezone, completed: [], active: null,
    };
    if (record.completed.length < 365 && !record.active) record.active = randomUUID();
    this.store.save(data);
    return this.status(record);
  }
  act(userId, token, action) {
    const data = this.store.read();
    const record = data[userId];
    if (!record || record.active !== token || !['complete', 'abandon'].includes(action))
      throw new Error('This reading card is no longer active. Use /bible today.');
    if (action === 'complete') record.completed.push({ day: record.completed.length + 1, at: this.now() });
    record.active = null;
    this.store.save(data);
    return this.status(record);
  }
  history(userId) {
    const record = this.store.read()[userId];
    return record ? this.status(record) : null;
  }
}
