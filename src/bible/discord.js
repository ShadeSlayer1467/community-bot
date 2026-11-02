import { SlashCommandBuilder, InteractionContextType, ApplicationIntegrationType,
  MessageFlags, ButtonStyle } from 'discord.js';
import { requireAccess } from '../authorization.js';
import { plan } from './service.js';

export function bibleDefinition({ guild = false } = {}) {
  const command = new SlashCommandBuilder().setName('bible')
    .setDescription('Read the Bible in 365 readings, starting in the New Testament')
    .addSubcommand(s => s.setName('today').setDescription('Your next unread passage'))
    .addSubcommand(s => s.setName('full').setDescription('Browse the entire plan with completion checkmarks')
      .addIntegerOption(o => o.setName('page').setDescription('Plan page (20 readings per page)')
        .setMinValue(1).setMaxValue(19)))
    .addSubcommand(s => s.setName('history').setDescription('Review your completed readings')
      .addIntegerOption(o => o.setName('page').setDescription('History page (newest first)')
        .setMinValue(1).setMaxValue(19)));
  if (!guild) command.setContexts(InteractionContextType.BotDM)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  return command.toJSON();
}
export function readingMessage(record, userId) {
  if (record.finished) return { content: 'You completed all 365 readings! 🎉', embeds: [], components: [] };
  return { content: '', embeds: [{ description: record.passage, color: 0x81e2ba,
    footer: { text: `Reading ${record.day}/365 · ${record.behind} behind` } }],
    components: [{ type: 1, components: ['abandon', 'complete'].map(action => ({
      type: 2, label: action === 'complete' ? 'Complete' : 'Abandon',
      style: action === 'complete' ? ButtonStyle.Success : ButtonStyle.Secondary,
      custom_id: `bible:${userId}:${record.active}:${action}`,
    })) }] };
}
export function fullPlanMessage(record, userId, requestedPage = 1) {
  const pages = Math.ceil(plan.length / 20);
  const page = Math.max(1, Math.min(pages, requestedPage));
  const start = (page - 1) * 20;
  const completed = new Set((record?.completed ?? []).map(entry => entry.day));
  const fields = [];
  for (let offset = start; offset < Math.min(start + 20, plan.length); offset += 10) {
    const end = Math.min(offset + 10, plan.length);
    fields.push({ name: `Readings ${offset + 1}–${end}`, inline: true,
      value: plan.slice(offset, end).map((passage, index) =>
        `${completed.has(offset + index + 1) ? '✅' : '❌'} ${offset + index + 1}. ${passage}`).join('\n') });
  }
  return { content: '', embeds: [{ title: 'Full Bible reading plan', color: 0x81e2ba,
    description: '✅ Complete · ❌ Not done', fields,
    footer: { text: `${completed.size}/365 completed · Page ${page}/${pages}` } }],
    components: [{ type: 1, components: [
      { type: 2, label: 'Previous', style: ButtonStyle.Secondary,
        custom_id: `bible:${userId}:full:${Math.max(1, page - 1)}`, disabled: page === 1 },
      { type: 2, label: 'Next', style: ButtonStyle.Secondary,
        custom_id: `bible:${userId}:full:${Math.min(pages, page + 1)}`, disabled: page === pages },
    ] }] };
}
export function createBibleHandler({ config, settings, bible, logger }) {
  return {
    handles: i => (i.isChatInputCommand() && i.commandName === 'bible') ||
      (i.isButton?.() && i.customId.startsWith('bible:')),
    async handle(i) {
      try {
        if (i.inGuild()) requireAccess(i, config, settings.read(), 'everyone');
        else if (i.context !== InteractionContextType.BotDM || i.channel?.type !== 1)
          throw new Error('Use this command in a configured server or a direct message with the bot.');
        if (settings.read().disabled.includes('bible')) throw new Error('This command is disabled.');
        const safe = { allowedMentions: { parse: [] } };
        if (i.isButton?.()) {
          const [, userId, token, action] = i.customId.split(':');
          if (userId !== i.user.id) throw new Error('This reading belongs to another user.');
          await i.deferUpdate();
          if (token === 'full') {
            if (!/^([1-9]|1[0-9])$/.test(action)) throw new Error('Invalid reading plan page.');
            return await i.editReply({ ...safe, ...fullPlanMessage(bible.history(userId), userId, Number(action)) });
          }
          const before = bible.history(userId);
          const record = bible.act(userId, token, action);
          return await i.editReply({ ...safe, components: [], embeds: [{
            description: before.passage, color: 0x81e2ba,
            footer: { text: action === 'complete' ? `Reading ${before.day}/365 complete` : 'Abandoned · progress unchanged' },
          }], content: record.finished ? 'You completed all 365 readings! 🎉' : '' });
        }
        await i.deferReply({ flags: MessageFlags.Ephemeral });
        if (i.options.getSubcommand() === 'today')
          return await i.editReply({ ...safe, ...readingMessage(bible.today(i.user.id), i.user.id) });
        const record = bible.history(i.user.id);
        if (i.options.getSubcommand() === 'full')
          return await i.editReply({ ...safe, ...fullPlanMessage(record, i.user.id, i.options.getInteger('page') ?? 1) });
        const entries = record?.completed ?? [];
        const pages = Math.max(1, Math.ceil(entries.length / 20));
        const page = Math.min(pages, i.options.getInteger('page') ?? 1);
        const visible = entries.toReversed().slice((page - 1) * 20, page * 20);
        return await i.editReply({ ...safe, embeds: [{ title: 'Bible reading history', color: 0x81e2ba,
          description: visible.map(e => `**${e.day}. ${plan[e.day - 1]}** · <t:${Math.floor(e.at / 1000)}:d>`).join('\n') ||
            'No completed readings yet. Use /bible today to begin.',
          footer: { text: `${entries.length}/365 completed · Page ${page}/${pages} · Use /bible history page for more` },
        }] });
      } catch (error) {
        logger.log('error', 'Bible command failed', { message: error.message, userId: i.user.id });
        const payload = { content: error.message, allowedMentions: { parse: [] } };
        if (i.isButton?.() && (i.deferred || i.replied))
          await i.followUp({ ...payload, flags: MessageFlags.Ephemeral });
        else if (i.deferred || i.replied) await i.editReply(payload);
        else await i.reply({ ...payload, flags: MessageFlags.Ephemeral });
      }
    },
  };
}
