import { randomUUID } from 'node:crypto';
export function taskAction(store, guildId, userId, action, value) {
  const data = store.read();
  const own = (t) => t.guildId === guildId && t.userId === userId;
  if (action === 'add') {
    if (!value?.trim() || value.length > 300)
      throw new Error('Task text must be 1–300 characters.');
    if (data.filter(own).length >= 50) throw new Error('You already have 50 tasks.');
    data.push({ id: randomUUID(), guildId, userId, text: value, done: false });
  } else if (action !== 'list') {
    const t = data.find((t) => own(t) && t.id === value);
    if (!t) throw new Error('Task not found in your task list for this server.');
    if (action === 'toggle') t.done = !t.done;
    else if (action === 'remove') data.splice(data.indexOf(t), 1);
    else throw new Error('Unknown task action.');
  }
  if (action !== 'list') store.save(data);
  return data.filter(own);
}
