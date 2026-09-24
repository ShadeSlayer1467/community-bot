import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from 'otplib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeveloperAccess, ELEVATION_MS } from '../src/security/developer-access.js';
import { WindowsVault } from '../src/security/windows-vault.js';
import { CustomRunner } from '../src/custom/runner.js';
import { makeHandler } from '../src/commands/handler.js';
import { defaults, validateSettings } from '../src/settings.js';
import { securityFixture, dm, ownerId } from './helpers.js';

test('owner in bot DM without TOTP elevation is denied', async () => {
  const { security } = await securityFixture();
  assert.throws(() => security.authorizeExecution(dm()), /TOTP elevation required/);
});
test('elevated owner is denied in guild, thread, group DM and unknown context', async () => {
  const { security } = await securityFixture(true);
  for (const override of [
    { context: 0, guildId: 'guild', channel: { type: 0 }, inGuild: () => true },
    { context: 0, guildId: 'guild', channel: { type: 11 }, inGuild: () => true },
    { context: 2, channel: { type: 3 } },
    { context: 1, channel: { type: 3 } },
    { context: null },
    { channel: null },
    { guildId: 'guild' },
  ])
    assert.throws(() => security.authorizeExecution(dm(override)), /direct message/);
});
test('different user cannot authenticate even with a valid OTP or administrator claims', async () => {
  const { security, token } = await securityFixture();
  await assert.rejects(
    security.authenticate(dm({ user: { id: 'other' }, administrator: true }), await token()),
    /owner/,
  );
  assert.throws(() => security.authorizeExecution(dm({ user: { id: 'other' } })), /owner/);
  assert.equal(security.status().elevatedUntil, null);
});
test('valid owner TOTP in bot DM grants a single-use execution ticket', async () => {
  const { security, grant } = await securityFixture(true);
  const ticket = grant();
  assert.equal(security.validateExecution(ticket, true).userId, ownerId);
  assert.throws(() => security.validateExecution(ticket, true), /already been used/);
  assert.throws(
    () => security.validateExecution({ userId: ownerId, elevated: true }),
    /authorization/,
  );
  assert.throws(() => security.authorizeExecution(dm({ commandName: 'ping' })), /dedicated/);
});
test('elevation expires after five minutes, including when the wall clock moves backwards', async () => {
  const { security, clock, grant } = await securityFixture(true);
  const ticket = grant();
  clock.value -= 100000;
  clock.mono += ELEVATION_MS;
  assert.throws(() => security.validateExecution(ticket), /expired/);
  assert.throws(() => security.authorizeExecution(dm()), /TOTP elevation/);
});
test('new process state retains enrollment and replay guard but no elevation', async () => {
  const { security, options, token } = await securityFixture(true);
  const restarted = new DeveloperAccess(options);
  assert.equal(restarted.status().enrolled, true);
  assert.equal(restarted.status().elevatedUntil, null);
  assert.throws(() => restarted.authorizeExecution(dm()), /TOTP elevation/);
  await assert.rejects(restarted.authenticate(dm(), await token()), /already-used/);
  assert.ok(security.status().elevatedUntil);
});
test('accepted time step cannot be replayed; concurrent verification cannot double accept', async () => {
  const { security, token } = await securityFixture();
  const code = await token();
  const results = await Promise.allSettled([
    security.authenticate(dm(), code),
    security.authenticate(dm(), code),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  security.revoke();
  await assert.rejects(security.authenticate(dm(), code), /already-used/);
});
test('TOTP tolerance is only one 30-second step; failed attempts lock out and survive restart', async () => {
  const { security, secret, clock, options } = await securityFixture();
  const farFuture = await generate({ secret, epoch: Math.floor(clock.value / 1000) + 90 });
  for (let n = 0; n < 5; n++)
    await assert.rejects(security.authenticate(dm(), farFuture), /Invalid/);
  await assert.rejects(new DeveloperAccess(options).authenticate(dm(), farFuture), /five minutes/);
  clock.value += 300000;
  clock.mono += 300000;
  const nearFuture = await generate({ secret, epoch: Math.floor(clock.value / 1000) + 30 });
  await security.authenticate(dm(), nearFuture);
  assert.ok(security.status().elevatedUntil);
});
test('local enrollment requires confirmation, is session bound, expires, and never elevates', async () => {
  const { security, clock, secret } = await securityFixture();
  const enrollment = security.beginEnrollment('another-admin-session');
  const newSecret = new URL(enrollment.uri).searchParams.get('secret');
  const code = await generate({ secret: newSecret, epoch: Math.floor(clock.value / 1000) });
  await assert.rejects(security.confirmEnrollment('wrong-session', code), /expired/);
  assert.equal(security.status().elevatedUntil, null);
  assert.ok(!JSON.stringify(security.status()).includes(secret));
  assert.ok(!security.redact(enrollment.uri + ' ' + secret + ' ' + newSecret).includes(newSecret));
  clock.value += ELEVATION_MS;
  await assert.rejects(security.confirmEnrollment('another-admin-session', code), /expired/);
});
test('failure to persist replay state never grants elevation', async () => {
  const { security, vault, token } = await securityFixture();
  vault.save = () => {
    throw new Error('disk failure');
  };
  await assert.rejects(security.authenticate(dm(), await token()), /disk failure/);
  assert.equal(security.status().elevatedUntil, null);
});
test('revocation invalidates existing tickets and authentication cannot race it', async () => {
  const { security, grant, clock, token } = await securityFixture(true);
  const ticket = grant();
  security.revoke();
  assert.throws(() => security.validateExecution(ticket), /revoked/);
  clock.value += 30000;
  const pending = security.authenticate(dm(), await token());
  security.revoke();
  await assert.rejects(pending, /revoked/);
});
test('runner cannot be reached through its old owner-only signature or a forged grant', async () => {
  const { security } = await securityFixture(true);
  const runner = new CustomRunner(() => {}, security);
  await assert.rejects(
    runner.run({ userId: ownerId, config: { ownerIds: [ownerId] }, file: 'missing', context: {} }),
    /authorization/,
  );
  assert.equal(runner.busy, false);
  await assert.rejects(new CustomRunner(() => {}).run({}), /authorization service/);
});
test('normal configurable commands cannot use developer command names', () => {
  for (const name of ['customcommand', 'owner-auth', 'owner-lock'])
    assert.throws(
      () => validateSettings({ ...defaults, responses: [{ ...defaults.responses[0], name }] }),
      /reserved/,
    );
});
test('interaction dispatcher rejects guild custom execution and un-elevated DMs before runner', async () => {
  const { security, config } = await securityFixture();
  let ran = 0;
  const handler = makeHandler({
    security,
    config,
    settings: { read: () => defaults },
    logger: { log() {}, redact: (s) => s },
    runner: {
      run() {
        ran++;
      },
    },
  });
  for (const override of [{}, { context: 0, guildId: 'guild', channel: { type: 0 } }]) {
    let response;
    await handler(
      dm({
        ...override,
        reply: async (data) => {
          response = data;
        },
      }),
    );
    assert.match(response.content, /TOTP elevation|direct message/);
  }
  assert.equal(ran, 0);
});
test('DM authentication modal elevates without echoing codes or secrets in responses/logs', async () => {
  const { security, config, token, secret } = await securityFixture();
  const logs = [],
    replies = [];
  const code = await token();
  const handler = makeHandler({
    security,
    config,
    settings: { read: () => defaults },
    logger: { log: (...args) => logs.push(args), redact: (value) => security.redact(value) },
  });
  const modal = dm({
    isChatInputCommand: () => false,
    isModalSubmit: () => true,
    customId: 'developer-totp',
    fields: { getTextInputValue: () => code },
    deferReply: async () => {
      modal.deferred = true;
    },
    editReply: async (data) => replies.push(data),
    reply: async (data) => replies.push(data),
  });
  await handler(modal);
  assert.ok(security.status().elevatedUntil);
  assert.match(replies[0].content, /five minutes/);
  assert.equal(
    replies.some((r) => r.content.includes(code) || r.content.includes(secret)),
    false,
  );
  assert.equal(
    logs.some((r) => r[1].includes(code) || r[1].includes(secret)),
    false,
  );
});
test(
  'Windows DPAPI encrypts the TOTP record at rest and reloads without a session',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-dpapi-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'totp.dpapi.json');
    const vault = new WindowsVault(file);
    const { secret, options } = await securityFixture(true, vault);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(secret));
    const restarted = new DeveloperAccess({ ...options, vault: new WindowsVault(file) });
    assert.equal(restarted.status().enrolled, true);
    assert.equal(restarted.status().elevatedUntil, null);
  },
);
