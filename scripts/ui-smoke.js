import { WorkoutRepository } from '../src/workout/repository.js';
import { WorkoutService } from '../src/workout/service.js';
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
const logger = {
  log() {},
  recent: [
    { time: '2026-10-09T00:00:00Z', level: 'info', message: 'Browser fixture ready', details: '' },
  ],
  redact: (value) => value,
};
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
const workout = new WorkoutService(
  new WorkoutRepository(path.join(directory, 'workout'), config.ownerIds),
);
const server = createAdmin({
  config,
  settings,
  host,
  logger,
  runner,
  security,
  notifications,
  workout,
});
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
  const navigate = async (name) => {
    await page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
    await page.locator('#pageTitle').filter({ hasText: name }).waitFor();
  };
  assert.equal(await page.locator('#pageTitle').textContent(), 'Home');
  await navigate('CustomCommand');
  await page.reload();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pageTitle').textContent(), 'CustomCommand');
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
  await page.locator('#timeout').fill('17');
  await page.getByRole('button', { name: 'Save execution settings' }).click();
  await page.locator('#notice').filter({ hasText: 'Saved.' }).waitFor();
  assert.equal(settings.read().customTimeoutSeconds, 17);
  await navigate('Commands');
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
  assert.equal(settings.read().customTimeoutSeconds, 17);
  await navigate('Logs');
  assert.match(await page.locator('#logText').textContent(), /Browser fixture ready/);
  await page.locator('#refresh').click();
  await page.locator('#notice').filter({ hasText: 'Status and logs refreshed' }).waitFor();
  await navigate('Settings');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Fill in discordToken' }).waitFor();
  await navigate('Notifications');
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
  for (const name of [
    'Home',
    'Workout',
    'Kingshot',
    'Logs',
    'Settings',
    'CustomCommand',
    'Notifications',
    'Commands',
  ]) {
    await navigate(name);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.equal(await page.locator('#navigation [aria-current=page]').textContent(), name);
  }
  await row.getByRole('button', { name: 'Remove command' }).click();
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
  assert.equal(settings.read().responses.length, 1);
  await page.screenshot({ path: path.join(dataDir, 'admin-mobile-preview.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await navigate('Workout');
  const workoutPage = async (name) => {
    await page
      .getByRole('navigation', { name: 'Workout pages', exact: true })
      .getByRole('link', { name, exact: true })
      .click();
    await page
      .locator('#workoutContent')
      .getByRole('heading', {
        name:
          name === 'Exercises'
            ? 'Exercise library'
            : name === 'Programs'
              ? 'Programs'
              : name === 'Active'
                ? 'Active workout'
                : name === 'History'
                  ? 'Workout history'
                  : name === 'Overview'
                    ? 'Workout overview'
                    : name === 'Settings'
                      ? 'Workout settings'
                      : 'Progression',
        exact: true,
      })
      .waitFor();
  };
  await workoutPage('Exercises');
  assert.ok(workout.catalog(config.customOwnerId).exercises.length >= 400);
  await page.getByLabel('Search exercises by name or alias', {exact:true}).fill('BW squat');
  await page.getByRole('button', {name:'Edit Bodyweight Squat',exact:true}).waitFor();
  assert.equal(await page.getByRole('button', {name:/^Edit /}).count(),1);
  await page.getByLabel('Search exercises by name or alias', {exact:true}).fill('');
  await page.getByLabel('Exercise category', {exact:true}).selectOption('Chest');
  await page.getByLabel('Exercise equipment', {exact:true}).selectOption('Cable');
  await page.getByRole('button', {name:'Edit Cable Fly',exact:true}).waitFor();
  assert.ok(await page.getByRole('button', {name:/^Edit /}).count() < 25);
  await page.getByLabel('Exercise category', {exact:true}).selectOption('');
  await page.getByLabel('Exercise equipment', {exact:true}).selectOption('');
  const exerciseEditor = page.locator('#exerciseEditor');
  await exerciseEditor.getByLabel('Exercise name', { exact: true }).fill('Bench Press');
  await exerciseEditor.getByLabel('Variation / machine settings').fill('Paused');
  await exerciseEditor.getByLabel('Load (per implement / side when selected)').fill('225');
  await exerciseEditor.getByRole('button', { name: 'Save exercise', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Workout changes saved' }).waitFor();
  assert.ok(workout.catalog(config.customOwnerId).exercises.some(e => e.name === 'Bench Press' && e.variation === 'Paused'));
  await workoutPage('Programs');
  let programEditor = page.locator('#programEditor');
  await programEditor.getByLabel('Program name', { exact: true }).fill('Strength');
  await programEditor.getByLabel('Planned workout name', { exact: true }).fill('Push A');
  await programEditor.getByLabel('Search Exercise to add by name or alias', { exact: true }).fill('bench');
  assert.ok(await programEditor.getByLabel('Exercise to add', { exact: true }).locator('option').count() < 25);
  await programEditor
    .getByLabel('Exercise to add', { exact: true })
    .selectOption({ label: 'Bench Press' });
  await programEditor.getByRole('button', { name: 'Add exercise to plan', exact: true }).click();
  await programEditor.getByRole('button', { name: 'Save program', exact: true }).click();
  await page.locator('#notice').filter({ hasText: 'Workout changes saved' }).waitFor();
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Set Push A as Next', exact: true })
    .waitFor();
  const workoutProgram = workout.catalog(config.customOwnerId).programs[0];
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Set Push A as Next', exact: true })
    .click();
  await page.locator('#workoutNextSelection').filter({ hasText: 'Strength → Push A' }).waitFor();
  assert.equal(
    workout.repo.preferences().plans[config.customOwnerId].templateId,
    workoutProgram.templates[0].id,
  );
  assert.ok(!(await page.locator('#workoutContent').textContent()).includes(workoutProgram.id));
  assert.equal(workoutProgram.templates[0].exercises[0].resistance.value, 225);
  await workoutPage('Overview');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Start planned workout', exact: true })
    .click();
  await page
    .locator('#workoutContent')
    .getByText('Continue active workout', { exact: true })
    .waitFor();
  await workoutPage('Active');
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('Reps to log', { exact: true }).fill('12');
    await page
      .locator('#workoutContent')
      .getByRole('button', { name: 'Log Set', exact: true })
      .click();
    await page.waitForFunction(
      (n) => document.querySelectorAll('#workoutContent table tr').length === n + 2,
      i,
    );
  }
  assert.equal(workout.active(config.customOwnerId).exercises[0].sets.length, 3);
  await page.reload();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  await page.getByLabel('Reps to log', { exact: true }).waitFor();
  assert.equal(workout.active(config.customOwnerId).exercises[0].workingResistance.value, 225);
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Finish Workout', exact: true })
    .click();
  await page
    .locator('#workoutContent')
    .getByText('No active workout. Start planned or free from Overview.', { exact: true })
    .waitFor();
  await workoutPage('History');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Accept Progression', exact: true })
    .waitFor();
  await page.screenshot({
    path: path.join(dataDir, 'workout-history-preview.png'),
    fullPage: true,
  });
  page.once('dialog', (dialog) => dialog.accept());
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Accept Progression', exact: true })
    .click();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll('#workoutContent button')].some(
        (b) => b.textContent === 'Accept Progression',
      ),
  );
  assert.equal(
    workout.catalog(config.customOwnerId).programs[0].templates[0].exercises[0].resistance.value,
    230,
  );
  await page.getByLabel('Exercise history', { exact: true }).selectOption({ label: 'Bench Press' });
  await page
    .locator('#workoutContent')
    .getByRole('heading', { name: 'Exercise performance timeline' })
    .waitFor();
  assert.equal(await page.locator('#workoutContent meter').count(), 3);
  await navigate('Home');
  assert.match(await page.locator('#summaries').textContent(), /Workout.*Next: Push A/);
  await navigate('Workout');
  await workoutPage('Overview');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Start free workout', exact: true })
    .click();
  await page
    .locator('#workoutContent')
    .getByText('Continue active workout', { exact: true })
    .waitFor();
  await workoutPage('Active');
  await page.getByLabel('Exercise to add', { exact: true }).selectOption({ label: 'Bench Press' });
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Add exercise', exact: true })
    .click();
  await page.getByLabel('Reps to log', { exact: true }).waitFor();
  await page.getByLabel('Reps to log', { exact: true }).fill('8');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Log Set', exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#workoutContent select option')].some(
      (o) => o.textContent === 'Set 1',
    ),
  );
  await page.locator('#workoutContent').getByText('Edit / delete a set', { exact: true }).click();
  await page.getByLabel('Set to edit', { exact: true }).selectOption({ label: 'Set 1' });
  await page.getByLabel('Reps', { exact: true }).fill('9');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Save set edit', exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#workoutContent td')].some((e) => e.textContent === '9'),
  );
  await page.locator('#workoutContent').getByText('Change Weight', { exact: true }).click();
  await page.getByLabel('Resistance type', { exact: true }).selectOption('pair');
  await page.getByLabel('Load (per implement / side when selected)', { exact: true }).fill('135');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Use this working resistance', exact: true })
    .click();
  await page
    .locator('#workoutContent')
    .getByText('Working resistance: 2 × 135 lb', { exact: true })
    .waitFor();
  await page.getByLabel('Reps to log', { exact: true }).fill('7');
  await page
    .locator('#workoutContent')
    .getByRole('button', { name: 'Log Set', exact: true })
    .click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#workoutContent td')].some(
      (e) => e.textContent === '2 × 135 lb',
    ),
  );
  assert.equal(workout.active(config.customOwnerId).exercises[0].sets[1].resistance.kind, 'pair');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of [
    'Overview',
    'Programs',
    'Exercises',
    'History',
    'Progression',
    'Active',
    'Settings',
  ]) {
    await workoutPage(name);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  await workoutPage('Active');
  await page.screenshot({ path: path.join(dataDir, 'workout-mobile-preview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.locator('#login').waitFor({ state: 'visible' });
  await page.goto(`http://127.0.0.1:${config.port}/notifications`);
  await page.locator('#login').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#dashboard').isVisible(), false);
  await page.getByLabel('Admin password', { exact: true }).fill(config.adminPassword);
  await page.getByRole('button', { name: 'Unlock panel' }).click();
  await page.locator('#dashboard').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#pageTitle').textContent(), 'Notifications');
  await navigate('Home');
  await page.goBack();
  assert.equal(await page.locator('#pageTitle').textContent(), 'Notifications');
  assert.deepEqual(errors, []);
  console.log(
    'Browser smoke passed: Workout program/exercise CRUD, planned/free sessions, set edits, load carry-forward, confirmed finish, progression acceptance, timeline, deep refresh and mobile subpages; module navigation/active links, deep refresh/login redirects/back, module saves, logs, all-page mobile layout; notifications credential masking/clearing, persistence, validation error, DM/channel switch and test delivery; plus authenticator enrollment, command editing, responsive layout and logout. No page errors; no live Discord sends.',
  );
} finally {
  notifications.close();
  await browser?.close();
  await host.disconnect();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(directory, { recursive: true, force: true });
}
