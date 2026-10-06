import { createHash } from 'node:crypto';
import { ChannelType, PermissionFlagsBits as P } from 'discord.js';
import { fail } from './model.js';

export class AgentChannels {
  constructor(store) {
    this.store = store;
    this.pending = Promise.resolve();
  }
  list(settings) {
    return this.store
      .read()
      .filter((r) => r.guildId === settings.guildId && r.categoryId === settings.categoryId);
  }
  async category(guild, categoryId) {
    let category;
    try {
      category = await guild.channels.fetch(categoryId, { force: true });
    } catch {
      fail('invalid_category', 'Cannot access the notification category. Check its ID.', 502);
    }
    if (!category || category.type !== ChannelType.GuildCategory || category.guildId !== guild.id)
      fail('invalid_category', 'Choose a category in the configured notification server.', 502);
    return category;
  }
  async createCategory(guild, ownerIds, botId) {
    const permissions = [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory];
    const existing = await guild.channels.fetch();
    if (
      existing.some(
        (c) =>
          c.type === ChannelType.GuildCategory && c.name.toLowerCase() === 'agent notifications',
      )
    )
      fail(
        'category_exists',
        'Agent Notifications already exists. Enter its category ID instead of creating another.',
      );
    const category = await guild.channels.create({
      name: 'Agent Notifications',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, type: 0, deny: [P.ViewChannel] },
        ...[...new Set([...ownerIds, botId])].map((id) => ({ id, type: 1, allow: permissions })),
      ],
      reason: 'Local admin configured agent notification routing',
    });
    return category.id;
  }
  // Serialize creation, including concurrent callers and first notifications from new agents.
  resolve(guild, categoryId, source, signal) {
    const work = this.pending.then(() => this.resolveLocked(guild, categoryId, source, signal));
    this.pending = work.catch(() => {});
    return work;
  }
  async resolveLocked(guild, categoryId, source, signal) {
    signal?.throwIfAborted();
    await this.category(guild, categoryId);
    const key = createHash('sha256')
      .update(source.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' '))
      .digest('hex');
    const saved = this.store.read();
    const entry = saved.find(
      (r) => r.guildId === guild.id && r.categoryId === categoryId && r.key === key,
    );
    const channels = await guild.channels.fetch();
    const children = channels.filter((c) => c.parentId === categoryId);
    let channel = entry && channels.get(entry.channelId);
    if (channel && (channel.parentId !== categoryId || channel.type !== ChannelType.GuildText))
      fail(
        'agent_channel_moved',
        'An agent channel was moved or changed. Return it to the configured category before sending.',
        502,
      );
    const marker = `Community Bot agent source: ${key}`;
    channel ||= children.find((c) => c.type === ChannelType.GuildText && c.topic === marker);
    if (!channel) {
      if (
        children.size >= 25 ||
        (!entry &&
          saved.filter((r) => r.guildId === guild.id && r.categoryId === categoryId).length >= 25)
      )
        fail(
          'agent_limit',
          'This category has reached its 25-agent/channel limit. Use stable source names; configure another category if needed.',
          429,
          60,
        );
      const member = await guild.members.fetchMe({ force: true });
      const category = channels.get(categoryId);
      if (
        !category
          ?.permissionsFor(member)
          ?.has([P.ManageChannels, P.ViewChannel, P.SendMessages, P.EmbedLinks])
      )
        fail(
          'missing_permissions',
          'Bot needs Manage Channels, View Channel, Send Messages and Embed Links in the agent category.',
          502,
        );
      let name =
        source
          .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
          .normalize('NFKD')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || 'agent';
      if (children.some((c) => c.name === name)) name += '-' + key.slice(0, 8);
      signal?.throwIfAborted();
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: categoryId,
        permissionOverwrites: category.permissionOverwrites?.cache.map((o) => ({
          id: o.id,
          type: o.type,
          allow: o.allow,
          deny: o.deny,
        })),
        topic: marker,
        reason: 'First notification from a local agent',
      });
    }
    signal?.throwIfAborted();
    const record = {
      guildId: guild.id,
      categoryId,
      key,
      source,
      channelId: channel.id,
      channelName: channel.name,
    };
    this.store.save([
      ...saved.filter(
        (r) => !(r.guildId === guild.id && r.categoryId === categoryId && r.key === key),
      ),
      record,
    ]);
    return channel;
  }
}
