import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CustomRunner } from '../src/custom/runner.js';
import { securityFixture } from './helpers.js';
const userId = '100000000000000001';
const config = { ownerIds: [userId] };
function fixture(t, source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-worker-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'command.mjs');
  fs.writeFileSync(file, source);
  return file;
}
const options = (file) => ({
  userId,
  config,
  file,
  context: { guildId: 'test', args: 'input' },
  dispatch: async () => 'ok',
  timeoutMs: 1000,
});
async function idle(runner) {
  for (let n = 0; n < 100 && runner.busy; n++) await delay(10);
  assert.equal(runner.busy, false);
}
test('custom worker calls host API and reloads changed local source', async (t) => {
  const file = fixture(t, 'export default async ({api,args}) => `${args}:${await api.inspect()}`;');
  const { security, grant } = await securityFixture(true);
  const runner = new CustomRunner(() => {}, security);
  assert.equal(await runner.run({ ...options(file), authorization: grant() }), 'input:ok');
  await idle(runner);
  fs.writeFileSync(file, 'export default async () => "updated";');
  assert.equal(await runner.run({ ...options(file), authorization: grant() }), 'updated');
  await idle(runner);
});
test('custom owner denial occurs before file loading', async () => {
  const { security } = await securityFixture(false);
  const runner = new CustomRunner(() => {}, security);
  await assert.rejects(runner.run({ ...options('nonexistent'), userId: 'other' }), /authorization/);
  assert.equal(runner.busy, false);
});
test('infinite loop is terminated; concurrency denied; bot process survives', async (t) => {
  const file = fixture(t, 'export default async () => { while(true) {} };');
  const { security, grant } = await securityFixture(true);
  const runner = new CustomRunner(() => {}, security);
  const pending = runner.run({ ...options(file), authorization: grant(), timeoutMs: 150 });
  await assert.rejects(runner.run({ ...options(file), authorization: grant() }), /still running/);
  await assert.rejects(pending, /timed out/);
  await idle(runner);
});
test('syntax errors and thrown exceptions release lock and surface cleanly', async (t) => {
  const { security, grant } = await securityFixture(true);
  const runner = new CustomRunner(() => {}, security);
  const file = fixture(t, 'export default async () => { throw new Error("sample failure") };');
  await assert.rejects(runner.run({ ...options(file), authorization: grant() }), /sample failure/);
  await idle(runner);
  fs.writeFileSync(file, 'export default ???');
  await assert.rejects(runner.run({ ...options(file), authorization: grant() }));
  await idle(runner);
});
test('cancellation retains lock while an already-started host operation drains', async (t) => {
  const file = fixture(t, 'export default async ({api}) => await api.inspect();');
  const { security, grant } = await securityFixture(true);
  const runner = new CustomRunner(() => {}, security);
  let started, release;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const pending = runner.run({
    ...options(file),
    authorization: grant(),
    dispatch: async () => {
      started();
      await gate;
      return 'done';
    },
  });
  await ready;
  runner.cancel();
  await assert.rejects(pending, /cancelled/);
  assert.equal(runner.busy, true);
  await assert.rejects(runner.run({ ...options(file), authorization: grant() }), /still running/);
  release();
  await idle(runner);
});
