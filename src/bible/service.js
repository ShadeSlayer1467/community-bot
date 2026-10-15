import { randomUUID } from 'node:crypto';

// Canonical chapter counts. Reading order is the New Testament, then the Old Testament.
export const books = [
  ['Matthew',28],['Mark',16],['Luke',24],['John',21],['Acts',28],['Romans',16],
  ['1 Corinthians',16],['2 Corinthians',13],['Galatians',6],['Ephesians',6],['Philippians',4],['Colossians',4],
  ['1 Thessalonians',5],['2 Thessalonians',3],['1 Timothy',6],['2 Timothy',4],['Titus',3],['Philemon',1],
  ['Hebrews',13],['James',5],['1 Peter',5],['2 Peter',3],['1 John',5],['2 John',1],
  ['3 John',1],['Jude',1],['Revelation',22],
  ['Genesis',50],['Exodus',40],['Leviticus',27],['Numbers',36],['Deuteronomy',34],['Joshua',24],
  ['Judges',21],['Ruth',4],['1 Samuel',31],['2 Samuel',24],['1 Kings',22],['2 Kings',25],
  ['1 Chronicles',29],['2 Chronicles',36],['Ezra',10],['Nehemiah',13],['Esther',10],['Job',42],
  ['Psalms',150],['Proverbs',31],['Ecclesiastes',12],['Song of Solomon',8],['Isaiah',66],['Jeremiah',52],
  ['Lamentations',5],['Ezekiel',48],['Daniel',12],['Hosea',14],['Joel',3],['Amos',9],
  ['Obadiah',1],['Jonah',4],['Micah',7],['Nahum',3],['Habakkuk',3],['Zephaniah',3],
  ['Haggai',2],['Zechariah',14],['Malachi',4],
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
