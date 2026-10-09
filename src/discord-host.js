import { workoutDefinition } from './workout/discord.js';
import { Client, GatewayIntentBits, Events, Routes, Partials } from 'discord.js';
import { once } from 'node:events';
import { connectionIssues, snowflake } from './config.js';
import { definitions, developerDefinitions } from './commands/definitions.js';
import { makeHandler } from './commands/handler.js';
export class DiscordHost {
  constructor(deps) {
    Object.assign(this, deps);
    this.deps = deps;
    this.state = 'offline';
    this.registered = [];
    this.syncing = false;
    this.lastError = '';
    this.lifecycleBusy = false;
    this.createClient();
  }
  createClient() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
      allowedMentions: { parse: [] },
      rest: { timeout: 15000 },
    });
    this.client.on(Events.InteractionCreate, makeHandler({ ...this.deps, client: this.client }));
    this.client.on(Events.ClientReady, () => {
      this.state = 'online';
      this.logger.log('info', 'Discord connected');
    });
    this.client.on(Events.Error, (error) => {
      this.lastError = this.logger.redact(error.message);
      this.logger.log('error', 'Discord client error', { message: error.message });
    });
    this.client.on(Events.ShardReconnecting, () => {
      this.state = 'reconnecting';
    });
    this.client.on(Events.ShardResume, () => {
      this.state = 'online';
    });
    this.client.on(Events.ShardDisconnect, () => {
      this.state = 'disconnected';
    });
    this.client.rest.on('rateLimited', () =>
      this.logger.log('info', 'Discord rate limit encountered; SDK is pacing requests.'),
    );
  }
  async connect() {
    if (this.lifecycleBusy || ['connecting', 'online', 'reconnecting'].includes(this.state))
      throw new Error('Bot is already connected or connecting.');
    const issues = connectionIssues(this.config);
    if (issues.length) throw new Error(issues.join(' '));
    this.lifecycleBusy = true;
    this.state = 'connecting';
    try {
      // A destroyed discord.js client cannot be reused reliably; create fresh event handlers too.
      if (this.client.ws.destroyed) this.createClient();
      await this.client.login(this.config.discordToken);
      if (!this.client.isReady())
        await once(this.client, Events.ClientReady, { signal: AbortSignal.timeout(30000) });
      if (this.client.application.id !== this.config.applicationId) {
        await this.client.destroy();
        throw new Error('applicationId does not match the bot token.');
      }
      this.state = 'online';
      this.lastError = '';
    } catch (e) {
      await this.client.destroy();
      this.state = 'offline';
      this.lastError = this.logger.redact(e.message);
      throw e;
    } finally {
      this.lifecycleBusy = false;
    }
  }
  async disconnect() {
    if (this.lifecycleBusy) throw new Error('Wait for the current connection operation to finish.');
    this.lifecycleBusy = true;
    try {
      this.security?.revoke();
      this.runner.cancel?.();
      await this.client.destroy();
      this.state = 'offline';
    } finally {
      this.lifecycleBusy = false;
    }
  }
  async sync() {
    if (!this.client.isReady()) throw new Error('Connect the bot first.');
    if (this.syncing) throw new Error('A command sync is already running.');
    this.syncing = true;
    this.registered = [];
    try {
      const body = definitions(this.settings.read());
      for (const guildId of this.config.guildIds) {
        const result = await this.client.rest.put(
          Routes.applicationGuildCommands(this.config.applicationId, guildId),
          { body },
        );
        this.registered.push({ guildId, commands: result.map((c) => c.name) });
      }
      // Upsert only our DM commands; do not wipe unrelated global commands.
      const dmCommands = [
        ...developerDefinitions(this.settings.read()),
        ...(!this.settings.read().disabled.includes('workout') ? [workoutDefinition()] : []),
      ];
      const existing = await this.client.rest.get(
        Routes.applicationCommands(this.config.applicationId),
      );
      for (const command of dmCommands)
        await this.client.rest.post(Routes.applicationCommands(this.config.applicationId), {
          body: command,
        });
      if (this.settings.read().disabled.includes('customcommand')) {
        for (const command of existing.filter((c) => c.name === 'customcommand'))
          await this.client.rest.delete(
            Routes.applicationCommand(this.config.applicationId, command.id),
          );
      }
      if (this.settings.read().disabled.includes('workout')) {
        for (const command of existing.filter((c) => c.name === 'workout'))
          await this.client.rest.delete(
            Routes.applicationCommand(this.config.applicationId, command.id),
          );
      }
      this.registered.push({ scope: 'bot DM', commands: dmCommands.map((c) => c.name) });
      this.logger.log('info', 'Guild and bot DM commands synchronized');
      return await this.refreshRegistered();
    } finally {
      this.syncing = false;
    }
  }
  async refreshRegistered() {
    if (!this.client.isReady()) throw new Error('Connect the bot first.');
    const result = [];
    for (const guildId of this.config.guildIds) {
      const commands = await this.client.rest.get(
        Routes.applicationGuildCommands(this.config.applicationId, guildId),
      );
      result.push({
        guildId,
        commands: commands.map((c) => ({ id: c.id, name: c.name, type: c.type })),
      });
    }
    const global = await this.client.rest.get(
      Routes.applicationCommands(this.config.applicationId),
    );
    result.push({
      scope: 'global',
      commands: global.map((c) => ({ id: c.id, name: c.name, type: c.type, contexts: c.contexts })),
    });
    this.registered = result;
    return result;
  }
  async removeRegistered({ commandId, guildId = null }) {
    if (!this.client.isReady()) throw new Error('Connect the bot first.');
    if (
      !snowflake(commandId) ||
      (guildId !== null && (!snowflake(guildId) || !this.config.guildIds.includes(guildId)))
    )
      throw new Error('Invalid command ID or unconfigured server.');
    if (this.syncing) throw new Error('Wait for the current command update to finish.');
    this.syncing = true;
    try {
      const groups = await this.refreshRegistered();
      const group = groups.find((g) =>
        guildId === null ? g.scope === 'global' : g.guildId === guildId,
      );
      const command = group?.commands.find((c) => c.id === commandId);
      if (!command) throw new Error('Command no longer exists in this scope. Refresh the list.');
      const route =
        guildId === null
          ? Routes.applicationCommand(this.config.applicationId, commandId)
          : Routes.applicationGuildCommand(this.config.applicationId, guildId, commandId);
      await this.client.rest.delete(route);
      group.commands = group.commands.filter((c) => c.id !== commandId);
      this.logger.log('info', 'Discord command registration removed', {
        name: command.name,
        commandId,
        guildId,
      });
      return this.registered;
    } finally {
      this.syncing = false;
    }
  }
  status() {
    return {
      state: this.state,
      ready: this.client.isReady(),
      username: this.client.user?.tag ?? null,
      latency: this.client.ws.ping,
      issues: connectionIssues(this.config),
      lastError: this.lastError,
      guilds: this.client.guilds.cache.map((g) => ({
        id: g.id,
        name: g.name,
        members: g.memberCount,
        configured: this.config.guildIds.includes(g.id),
      })),
      commands: definitions(this.settings.read()).map((c) => c.name),
      registered: this.registered,
      customBusy: this.runner.busy,
    };
  }
}
