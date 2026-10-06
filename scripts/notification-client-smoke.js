// Run after dotnet build examples/notifications/csharp. No Discord connection or real credential.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { Store } from '../src/persistence.js';
import { createAdmin } from '../src/admin/server.js';
import { NotificationService } from '../src/notifications/service.js';
import { NotificationCredential } from '../src/notifications/credential.js';
import { notificationDefaults, validateNotificationSettings } from '../src/notifications/model.js';
import { sendNotification } from '../examples/notifications/notify.mjs';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notification-client-'));
const credential = new NotificationCredential(new Store(path.join(dir, 'credential.json'), {}));
const token = credential.rotate();
const config = { port: 0, adminPassword: 'unused-test-admin-password' };
const delivered = [];
const notifications = new NotificationService({
  settings: new Store(
    path.join(dir, 'settings.json'),
    { ...notificationDefaults({}), enabled: true, mode: 'dm', userId: '100000000000000001' },
    validateNotificationSettings,
  ),
  credential,
  logger: { log() {}, redact: (s) => s },
  delivery: {
    send: async (s, p) => {
      delivered.push(p);
      return 'Test recipient';
    },
  },
});
const server = createAdmin({ config, notifications, logger: { log() {} } });
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  config.port = server.address().port;
  const endpoint = `http://127.0.0.1:${config.port}/api/notifications`;
  const result = await sendNotification(
    {
      source: 'JS App',
      severity: 'info',
      title: 'Client check',
      message: 'Example client integration',
    },
    { endpoint, token },
  );
  assert.equal(result.status, 'delivered');
  await assert.rejects(
    sendNotification({ channelId: 'not-allowed' }, { endpoint, token }),
    (e) => e.code === 'invalid_payload',
  );
  const child = spawn(
    'dotnet',
    ['run', '--no-build', '--project', 'examples/notifications/csharp'],
    {
      env: {
        ...process.env,
        COMMUNITY_NOTIFICATION_TOKEN: token,
        COMMUNITY_NOTIFICATION_URL: endpoint,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  child.stdout.resume();
  child.stderr.resume();
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].source, 'Build Agent');
  assert.equal(delivered[1].severity, 'attention');
  console.log(
    'JavaScript and compiled C# callers delivered through the real local HTTP endpoint with stub Discord delivery. No live messages sent.',
  );
} finally {
  notifications.close();
  server.closeAllConnections();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
