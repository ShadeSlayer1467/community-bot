import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
let counter = 0;
const waiting = new Map();
parentPort.on('message', ({ id, result, error }) => {
  const pending = waiting.get(id);
  if (!pending) return;
  waiting.delete(id);
  error ? pending.reject(new Error(error)) : pending.resolve(result);
});
const call = (method, ...args) =>
  new Promise((resolve, reject) => {
    const id = ++counter;
    waiting.set(id, { resolve, reject });
    parentPort.postMessage({ type: 'call', id, method, args });
  });
try {
  const module = await import(pathToFileURL(workerData.file).href);
  if (typeof module.default !== 'function')
    throw new Error('CustomCommand must export a default async function.');
  const api = Object.freeze({
    purge: (options) => call('purge', options),
    ban: (userId, reason) => call('ban', userId, reason),
    kick: (userId, reason) => call('kick', userId, reason),
    inspect: () => call('inspect'),
    discord: (method, route, body) => call('discord', method, route, body),
    log: (message) => call('log', String(message).slice(0, 500)),
  });
  const value = await module.default({ ...workerData.context, api });
  if (waiting.size) throw new Error('Await every API call before returning from CustomCommand.');
  parentPort.postMessage({
    type: 'done',
    value: typeof value === 'string' ? value : JSON.stringify(value),
  });
} catch (error) {
  parentPort.postMessage({ type: 'error', error: error.message });
}
