import { ChannelType, PermissionFlagsBits, Routes } from 'discord.js';
import { fail, NotificationError } from './model.js';

export class NotificationDelivery {
  constructor(host, agents) {
    this.host = host;
    this.agents = agents;
  }
  async resolve(settings, source, signal) {
    const client = this.host.client;
    if (!client.isReady())
      fail('disconnected', 'Discord is disconnected. Connect the bot first.', 503);
    if (settings.mode === 'dm') {
      let user;
      try {
        user = await client.users.fetch(settings.userId, { force: true });
      } catch {
        fail('invalid_recipient', 'Cannot resolve the configured Discord user.', 502);
      }
      if (!user || user.bot) fail('invalid_recipient', 'Choose a valid human Discord user.', 502);
      return {
        send: async (payload, signal) => {
          signal?.throwIfAborted();
          const dm = await user.createDM();
          signal?.throwIfAborted();
          return client.rest.post(Routes.channelMessages(dm.id), { body: payload, signal });
        },
        label: `DM: ${user.tag || user.username}`,
        mode: 'dm',
      };
    }
    let guild, channel, member;
    try {
      guild = await client.guilds.fetch(settings.guildId);
    } catch {
      fail(
        'invalid_guild',
        'Cannot access the configured server. Check the Guild ID and bot membership.',
        502,
      );
    }
    if (!guild) fail('invalid_guild', 'Configured server was not found.', 502);
    if (settings.mode === 'agents') {
      if (!this.agents) fail('unavailable', 'Agent channel service is unavailable.', 503);
      if (!source) {
        const category = await this.agents.category(guild, settings.categoryId);
        const bot = await guild.members.fetchMe({ force: true });
        if (
          !category
            .permissionsFor(bot)
            ?.has([
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ])
        )
          fail(
            'missing_permissions',
            'Bot needs Manage Channels, View Channel, Send Messages and Embed Links in the agent category.',
            502,
          );
        return {
          label: `${guild.name} / ${category.name} — one channel per source`,
          mode: 'agents',
        };
      }
      channel = await this.agents.resolve(guild, settings.categoryId, source, signal);
    }
    try {
      channel ||= await guild.channels.fetch(settings.channelId, { force: true });
    } catch {
      fail('invalid_channel', 'Cannot access the configured channel. Check the Channel ID.', 502);
    }
    if (
      !channel ||
      channel.guildId !== guild.id ||
      ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)
    )
      fail(
        'invalid_channel',
        'Choose a text or announcement channel in the configured server.',
        502,
      );
    try {
      member = await guild.members.fetchMe({ force: true });
    } catch {
      fail('missing_permissions', 'Cannot resolve bot permissions in the destination server.', 502);
    }
    const perms = channel.permissionsFor(member);
    if (
      !perms?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
    )
      fail(
        'missing_permissions',
        'Bot needs View Channel, Send Messages, and Embed Links in the destination.',
        502,
      );
    return {
      send: (payload, signal) =>
        client.rest.post(Routes.channelMessages(channel.id), { body: payload, signal }),
      label: `${guild.name} / #${channel.name}`,
      mode: 'guild',
    };
  }
  async send(settings, notification, signal) {
    const target = await this.resolve(settings, notification.source, signal);
    signal?.throwIfAborted();
    const colors = {
      info: 0x3498db,
      success: 0x2ecc71,
      warning: 0xf1c40f,
      error: 0xe74c3c,
      attention: 0xe67e22,
    };
    try {
      await target.send(
        {
          allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
          embeds: [
            {
              title: notification.title,
              description: notification.message,
              color: colors[notification.severity],
              author: { name: notification.source },
              footer: { text: notification.severity.toUpperCase() },
              timestamp: notification.timestamp,
              fields: Object.entries(notification.context).map(([name, value]) => ({
                name,
                value: String(value) || '(empty)',
                inline: true,
              })),
            },
          ],
        },
        signal,
      );
      return target.label;
    } catch (e) {
      if (e instanceof NotificationError) throw e;
      if (e.status === 429 || e.name === 'RateLimitError')
        fail('discord_rate_limit', 'Discord is rate limiting delivery. Retry later.', 429, 60);
      if (target.mode === 'dm')
        fail(
          'dm_delivery_failed',
          'Discord could not deliver the DM. Check recipient privacy settings and shared server membership.',
          502,
        );
      fail(
        'delivery_failed',
        'Discord delivery failed. Check connection and destination permissions before retrying.',
        502,
      );
    }
  }
}
