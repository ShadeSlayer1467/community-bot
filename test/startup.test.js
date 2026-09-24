import test from 'node:test';
import assert from 'node:assert/strict';
import { connectOnStartup } from '../src/startup.js';

test('startup retries a failed connection and stops retrying after success', async () => {
  let attempts = 0;
  let retry;
  const host = {
    config: { discordToken: 'test', applicationId: 'test', ownerIds: ['test'], guildIds: ['test'] },
    state: 'offline',
    async connect() { if (++attempts === 1) throw new Error('Network unavailable'); this.state = 'online'; },
  };
  const stop = connectOnStartup(host, { log() {}, redact: x => x }, (fn, ms) => {
    assert.equal(ms, 30000); retry = fn;
  }, () => {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1);
  await retry();
  assert.equal(host.state, 'online');
  stop();
  await retry();
  assert.equal(attempts, 2);
});

test('incomplete configuration keeps startup offline without retrying', () => {
  const host = { config: { ownerIds: [], guildIds: [] }, connect() { assert.fail('must not connect'); } };
  connectOnStartup(host, { log() {} }, () => assert.fail('must not retry'))();
});
