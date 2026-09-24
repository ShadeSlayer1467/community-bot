// Optional real-browser smoke test. Set PLAYWRIGHT_MODULE to an installed playwright module.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/persistence.js';
import { defaults, validateSettings } from '../src/settings.js';
import { DiscordHost } from '../src/discord-host.js';
import { createAdmin } from '../src/admin/server.js';
import { CustomRunner } from '../src/custom/runner.js';
import { DeveloperAccess } from '../src/security/developer-access.js';
import { WindowsVault } from '../src/security/windows-vault.js';
import { generate } from 'otplib';
const require = createRequire(import.meta.url);
if (!process.env.PLAYWRIGHT_MODULE)
  throw new Error('Set PLAYWRIGHT_MODULE to your installed playwright package.');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'community-ui-test-'));
const config = {
  port: 0,
  adminPassword: 'temporary-browser-test-password',
  discordToken: '',
  applicationId: '',
  guildIds: [],
  ownerIds: ['100000000000000001'],
  customOwnerId: '100000000000000001',
  openaiApiKey: '',
  openaiModel: '',
};
const settings = new Store(path.join(directory, 'settings.json'), defaults, validateSettings);
const logger = { log() {}, recent: [], redact: (value) => value };
const security = new DeveloperAccess({
  config,
  vault: new WindowsVault(path.join(directory, 'totp.dpapi.json')),
});
const runner = new CustomRunner(logger.log, security);
security.onRevoke = () => runner.cancel?.();
const host = new DiscordHost({
  config,
  settings,
  tasks: new Store(path.join(directory, 'tasks.json'), []),
  feedback: new Store(path.join(directory, 'feedback.json'), []),
  logger,
  runner,
  security,
});
const server = createAdmin({ config, settings, host, logger, runner, security });
let browser;
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${config.port}`);
  await page.getByLabel('Admin password', { exact: true }).fill(config.adminPassword);
  await page.getByRole('button', { name: 'Unlock panel' }).click();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  await page.getByLabel('Re-enter admin password for enrollment').fill(config.adminPassword);
  await page.getByRole('button', { name: 'Enroll / replace authenticator' }).click();
  await page.locator('#enrollment').waitFor({ state: 'visible' });
  const uri = await page.locator('#enrollmentUri').textContent();
  const secret = new URL(uri).searchParams.get('secret');
  assert.ok(
    (await page.locator('#enrollmentQr').getAttribute('src')).startsWith('data:image/png;base64,'),
  );
  await page.getByLabel('Authenticator setup code').fill(await generate({ secret }));
  await page.getByRole('button', { name: 'Confirm enrollment' }).click();
  await page.locator('#enrollment').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#enrollmentUri').textContent(), '');
  assert.equal(security.status().enrolled, true);
  assert.equal(security.status().elevatedUntil, null);
  assert.ok(!fs.readFileSync(path.join(directory, 'totp.dpapi.json'), 'utf8').includes(secret));
  await page.getByRole('button', { name: 'Revoke developer session' }).click();
  await page.getByRole('status').filter({ hasText: 'Developer session revoked' }).waitFor();
  await page.getByRole('button', { name: '+ Add response command' }).click();
  const row = page.locator('.response').last();
  await row.getByLabel('Command name').fill('rules');
  await row.getByLabel('Description').fill('Community rules');
  await row.getByLabel('Response', { exact: true }).fill('Be kind to each other.');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
  assert.equal(
    new Store(settings.file, defaults, validateSettings).read().responses.at(-1).name,
    'rules',
  );
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Fill in discordToken' }).waitFor();
  const dataDir = path.resolve('data');
  fs.mkdirSync(dataDir, { recursive: true });
  await page.screenshot({ path: path.join(dataDir, 'admin-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await row.getByRole('button', { name: 'Remove command' }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
  assert.equal(settings.read().responses.length, 1);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#login').waitFor({ state: 'visible' });
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: local QR enrollment/confirmation, encrypted storage, secret removal from DOM, revocation, login, command editing, responsive layout and logout; no page errors.',
  );
} finally {
  await browser?.close();
  await host.disconnect();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
