import { randomInt } from 'node:crypto';
import { MessageFlags } from 'discord.js';
import { requireAccess } from '../authorization.js';
import { purge, moderate } from '../services/moderation.js';
import { taskAction } from '../services/tasks.js';
import { ask } from '../services/ai.js';
import { definitions } from './definitions.js';
import { createDeveloperHandler } from '../custom/commands.js';
export function makeHandler({
  config,
  settings,
  tasks,
  feedback,
  logger,
  runner,
  client,
  security,
}) {
  const developer = createDeveloperHandler({ config, settings, logger, runner, client, security });
  const cooldowns = new Map();
  let aiBusy = false;
  return async (i) => {
    if (developer.handles(i)) return developer.handle(i);
    if (!i.isChatInputCommand()) return;
    const s = settings.read();
    const name = i.commandName;
    try {
      requireAccess(i, config, s, 'everyone');
      const response = s.responses.find((c) => c.name === name);
      if (s.disabled.includes(name) || (response && !response.enabled))
        throw new Error('This command is disabled.');
      if (['purge', 'kick', 'ban', 'ask'].includes(name)) requireAccess(i, config, s, 'moderator');
      else if (response) requireAccess(i, config, s, response.access);
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      logger.log('info', 'Command invoked', {
        name,
        userId: i.user.id,
        guildId: i.guildId,
        channelId: i.channelId,
      });
      let output;
      switch (name) {
        case 'help':
          output = definitions(s)
            .map((c) => `/${c.name} — ${c.description}`)
            .join('\n');
          break;
        case 'ping':
          output = `Pong! Gateway latency: ${client.ws.ping} ms.`;
          break;
        case 'server':
          output = `${i.guild.name}\nMembers: ${i.guild.memberCount}\nServer ID: ${i.guildId}\nChannel: ${i.channel?.name}\nTopic: ${i.channel?.topic || '(none)'}`;
          break;
        case 'user': {
          const m = await i.guild.members.fetch(i.user.id);
          output = `${i.user.tag}\nID: ${i.user.id}\nJoined: ${m.joinedAt?.toISOString()}`;
          break;
        }
        case 'avatar':
          output = (i.options.getUser('target') ?? i.user).displayAvatarURL({ size: 1024 });
          break;
        case 'roles': {
          const m = await i.guild.members.fetch(i.options.getUser('target', true).id);
          output =
            m.roles.cache
              .filter((r) => r.id !== i.guildId)
              .map((r) => r.name)
              .join('\n') || 'No roles.';
          break;
        }
        case 'add':
          output = String(i.options.getNumber('a', true) + i.options.getNumber('b', true));
          break;
        case 'embed':
          await i.editReply({
            embeds: [
              {
                title: 'Your message',
                description: i.options.getString('text', true),
                color: 0x4cbfa6,
              },
            ],
            allowedMentions: { parse: [] },
          });
          return;
        case 'card': {
          const ranks = [
            'Ace',
            'Two',
            'Three',
            'Four',
            'Five',
            'Six',
            'Seven',
            'Eight',
            'Nine',
            'Ten',
            'Jack',
            'Queen',
            'King',
          ];
          const suits = ['Hearts', 'Diamonds', 'Clubs', 'Spades'];
          const draw = () => ({ rank: randomInt(13), suit: suits[randomInt(4)] });
          const a = draw(),
            b = draw();
          output = `You drew ${ranks[a.rank]} of ${a.suit}; bot drew ${ranks[b.rank]} of ${b.suit}. ${a.rank === b.rank ? 'Tie!' : a.rank > b.rank ? 'You win!' : 'Bot wins!'}`;
          break;
        }
        case 'feedback': {
          const entries = feedback
            .read()
            .filter((e) => e.userId !== i.user.id || e.guildId !== i.guildId);
          entries.push({
            userId: i.user.id,
            guildId: i.guildId,
            rating: i.options.getInteger('rating', true),
          });
          feedback.save(entries.slice(-10000));
          output = 'Thanks! Your rating has been saved.';
          break;
        }
        case 'tasks':
          output =
            taskAction(
              tasks,
              i.guildId,
              i.user.id,
              i.options.getString('action', true),
              i.options.getString('value'),
            )
              .map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text}\nID: ${t.id}`)
              .join('\n\n') || 'Your list is empty.';
          break;
        case 'ask': {
          if (aiBusy || (cooldowns.get(i.user.id) ?? 0) > Date.now())
            throw new Error('AI is busy or your 30-second cooldown has not elapsed.');
          cooldowns.set(i.user.id, Date.now() + 30000);
          aiBusy = true;
          try {
            output = await ask(config, i.options.getString('prompt', true));
          } finally {
            aiBusy = false;
          }
          break;
        }
        case 'purge':
          output = JSON.stringify(
            await purge(
              i,
              {
                count: i.options.getInteger('count', true),
                userId: i.options.getUser('target')?.id,
                minutes: i.options.getInteger('minutes') ?? undefined,
                scan: i.options.getInteger('scan') ?? 1000,
              },
              AbortSignal.timeout(120000),
            ),
          );
          break;
        case 'kick':
        case 'ban':
          output = await moderate(
            i,
            name,
            i.options.getUser('target', true).id,
            i.options.getString('reason') ?? undefined,
          );
          break;
        default:
          if (!response) throw new Error('Unknown command. Sync commands from the local panel.');
          output = response.text
            .replaceAll('{user}', i.user.username)
            .replaceAll('{server}', i.guild.name);
      }
      const text = String(output);
      await i.editReply(
        text.length <= 2000
          ? { content: text || 'Completed.', allowedMentions: { parse: [] } }
          : {
              content: text.slice(0, 1800) + '\n… Full result attached.',
              files: [{ attachment: Buffer.from(text), name: 'result.txt' }],
              allowedMentions: { parse: [] },
            },
      );
      logger.log('info', 'Command completed', {
        name,
        userId: i.user.id,
        result: ['purge', 'kick', 'ban'].includes(name) ? output : undefined,
      });
    } catch (error) {
      logger.log('error', 'Command failed', { name, userId: i.user.id, message: error.message });
      const message = {
        content: logger.redact(error.message).slice(0, 1900),
        allowedMentions: { parse: [] },
      };
      try {
        if (i.deferred || i.replied) await i.editReply(message);
        else await i.reply({ ...message, flags: MessageFlags.Ephemeral });
      } catch {
        logger.log('error', 'Could not deliver command error (interaction may have expired).', {
          name,
        });
      }
    }
  };
}
