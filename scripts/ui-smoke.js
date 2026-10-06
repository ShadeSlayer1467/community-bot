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
import { NotificationCredential } from '../src/notifications/credential.js';
import { notificationDefaults, validateNotificationSettings } from '../src/notifications/model.js';
import { NotificationDelivery } from '../src/notifications/delivery.js';
import { NotificationService } from '../src/notifications/service.js';
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
const notifications = new NotificationService({
  settings: new Store(
    path.join(directory, 'notifications.json'),
    notificationDefaults(config),
    validateNotificationSettings,
  ),
  credential: new NotificationCredential(
    new Store(path.join(directory, 'notification-credential.json'), {}),
  ),
  delivery: new NotificationDelivery(host),
  logger,
});
const server = createAdmin({ config, settings, host, logger, runner, security, notifications });
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
  await page.locator('#notifyMode').selectOption('dm');
  await page.locator('#notifyDmFields').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notifyUser').inputValue(), config.customOwnerId);
  await page.locator('#notifyEnabled').check();
  await page.getByRole('button', { name: 'Save notification settings', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Notification settings saved' }).waitFor();
  assert.equal(await page.locator('#actionToast').isVisible(), true);
  assert.match(await page.locator('#actionToast').textContent(), /Notification settings saved/);
  const toastBox = await page.locator('#actionToast').boundingBox();
  assert.ok(toastBox.y >= 0 && toastBox.y + toastBox.height <= 1100);
  await page.getByRole('button', { name: 'Validate destination', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Discord is disconnected' }).waitFor();
  assert.equal(await page.locator('#actionToast').getAttribute('data-kind'), 'error');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#notifyRotate').click();
  await page.locator('#notifySecretBox').waitFor({ state: 'visible' });
  const notificationToken = await page.locator('#notifySecret').inputValue();
  assert.ok(notifications.credential.accepts('Bearer ' + notificationToken));
  assert.equal(await page.locator('#notifySecret').getAttribute('type'), 'password');
  assert.ok(!(await page.locator('#notifyHistory').textContent()).includes(notificationToken));
  await page.locator('#notifyClear').click();
  assert.equal(await page.locator('#notifySecret').inputValue(), '');
  const deliveries = [];
  notifications.delivery = {
    resolve: async (s) => ({
      label: s.mode === 'dm' ? 'Test DM' : 'Test Server / #notifications',
      mode: s.mode,
    }),
    send: async (s) => {
      deliveries.push(s);
      return s.mode === 'dm' ? 'Test DM' : 'Test Server / #notifications';
    },
  };
  await page.locator('#notifyTest').click();
  await page.locator('#notice').filter({ hasText: 'Test notification: delivered' }).waitFor();
  assert.equal(deliveries.at(-1).mode, 'dm');
  await page.locator('#notifyMode').selectOption('guild');
  await page.locator('#notifyGuild').fill('100000000000000002');
  await page.locator('#notifyChannel').fill('100000000000000003');
  await page.getByRole('button', { name: 'Save notification settings', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Notification settings saved' }).waitFor();
  await page.locator('#notifyTest').click();
  await page.locator('#notice').filter({ hasText: 'Test notification: delivered' }).waitFor();
  assert.equal(deliveries.at(-1).mode, 'guild');
  await page.locator('#notifyMode').selectOption('agents');
  await page.locator('#notifyAgentFields').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#notifyChannelField').isVisible(), false);
  await page.locator('#notifyCategory').fill('100000000000000004');
  await page.getByRole('button', { name: 'Save notification settings', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Notification settings saved' }).waitFor();
  assert.equal(notifications.settings.read().mode, 'agents');
  assert.equal(notifications.settings.read().categoryId, '100000000000000004');
  assert.equal(
    new Store(notifications.settings.file, {}, validateNotificationSettings).read().channelId,
    '100000000000000003',
  );
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
    'Browser smoke passed: notifications credential masking/clearing, persistence, validation error, DM/channel switch and test delivery; plus authenticator enrollment, command editing, responsive layout and logout. No page errors; no live Discord sends.',
  );
} finally {
  notifications.close();
  await browser?.close();
  await host.disconnect();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
