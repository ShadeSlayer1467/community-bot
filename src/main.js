import path from 'node:path';
import { loadConfig, root } from './config.js';
import { Store } from './persistence.js';
import { defaults, validateSettings } from './settings.js';
import { createLogger } from './logging.js';
import { CustomRunner } from './custom/runner.js';
import { DiscordHost } from './discord-host.js';
import { createAdmin } from './admin/server.js';
import { WindowsVault } from './security/windows-vault.js';
import { DeveloperAccess } from './security/developer-access.js';
import { connectOnStartup } from './startup.js';
import { NotificationCredential } from './notifications/credential.js';
import { notificationDefaults, validateNotificationSettings } from './notifications/model.js';
import { NotificationDelivery } from './notifications/delivery.js';
import { NotificationService } from './notifications/service.js';
import { AgentChannels } from './notifications/agent-channels.js';
async function main() {
  const config = loadConfig();
  if (!config.adminPassword)
    throw new Error(
      'Fill in adminPassword (at least 16 characters) in config.local.json to start the local panel. Discord credentials may remain blank for offline setup.',
    );
  const security = new DeveloperAccess({
    config,
    vault: new WindowsVault(path.join(root, 'data', 'security', 'totp.dpapi.json')),
  });
  const logger = createLogger(
    path.join(root, 'data'),
    [config.discordToken, config.openaiApiKey, config.adminPassword],
    (value) => security.redact(value),
  );
  const settings = new Store(path.join(root, 'data', 'settings.json'), defaults, validateSettings);
  const tasks = new Store(path.join(root, 'data', 'tasks.json'), []);
  const feedback = new Store(path.join(root, 'data', 'feedback.json'), []);
  const runner = new CustomRunner(logger.log, security);
  security.onRevoke = () => runner.cancel?.();
  const host = new DiscordHost({ config, settings, tasks, feedback, logger, runner, security });
  const notifications = new NotificationService({
    settings: new Store(
      path.join(root, 'data', 'notifications.json'),
      notificationDefaults(config),
      validateNotificationSettings,
    ),
    credential: new NotificationCredential(
      new Store(path.join(root, 'data', 'security', 'notification-credential.json'), {}),
    ),
    delivery: new NotificationDelivery(
      host,
      new AgentChannels(new Store(path.join(root, 'data', 'notification-agent-channels.json'), [])),
    ),
    logger,
  });
  const server = createAdmin({ config, settings, host, logger, runner, security, notifications });
  server.on('error', (e) => {
    logger.log(
      'error',
      e.code === 'EADDRINUSE'
        ? 'Admin port is already in use. Stop the other instance or change port.'
        : e.message,
    );
    process.exitCode = 1;
  });
  let cancelStartup = () => {};
  server.listen(config.port, '127.0.0.1', () => {
    logger.log('info', `Open http://127.0.0.1:${config.port} to configure/connect the bot.`);
    cancelStartup = connectOnStartup(host, logger);
  });
  const stop = async () => {
    cancelStartup();
    notifications.close();
    security.revoke();
    runner.cancel?.();
    try {
      await host.client.destroy();
    } catch (e) {
      logger.log('error', 'Shutdown error', { message: e.message });
    }
    server.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
main().catch((error) => {
  console.error(`Setup error: ${error.message}`);
  process.exitCode = 1;
});
