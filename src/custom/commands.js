import fs from 'node:fs';
import path from 'node:path';
import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { root, snowflake } from '../config.js';
import { purge, moderate } from '../services/moderation.js';

const names = new Set(['customcommand', 'owner-auth', 'owner-lock']);
const modalId = 'developer-totp';

// A DM invocation has no guild permissions. Resolve an explicit TARGET separately,
// and use freshly fetched guild members for the checked moderation helpers.
async function targetContext(i, config, client) {
  const guildId = i.options.getString('guild-id');
  const channelId = i.options.getString('channel-id');
  if (!guildId && !channelId) return null;
  if (!snowflake(guildId) || !config.guildIds.includes(guildId))
    throw new Error('Choose a configured target guild-id.');
  if (channelId && !snowflake(channelId)) throw new Error('Invalid target channel-id.');
  const guild = await client.guilds.fetch(guildId);
  const channel = channelId ? await guild.channels.fetch(channelId) : null;
  if (channelId && (!channel || channel.guildId !== guildId))
    throw new Error('Target channel must belong to the selected server.');
  const [actor, bot] = await Promise.all([
    guild.members.fetch({ user: i.user.id, force: true }),
    guild.members.fetchMe({ force: true }),
  ]);
  return {
    guild,
    guildId,
    channel,
    channelId,
    user: i.user,
    memberPermissions: channel ? channel.permissionsFor(actor) : actor.permissions,
    appPermissions: channel ? channel.permissionsFor(bot) : bot.permissions,
  };
}

export function createDeveloperHandler({ config, settings, logger, runner, client, security }) {
  return {
    handles: (i) =>
      (i.isChatInputCommand?.() && names.has(i.commandName)) ||
      (i.isModalSubmit?.() && i.customId === modalId),
    async handle(i) {
      try {
        if (!security) throw new Error('Developer authentication is not configured.');
        security.requireOwnerDm(i);
        if (i.isModalSubmit?.()) {
          await i.deferReply({ flags: MessageFlags.Ephemeral });
          await security.authenticate(i, i.fields.getTextInputValue('code'));
          logger.log('info', 'Developer authenticated', { userId: i.user.id });
          return await i.editReply({
            content:
              'Developer access enabled for five minutes in this bot DM. Use /owner-lock to revoke it.',
            allowedMentions: { parse: [] },
          });
        }
        if (i.commandName === 'owner-auth') {
          const modal = new ModalBuilder()
            .setCustomId(modalId)
            .setTitle('Developer authentication')
            .addComponents(
              new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                  .setCustomId('code')
                  .setLabel('Six-digit authenticator code')
                  .setStyle(TextInputStyle.Short)
                  .setMinLength(6)
                  .setMaxLength(6)
                  .setRequired(true),
              ),
            );
          return await i.showModal(modal);
        }
        if (i.commandName === 'owner-lock') {
          security.revoke();
          return await i.reply({
            content: 'Developer access revoked. Any active custom operation was cancelled.',
            flags: MessageFlags.Ephemeral,
          });
        }
        if (settings.read().disabled.includes('customcommand'))
          throw new Error('CustomCommand is disabled.');
        const authorization = security.authorizeExecution(i);
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        const target = await targetContext(i, config, client);
        const file = path.join(root, 'custom', 'CustomCommand.local.mjs');
        if (!fs.existsSync(file))
          throw new Error('Create custom/CustomCommand.local.mjs from the local example first.');
        const output = await runner.run({
          authorization,
          file,
          timeoutMs: settings.read().customTimeoutSeconds * 1000,
          context: {
            guildId: target?.guildId ?? null,
            channelId: target?.channelId ?? null,
            args: i.options.getString('args') ?? '',
          },
          dispatch: async (method, args, signal) => {
            security.validateExecution(authorization);
            if (settings.read().disabled.includes('customcommand'))
              throw new Error('CustomCommand was disabled.');
            signal.throwIfAborted();
            logger.log('info', 'Custom API operation', { method, userId: i.user.id });
            if (['purge', 'ban', 'kick'].includes(method) && !target)
              throw new Error('Specify a target guild-id, and channel-id for purge.');
            if (method === 'purge') return purge(target, args[0], signal);
            if (method === 'ban' || method === 'kick')
              return moderate(target, method, args[0], args[1], signal);
            if (method === 'inspect')
              return target
                ? { id: target.guildId, name: target.guild.name, members: target.guild.memberCount }
                : { context: 'bot DM', userId: i.user.id };
            if (method === 'log') {
              logger.log('info', args[0]);
              return true;
            }
            if (method === 'discord') {
              const [verb, route, body] = args;
              if (
                !['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(verb) ||
                typeof route !== 'string' ||
                !/^\/[a-z][a-z0-9/_?=&%-]*$/i.test(route)
              )
                throw new Error('Use a relative Discord API route.');
              return client.rest[verb.toLowerCase()](route, { body, signal });
            }
            throw new Error('Unknown custom API method.');
          },
        });
        await i.editReply({
          content: logger.redact(output).slice(0, 1900) || 'Completed.',
          allowedMentions: { parse: [] },
        });
      } catch (error) {
        // Never log submitted authenticator fields or interaction payloads.
        logger.log('warn', 'Developer request denied or failed', {
          userId: i.user?.id,
          error: logger.redact(error?.message ?? 'Unknown developer error').slice(0, 500),
        });
        const message = {
          content: logger.redact(error.message).slice(0, 1900),
          allowedMentions: { parse: [] },
        };
        try {
          if (i.deferred || i.replied) await i.editReply(message);
          else await i.reply({ ...message, flags: MessageFlags.Ephemeral });
        } catch {
          logger.log('warn', 'Could not deliver developer response');
        }
      }
    },
  };
}
