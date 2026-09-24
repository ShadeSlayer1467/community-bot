import { connectionIssues } from './config.js';

// Retry initial connection while Windows is bringing the network online.
// Once connected, discord.js handles reconnects; manual Disconnect stays respected.
export function connectOnStartup(host, logger, schedule = setTimeout, cancel = clearTimeout) {
  let stopped = false;
  let timer;
  const attempt = async () => {
    if (stopped || host.state === 'online') return;
    if (connectionIssues(host.config).length) {
      logger.log('warn', 'Automatic connection needs configuration. Use the local panel for details.');
      return;
    }
    try {
      await host.connect();
    } catch (error) {
      logger.log('warn', 'Automatic connection failed; retrying in 30 seconds.', {
        message: logger.redact(error.message),
      });
      if (!stopped) timer = schedule(attempt, 30000);
    }
  };
  void attempt();
  return () => { stopped = true; cancel(timer); };
}
