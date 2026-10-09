import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../persistence.js';
import {
  envelope,
  validateRecords,
  exercise,
  program,
  chain,
  validateSession,
  validatePreferences,
} from './model.js';
const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,60}$/.test(id);
export class WorkoutRepository {
  constructor(directory, ownerIds = []) {
    this.directory = directory;
    this.stores = new Map();
    this.stores.set(
      'exercises',
      new Store(path.join(directory, 'exercises.json'), envelope([]), validateRecords(exercise)),
    );
    this.stores.set(
      'programs',
      new Store(path.join(directory, 'programs.json'), envelope([]), validateRecords(program)),
    );
    this.stores.set(
      'chains',
      new Store(path.join(directory, 'chains.json'), envelope([]), validateRecords(chain)),
    );
    this.stores.set(
      'preferences',
      new Store(
        path.join(directory, 'preferences.json'),
        { version: 1, unit: 'lb', allowedUserIds: ownerIds, plans: {} },
        validatePreferences,
      ),
    );
    for (const store of this.stores.values())
      if (!fs.existsSync(store.file)) store.save(store.read());
    fs.mkdirSync(path.join(directory, 'sessions'), { recursive: true });
    this.journal = new Store(path.join(directory, 'transaction.json'), null);
    this.recover();
  }
  sessionStore(id, initial) {
    if (!validId(id)) throw new Error('Invalid Workout session identifier.');
    const key = 'session:' + id;
    if (!this.stores.has(key)) {
      const file = path.join(this.directory, 'sessions', id + '.json');
      if (!fs.existsSync(file) && !initial) throw new Error('Workout session not found.');
      this.stores.set(key, new Store(file, initial, validateSession));
    }
    return this.stores.get(key);
  }
  resolve(key, value) {
    if (key.startsWith('session:')) return this.sessionStore(key.slice(8), value);
    if (!this.stores.has(key)) throw new Error('Unknown Workout storage target.');
    return this.stores.get(key);
  }
  recover() {
    const pending = this.journal.read();
    if (!pending) return;
    if (!Array.isArray(pending.writes)) throw new Error('Invalid Workout recovery journal.');
    for (const { key, value } of pending.writes)
      this.resolve(key, value).validate(structuredClone(value));
    for (const { key, value } of pending.writes) this.resolve(key, value).save(value);
    this.journal.save(null);
  }
  commit(writes) {
    this.recover();
    // Validate every intended value before making the recovery intent durable.
    for (const { key, value } of writes) this.resolve(key, value).validate(structuredClone(value));
    this.journal.save({ writes });
    for (const { key, value } of writes) this.resolve(key, value).save(value);
    this.journal.save(null);
  }
  records(key) {
    this.recover();
    return this.stores.get(key).read().records;
  }
  preferences() {
    this.recover();
    return this.stores.get('preferences').read();
  }
  sessions() {
    this.recover();
    return fs
      .readdirSync(path.join(this.directory, 'sessions'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.sessionStore(f.slice(0, -5)).read())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  getSession(id) {
    this.recover();
    return this.sessionStore(id).read();
  }
}
