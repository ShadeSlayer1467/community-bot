import { randomBytes } from 'node:crypto';
import {
  SlashCommandBuilder,
  InteractionContextType,
  ApplicationIntegrationType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  MessageFlags,
} from 'discord.js';
import { formatResistance, parseResistance } from './model.js';
import { filterExercises } from './starter.js';
import { exerciseHistoryPages } from './history.js';
import { createWorkoutBuilder } from './discord-builder.js';
const row = (...buttons) => new ActionRowBuilder().addComponents(buttons);
const button = (label, id, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setLabel(label).setCustomId(id).setStyle(style).setDisabled(disabled);
const safe = (s, max = 900) => String(s).replace(/@/g, '＠').slice(0, max);
export function workoutDefinition({ guild = false } = {}) {
  const definition = new SlashCommandBuilder()
    .setName('workout')
    .setDescription('Plan, log and review your workouts')
    .addSubcommand((s) => s.setName('today').setDescription('Choose and preview your next workout'))
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Choose and preview a workout before confirming Start')
        .addBooleanOption((o) => o.setName('free').setDescription('Preview a free workout before confirming Start')),
    )
    .addSubcommand((s) =>
      s.setName('resume').setDescription('Recover the active workout after restart'),
    )
    .addSubcommand((s) => s.setName('history').setDescription('Your recent completed workouts'))
    .addSubcommand((s) => s.setName('exercise').setDescription('Browse recorded exercise history')
      .addStringOption(o => o.setName('name').setDescription('Search exercise name or alias (e.g. bench or RDL)')));
  if (!guild)
    definition
      .setContexts(InteractionContextType.BotDM)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  return definition.toJSON();
}
function custom(s, action, extra = '') {
  return `wo:${s.id}:${s.revision}:${action}${extra ? ':' + extra : ''}`;
}
function workSets(e) {
  return (
    e.sets
      .map(
        (set) =>
          `${set.order}. ${formatResistance(set.resistance)} × ${set.reps}${set.type === 'normal' ? '' : ' (' + set.type + ')'}${set.questionable ? ' ?' : ''}`,
      )
      .join('\n') || 'No sets yet.'
  );
}
export function sessionMessage(s) {
  const embeds = [];
  const components = [];
  if (s.state === 'active') {
    const e = s.exercises[s.currentIndex];
    const embed = new EmbedBuilder()
      .setColor(0x81e2ba)
      .setTitle(safe(s.name, 200))
      .setDescription(
        `Exercise ${e ? s.currentIndex + 1 : 0}/${s.exercises.length} · ${s.mode === 'free' ? 'Free workout' : 'Planned workout'}`,
      );
    if (e) {
      const p = e.planned;
      embed.addFields(
        {
          name: safe(e.name, 200),
          value: safe(
            `${e.variation ? e.variation + '\n' : ''}${p ? `Target: ${p.sets} × ${p.minReps}–${p.maxReps}\nPlanned: ${formatResistance(p.resistance)}` : 'Unplanned exercise'}\nWorking: ${formatResistance(e.workingResistance)}${e.skipped ? '\nSkipped' : ''}${e.questionable ? '\nQuestionable data' : ''}`,
            1000,
          ),
        },
        {
          name: 'Previous workout',
          value: safe(
            e.previous
              ? `${e.previous.date.slice(0, 10)}${e.previous.questionable ? ' ?' : ''}\n${e.previous.exercises.map(workSets).join('\n')}`
              : 'No previous completed performance.',
            1000,
          ),
        },
        { name: 'Today', value: safe(workSets(e), 1000) },
      );
      if (e.notes || e.note || p?.note)
        embed.addFields({
          name: 'Notes',
          value: safe([e.notes, p?.note, e.note].filter(Boolean).join('\n')),
        });
    } else embed.addFields({ name: 'Start logging', value: 'Add an exercise from your library.' });
    embeds.push(embed);
    components.push(
      row(
        button('Log Set', custom(s, 'log'), ButtonStyle.Primary, !e),
        button('Repeat Last', custom(s, 'repeat'), ButtonStyle.Secondary, !e?.sets.length),
        button('Change Weight', custom(s, 'weight'), ButtonStyle.Secondary, !e),
        button('Edit Last Set', custom(s, 'edit'), ButtonStyle.Secondary, !e?.sets.length),
      ),
    );
    components.push(
      row(
        button('Previous Exercise', custom(s, 'prev'), ButtonStyle.Secondary, s.currentIndex <= 0),
        button(
          'Next Exercise',
          custom(s, 'next'),
          ButtonStyle.Secondary,
          s.currentIndex >= s.exercises.length - 1,
        ),
        button('Add Exercise', custom(s, 'add')),
      ),
    );
    components.push(
      row(
        button('Edit Earlier Set', custom(s, 'earlier'), ButtonStyle.Secondary, !e?.sets.length),
        button('Delete Set', custom(s, 'delete'), ButtonStyle.Secondary, !e?.sets.length),
        button('Skip Exercise', custom(s, 'skip'), ButtonStyle.Secondary, !e),
        button('Notes / Uncertain', custom(s, 'note'), ButtonStyle.Secondary, !e),
      ),
    );
    components.push(
      row(
        button('Log Details', custom(s, 'details'), ButtonStyle.Secondary, !e),
        button('Finish Workout', custom(s, 'finish')),
        button('Abandon Workout', custom(s, 'abandon')),
      ),
    );
  } else {
    const minutes = Math.max(
      0,
      Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 60000),
    );
    const embed = new EmbedBuilder()
      .setColor(0x81e2ba)
      .setTitle(s.state === 'completed' ? 'WORKOUT COMPLETE' : 'WORKOUT ABANDONED')
      .setDescription(`${safe(s.name, 100)} · ${minutes} minutes\n${safe(s.note, 500)}`);
    // Discord field/total limits: full history is in the admin; paginate recommendations below.
    for (const e of s.exercises.slice(0, 5)) {
      const r = s.recommendations.find((r) => r.id === e.id);
      embed.addFields({
        name: safe(e.name, 100),
        value: safe(`${workSets(e)}${r ? '\n' + r.outcome + ': ' + r.reason : ''}`, 800),
      });
    }
    if (s.exercises.length > 5)
      embed.setFooter({
        text: 'Full session and remaining recommendations are available in Workout History.',
      });
    embeds.push(embed);
    const pending = s.recommendations.filter(
      (r) => !s.decisions.some((d) => d.entryId === r.id && d.valid !== false),
    );
    if (s.state === 'completed' && pending.length)
      components.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(custom(s, 'recommend'))
            .setPlaceholder('Review a progression recommendation')
            .addOptions(
              pending.slice(0, 25).map((r) => ({
                label: safe(s.exercises.find((e) => e.id === r.id)?.name, 100),
                description: safe(r.outcome + ': ' + r.reason, 100),
                value: r.id,
              })),
            ),
        ),
      );
  }
  return { content: '', embeds, components, allowedMentions: { parse: [] } };
}
function modal(s, action, title, fields, extra = '') {
  const m = new ModalBuilder().setCustomId(custom(s, action, extra)).setTitle(title);
  for (const [key, label, value, required = true] of fields) {
    const input = new TextInputBuilder()
      .setCustomId(key)
      .setLabel(label)
      .setStyle(TextInputStyle.Short)
      .setRequired(required)
      .setMaxLength(key === 'note' ? 500 : 100);
    if (value !== undefined && value !== '') input.setValue(String(value));
    m.addComponents(row(input));
  }
  return m;
}
export function createWorkoutHandler({ config, settings, workout, logger, client }) {
  const busyUsers = new Set();
  const selections = new Map();
  const planConfirmations = new Map();
  const historyTickets = new Map();
  function historyTicket(i, state) {
    for (const [key, ticket] of historyTickets) if (ticket.until < Date.now()) historyTickets.delete(key);
    if (historyTickets.size >= 1000) historyTickets.delete(historyTickets.keys().next().value);
    const token = randomBytes(12).toString('hex');
    historyTickets.set(token, { ...state, userId: i.user.id, channelId: i.channelId, until: Date.now() + 600000 });
    return token;
  }
  async function historySelection(i, query = '', page = 0, update = false) {
    const choices = filterExercises(workout.historyExercises(i.user.id), { search: query, status: 'all' });
    if (choices.length === 1 && query) return showExerciseHistory(i, choices[0].id, 0, update);
    page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(choices.length / 25) - 1)));
    const visible = choices.slice(page * 25, (page + 1) * 25);
    const token = historyTicket(i, { query, page, choices: visible.map(e => e.id) });
    const id = action => `wo:eh:${token}:${action}`;
    const components = [];
    if (visible.length) components.push(row(new StringSelectMenuBuilder().setCustomId(id('select'))
      .setPlaceholder('Choose an exercise to review').addOptions(visible.map(e => ({
        label: safe(e.name, 100), value: e.id,
        description: safe([e.variation, e.active ? e.category : 'Archived / historical'].filter(Boolean).join(' · ') || 'Exercise library', 100),
      })))));
    components.push(row(button('Search by name or alias', id('search')),
      button('Earlier choices', id('choices-back'), ButtonStyle.Secondary, page === 0),
      button('More choices', id('choices-next'), ButtonStyle.Secondary, (page + 1) * 25 >= choices.length)));
    const payload = { content: choices.length ? `${choices.length} exercises${query ? ' matching ' + safe(query, 100) : ''}. Includes archived exercises. Search to narrow the list.` : 'No matching exercises. Search another name or alias.',
      embeds: [], components, allowedMentions: { parse: [] } };
    return update ? i.update(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  async function showExerciseHistory(i, exerciseId, page = 0, update = false) {
    const history = workout.exerciseHistory(i.user.id, exerciseId);
    const pages = exerciseHistoryPages(history);
    page = Math.max(0, Math.min(page, pages.length - 1));
    const token = historyTicket(i, { exerciseId, page });
    const id = action => `wo:eh:${token}:${action}`;
    const embed = new EmbedBuilder().setColor(0x81e2ba)
      .setTitle(safe(history.exercise.name + ' — HISTORY', 256))
      .setDescription(safe([history.exercise.variation, history.exercise.active ? '' : 'Archived / historical exercise',
        pages[page].length ? 'Completed workouts · newest first. Each line is an actual recorded set.' : 'No completed sets recorded for this exercise.'].filter(Boolean).join('\n'), 1000))
      .setFooter({ text: `Page ${page + 1}/${pages.length} · Dates: recorded workout start (UTC) · ⚠ questionable` });
    if (pages[page].length) embed.addFields(pages[page]);
    const payload = { content: '', embeds: [embed], components: [row(
      button('Newer', id('newer'), ButtonStyle.Secondary, page === 0),
      button('Older', id('older'), ButtonStyle.Secondary, page === pages.length - 1),
      button('Choose another exercise', id('different')))], allowedMentions: { parse: [] } };
    return update ? i.update(payload) : i.reply({ ...payload, flags: MessageFlags.Ephemeral });
  }
  const exerciseSearches = new Map();
  async function exerciseChoices(i, s, query, page = 0) {
    const exercises = filterExercises(workout.catalog(i.user.id).exercises, { search: query });
    const options = exercises.slice(page * 25, (page + 1) * 25).map(e => ({ label: safe(e.name, 100), description: safe(e.variation || e.category || "Exercise library", 100), value: e.id }));
    const controls = [];
    if (options.length) controls.push(row(new StringSelectMenuBuilder().setCustomId(custom(s, "add-choice")).setPlaceholder("Choose an exercise").addOptions(options)));
    controls.push(row(button("Back", custom(s, "keep-training")), button("Search again", custom(s, "add")), button("Earlier", custom(s, "add-page", String(page - 1)), ButtonStyle.Secondary, page <= 0), button("More", custom(s, "add-page", String(page + 1)), ButtonStyle.Secondary, (page + 1) * 25 >= exercises.length)));
    return i.update({ content: options.length ? `${exercises.length} matches for ${safe(query || "all exercises", 100)}. Choose an exercise.` : "No matching active exercises. Search another name or alias.", embeds: [], components: controls, allowedMentions: { parse: [] } });
  }
  async function choose(i, selection, update = false, page = 0) {
    const send = (payload) => (update ? i.update(payload) : i.reply(payload));
    const base = { content: '', embeds: [], components: [], allowedMentions: { parse: [] } };
    if (selection.kind === 'empty')
      return send({
        ...base,
        content:
          'No active programs. Create or activate a program in Workout → Programs, then use /workout today.',
        components: [row(button('Create Saved Workout', 'wo:create:' + i.user.id),
          button('Free Workout', 'wo:launch-free:' + i.user.id))],
      });
    if (selection.kind === 'resolved') {
      const plan = selection;
      for (const [key, ticket] of planConfirmations) if(ticket.until<Date.now()) planConfirmations.delete(key);
      if(planConfirmations.size>=1000) planConfirmations.delete(planConfirmations.keys().next().value);
      const confirmation=randomBytes(12).toString('hex');
      planConfirmations.set(confirmation,{userId:i.user.id,channelId:i.channelId,programId:plan.program.id,templateId:plan.template.id,programRevision:plan.program.revision,until:Date.now()+600000});
      const embed = new EmbedBuilder()
        .setTitle(safe(plan.template.name, 200))
        .setColor(0x81e2ba)
        .setDescription(safe(plan.program.name, 100) + ' · Today’s planned workout.');
      for (const e of plan.template.exercises.slice(0, 5)) {
        const ex = workout.owned('exercises', e.exerciseId, i.user.id),
          last = workout.previous(i.user.id, e.exerciseId);
        embed.addFields({
          name: safe(ex.name, 100),
          value: safe(
            e.sets +
              ' × ' +
              e.minReps +
              '–' +
              e.maxReps +
              '\nPlanned: ' +
              formatResistance(e.resistance) +
              '\nLast: ' +
              (last ? last.exercises.map(workSets).join('\n') : 'None'),
            800,
          ),
        });
      }
      return send({
        ...base,
        embeds: [embed],
        components: [
          row(
            button(
              'Start Workout',
              'wo:confirm:' + confirmation + ':start',
              ButtonStyle.Primary,
            ),
            button('Choose Different Workout', 'wo:choose:' + i.user.id),
            button('Free Workout', 'wo:launch-free:' + i.user.id),
            button('Create Saved Workout', 'wo:create:' + i.user.id),
          ),
        ],
      });
    }
    const choices = selection.kind === 'programs' ? selection.programs : selection.templates;
    if (!Number.isInteger(page) || page < 0 || page * 25 >= choices.length)
      throw new Error('Choose/review again with /workout today.');
    for (const [key, ticket] of selections) if (ticket.until < Date.now()) selections.delete(key);
    const token = randomBytes(12).toString('hex');
    selections.set(token, {
      userId: i.user.id,
      channelId: i.channelId,
      selection,
      page,
      until: Date.now() + 10 * 60 * 1000,
    });
    const menu = new StringSelectMenuBuilder()
      .setCustomId('wo:pick:' + token + ':select')
      .setPlaceholder(
        selection.kind === 'programs' ? 'Choose a program' : 'Choose a planned workout',
      )
      .addOptions(
        choices
          .slice(page * 25, (page + 1) * 25)
          .map((c) => ({ label: safe(c.name, 100), value: c.id })),
      );
    const controls = [new ActionRowBuilder().addComponents(menu)];
    if (choices.length > 25)
      controls.push(
        row(
          button(
            'Previous choices',
            'wo:pick:' + token + ':previous',
            ButtonStyle.Secondary,
            page === 0,
          ),
          button(
            'More choices',
            'wo:pick:' + token + ':next',
            ButtonStyle.Secondary,
            (page + 1) * 25 >= choices.length,
          ),
        ),
      );
    return send({
      ...base,
      content:
        selection.kind === 'programs'
          ? 'Choose your workout program.'
          : safe(selection.program.name, 100) + ' — choose a planned workout.',
      components: controls,
    });
  }
  const launchTickets = new Map();
  const builder = createWorkoutBuilder(workout, choose, (i, update) => startChooser(i, update));
  async function startChooser(i, update = false, page = 0, free = false) {
    const active = workout.active(i.user.id);
    const choices = workout.catalog(i.user.id).programs.filter(p => p.active)
      .flatMap(program => program.templates.map(template => ({program, template})));
    const saved = workout.repo.preferences().plans[i.user.id];
    const recommended = choices.find(c => c.program.id === saved?.programId && c.template.id === saved?.templateId);
    for (const [key, ticket] of launchTickets) if (ticket.until < Date.now()) launchTickets.delete(key);
    const token = randomBytes(12).toString('hex');
    page = Math.max(0, Math.min(page, Math.max(0, Math.ceil(choices.length / 25) - 1)));
    launchTickets.set(token, {userId:i.user.id,channelId:i.channelId,choices,page,recommended,activeId:active?.id,until:Date.now()+600000});
    const id = action => 'wo:launch:' + token + ':' + action;
    const components = [];
    let content = active ? 'An active workout already exists: ' + safe(active.name,100) + '. Resume it to continue.' :
      free ? 'Free workout: add exercises as you go. No session is created until you press Start Free Workout.' :
      (recommended ? 'Current next workout: ' + safe(recommended.program.name,100) + ' → ' + safe(recommended.template.name,100) : 'No saved next workout.') + '\nSelect any workout to preview it. Starting requires confirmation.';
    if (active) components.push(row(button('Resume Workout',id('resume'),ButtonStyle.Primary)));
    else if (free) components.push(row(button('Start Free Workout',id('start-free'),ButtonStyle.Primary),button('Back to workouts',id('back'))));
    else {
      if (choices.length) components.push(row(new StringSelectMenuBuilder().setCustomId(id('select')).setPlaceholder('Choose a workout to preview').addOptions(choices.slice(page*25,(page+1)*25).map((c,index)=>({
        label:safe(c.program.name+' — '+c.template.name,100),value:String(page*25+index),description:c===recommended?'Current next workout':'Preview this workout'
      })))));
      const actions=[button('Free Workout',id('free')),button('Create Saved Workout',id('create'))];
      if(recommended) actions.unshift(button('Preview Next Workout',id('recommended')));
      components.push(row(...actions));
      if(choices.length>25) components.push(row(button('Earlier workouts',id('previous'),ButtonStyle.Secondary,page===0),button('More workouts',id('next'),ButtonStyle.Secondary,(page+1)*25>=choices.length)));
      if(!choices.length) content+='\nNo active programs yet. Create a saved workout here or start a free workout.';
    }
    const payload={content,embeds:[],components,allowedMentions:{parse:[]}};
    return update ? i.update(payload) : i.reply(payload);
  }
  const handles = (i) =>
    (i.isChatInputCommand?.() && i.commandName === 'workout') ||
    ((i.isButton?.() || i.isStringSelectMenu?.() || i.isModalSubmit?.()) &&
      i.customId?.startsWith('wo:'));
  function authorize(i) {
    if (!workout) throw new Error('Workout service unavailable.');
    if (i.inGuild()) {
      if (i.context !== InteractionContextType.Guild || !config.guildIds.includes(i.guildId))
        throw new Error('This server is not configured for Workout.');
    } else if (i.context !== InteractionContextType.BotDM || i.channel?.type !== 1) {
      throw new Error('Use /workout in a configured server or a direct message with this bot.');
    }
    if (!workout.allowed(i.user.id))
      throw new Error('Your user ID is not allowed in Workout settings.');
    if (settings.read().disabled.includes('workout'))
      throw new Error('Workout commands are disabled.');
  }
  async function present(i, s) {
    const payload = sessionMessage(s);
    if (
      i.isChatInputCommand?.() ||
      (i.isButton?.() &&
        (s.message?.channelId !== i.channelId || s.message?.messageId !== i.message?.id))
    ) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      let message;
      if (s.message?.channelId === i.channelId)
        try {
          message = await i.channel.messages.fetch(s.message.messageId);
        } catch {}
      if (message && message.author?.id === client.user?.id) await message.edit(payload);
      else {
        message = await i.channel.send(payload);
        workout.bindMessage(i.user.id, s.id, { channelId: i.channelId, messageId: message.id });
      }
      return i.editReply({
        content: 'Workout ready below. Use /workout resume if the interface needs recovery.',
        allowedMentions: { parse: [] },
      });
    }
    // Component/modal updates refresh the same durable workout message, including after restart.
    await i.update(payload);
  }
  function assertSource(i, s) {
    workout.assertRevision(s, Number(i.customId.split(':')[2]));
    if (!s.message || s.message.channelId !== i.channelId || s.message.messageId !== i.message?.id)
      throw new Error('This workout message is stale. Use /workout resume.');
  }
  return {
    handles,
    async handle(i) {
      let acquired = false;
      try {
        authorize(i);
        if (busyUsers.has(i.user.id))
          throw new Error('A Workout action is still updating. Try again in a moment.');
        busyUsers.add(i.user.id);
        acquired = true;
        const userId = i.user.id;
        if (i.isChatInputCommand?.()) {
          const sub = i.options.getSubcommand();
          if (sub === 'exercise') return await historySelection(i, i.options.getString('name') || '');
          if (sub === 'history') {
            const sessions = workout
              .state(userId)
              .sessions.filter((s) => s.state === 'completed')
              .slice(0, 5);
            return i.reply({
              content:
                sessions
                  .map(
                    (s) =>
                      `${s.startedAt.slice(0, 10)} · ${safe(s.name)} · ${s.exercises.reduce((n, e) => n + e.sets.length, 0)} sets`,
                  )
                  .join('\n') || 'No completed workouts yet.',
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
          }
          if (sub === 'today') return await choose(i, workout.selection(userId));
          if (sub === 'start') return await startChooser(i, false, 0, !!i.options.getBoolean('free'));
          const s = workout.active(userId);
          if (!s) throw new Error('No active workout. Use /workout start.');
          return await present(i, s);
        }
        const [, sessionId, revision, action, extra] = i.customId.split(':');
        if (sessionId === 'build') return await builder.handle(i);
        if (sessionId === 'create' || sessionId === 'launch-free') {
          if(revision!==userId) throw new Error('This selection belongs to another user.');
          return sessionId==='create' ? await builder.open(i) : await startChooser(i,true,0,true);
        }
        if (sessionId === 'launch') {
          const ticket=launchTickets.get(revision);
          if(!ticket||ticket.until<Date.now()) throw new Error('Workout selection expired. Use /workout start again.');
          if(ticket.userId!==userId||ticket.channelId!==i.channelId) throw new Error('This selection belongs to another user or channel.');
          if(action==='resume') {const active=workout.active(userId);if(!active) throw new Error('That workout is no longer active. Use /workout start.');return await present(i,active);}
          if(action==='create') return await builder.open(i);
          if(action==='free'||action==='back'||action==='previous'||action==='next') return await startChooser(i,true,ticket.page+(action==='next'?1:action==='previous'?-1:0),action==='free');
          if(action==='start-free') {
            const active=workout.active(userId);
            if(ticket.startedId && (!active || active.id!==ticket.startedId))
              throw new Error('That Start confirmation was already used. Open /workout start again.');
            const session=workout.start(userId,{free:true,requestId:i.id});
            ticket.startedId=session.id;
            return await present(i,session);
          }
          const choice=action==='recommended'?ticket.recommended:ticket.choices.slice(ticket.page*25,(ticket.page+1)*25).find((c,index)=>String(ticket.page*25+index)===i.values?.[0]);
          if(!choice) throw new Error('Choose a listed workout.');
          return await choose(i,workout.selection(userId,{programId:choice.program.id,templateId:choice.template.id,expectedProgramRevision:choice.program.revision}),true);
        }
        if (sessionId === 'eh') {
          const ticket = historyTickets.get(revision);
          if (!ticket || ticket.until < Date.now()) throw new Error('Exercise history view expired. Run /workout exercise again.');
          if (ticket.userId !== userId || ticket.channelId !== i.channelId)
            throw new Error('This exercise history view belongs to another user or channel.');
          if (action === 'search' && i.isButton?.()) {
            const input = new TextInputBuilder().setCustomId('search').setLabel('Exercise name or alias')
              .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(100);
            return await i.showModal(new ModalBuilder().setCustomId(`wo:eh:${revision}:query`)
              .setTitle('Find exercise history').addComponents(row(input)));
          }
          if (action === 'query' && i.isModalSubmit?.())
            return await historySelection(i, i.fields.getTextInputValue('search').trim(), 0, true);
          if (action === 'select' && i.isStringSelectMenu?.() && ticket.choices?.includes(i.values[0]))
            return await showExerciseHistory(i, i.values[0], 0, true);
          if (action === 'different') return await historySelection(i, '', 0, true);
          if (['choices-back', 'choices-next'].includes(action) && ticket.choices)
            return await historySelection(i, ticket.query, ticket.page + (action === 'choices-next' ? 1 : -1), true);
          if (['newer', 'older'].includes(action) && ticket.exerciseId)
            return await showExerciseHistory(i, ticket.exerciseId, ticket.page + (action === 'older' ? 1 : -1), true);
          throw new Error('Invalid exercise history selection. Run /workout exercise again.');
        }
        if (sessionId === 'choose') {
          if (revision !== userId)
            throw new Error('This workout selection belongs to another user.');
          return await choose(i, workout.selection(userId, { ignoreSaved: true }), true);
        }
        if (sessionId === 'pick') {
          const ticket = selections.get(revision);
          if (!ticket || ticket.until < Date.now())
            throw new Error('Workout selection expired. Choose/review again with /workout today.');
          if (ticket.userId !== userId || ticket.channelId !== i.channelId)
            throw new Error('This workout selection belongs to another user or channel.');
          if (action === 'next' || action === 'previous')
            return await choose(
              i,
              ticket.selection,
              true,
              ticket.page + (action === 'next' ? 1 : -1),
            );
          if (action !== 'select' || !i.isStringSelectMenu?.())
            throw new Error('Invalid workout selection.');
          const choices =
            ticket.selection.kind === 'programs'
              ? ticket.selection.programs
              : ticket.selection.templates;
          const choice = choices
            .slice(ticket.page * 25, (ticket.page + 1) * 25)
            .find((c) => c.id === i.values[0]);
          if (!choice) throw new Error('Choose/review again with /workout today.');
          const selection =
            ticket.selection.kind === 'programs'
              ? workout.selection(userId, {
                  programId: choice.id,
                  expectedProgramRevision: choice.revision,
                })
              : workout.selection(userId, {
                  programId: ticket.selection.program.id,
                  templateId: choice.id,
                  expectedProgramRevision: ticket.selection.program.revision,
                });
          const result = await choose(i, selection, true);
          selections.delete(revision);
          return result;
        }
        if (sessionId === 'plan') throw new Error('That preview is stale. Use /workout start to review again.');
        if (sessionId === 'confirm') {
          const ticket=planConfirmations.get(revision);
          if(!ticket||ticket.until<Date.now()) throw new Error('Start confirmation expired. Use /workout start again.');
          if(ticket.userId!==userId||ticket.channelId!==i.channelId) throw new Error('This Start confirmation belongs to another user or channel.');
          if(action!=='start'||!i.isButton?.()) throw new Error('Use the Start Workout button.');
          const active=workout.active(userId);
          if(active) return await present(i,active);
          if(ticket.startedId) throw new Error('That Start confirmation was already used. Open /workout start again.');
          workout.selection(userId,{programId:ticket.programId,templateId:ticket.templateId,expectedProgramRevision:ticket.programRevision});
          const session=workout.start(userId,{programId:ticket.programId,templateId:ticket.templateId,requestId:i.id});
          ticket.startedId=session.id;
          workout.setNext(userId,ticket.programId,ticket.templateId,ticket.programRevision);
          workout.bindMessage(userId,session.id,{channelId:i.channelId,messageId:i.message.id});
          return await i.update(sessionMessage(session));
        }
        const s = workout.session(sessionId, userId);
        if (
          s.requests.includes(i.id) &&
          s.message?.channelId === i.channelId &&
          s.message?.messageId === i.message?.id
        )
          return await present(i, s);
        assertSource(i, s);
        const e = s.exercises[s.currentIndex];
        const get = (key) => i.fields.getTextInputValue(key);
        const apply = (action, input = {}) =>
          workout.mutate(userId, s.id, {
            action,
            expectedRevision: s.revision,
            requestId: i.id,
            ...input,
          });
        if (i.isModalSubmit?.()) {
          if (action === 'add-search') {
            const query = get('search').trim();
            exerciseSearches.set(s.id, { query, revision: s.revision });
            return await exerciseChoices(i, s, query);
          }
          if (action === 'log' || action === 'repeat')
            return await present(i, apply(action, { reps: Number(get('reps')) }));
          if (action === 'weight')
            return await present(
              i,
              apply('weight', {
                resistance: parseResistance(get('weight'), e.workingResistance.unit),
              }),
            );
          if (action === 'edit')
            return await present(
              i,
              apply('edit-set', {
                setId: extra,
                reps: Number(get('reps')),
                resistance: parseResistance(get('weight'), e.workingResistance.unit),
                note: get('note'),
                questionable: get('uncertain').trim().toLowerCase() === 'yes',
              }),
            );
          if (action === 'details')
            return await present(
              i,
              apply('log', {
                reps: Number(get('reps')),
                resistance: parseResistance(get('weight'), e.workingResistance.unit),
                type: get('type').trim().toLowerCase() || 'normal',
                note: get('note'),
                questionable: get('uncertain').trim().toLowerCase() === 'yes',
              }),
            );
          if (action === 'note')
            return await present(
              i,
              apply('exercise-note', {
                note: get('note'),
                questionable: get('uncertain').trim().toLowerCase() === 'yes',
              }),
            );
          if (action === 'manual') {
            const entry = s.exercises.find((e) => e.id === extra);
            const result = workout.decide(userId, s.id, {
              entryId: extra,
              choice: 'manual',
              manual: {
                exerciseId: entry.exerciseId,
                resistance: parseResistance(get('weight'), entry.workingResistance.unit),
              },
              expectedRevision: s.revision,
              expectedProgramRevision: Number(get('programRevision')),
              requestId: i.id,
            });
            return await present(i, result);
          }
          throw new Error('Unknown Workout modal.');
        }
        if (action === 'confirm') {
          const c = workout.confirmations.get(extra);
          if (!c) throw new Error('Confirmation expired. Keep training and try again.');
          return await present(
            i,
            apply(c.action, {
              confirmationToken: extra,
              ...(c.action === 'delete-set' ? { setId: c.targetId } : {}),
              ...(c.action === 'skip' ? { entryId: c.targetId } : {}),
            }),
          );
        }
        if (action === 'keep-training') return await present(i, s);
        if (['finish', 'abandon', 'skip'].includes(action) || action === 'delete-choice') {
          const real = action === 'delete-choice' ? 'delete-set' : action;
          const targetId = real === 'delete-set' ? i.values[0] : real === 'skip' ? e?.id : null;
          const confirmation = workout.confirmation(userId, s.id, {
            action: real,
            targetId,
            expectedRevision: s.revision,
          });
          const sets = s.exercises.reduce(
            (n, e) => n + e.sets.filter((s) => s.type !== 'warmup').length,
            0,
          );
          return await i.update({
            content: `Confirm ${real}? ${sets} working sets logged · ${s.exercises.filter((e) => e.sets.length && !e.skipped).length} exercises with sets.`,
            embeds: [],
            components: [
              row(
                button(
                  'Confirm ' +
                    (real === 'finish'
                      ? 'Finish Workout'
                      : real === 'abandon'
                        ? 'Abandon Workout'
                        : real === 'skip'
                          ? 'Skip Exercise'
                          : 'Delete Set'),
                  custom(s, 'confirm', confirmation.token),
                  ButtonStyle.Danger,
                ),
                button('Keep Training', custom(s, 'keep-training')),
              ),
            ],
            allowedMentions: { parse: [] },
          });
        }
        if (action === 'prev' || action === 'next')
          return await present(
            i,
            apply('navigate', { index: s.currentIndex + (action === 'prev' ? -1 : 1) }),
          );
        if (action === 'log' || action === 'repeat') {
          if (!e) throw new Error('Add an exercise first.');
          return await i.showModal(
            modal(
              s,
              action,
              `${action === 'repeat' ? 'Repeat' : 'Log'} set · ${formatResistance(action === 'repeat' ? e.sets.at(-1).resistance : e.workingResistance)}`.slice(
                0,
                45,
              ),
              [['reps', 'Reps', action === 'repeat' ? e.sets.at(-1)?.reps : '']],
            ),
          );
        }
        if (action === 'weight')
          return await i.showModal(
            modal(s, 'weight', 'Change working resistance', [
              [
                'weight',
                'Load: 235 lb, 2x135, stack:30, BW…',
                resistanceInput(e.workingResistance),
              ],
            ]),
          );
        if (action === 'edit' || action === 'edit-choice') {
          const set =
            action === 'edit' ? e.sets.at(-1) : e.sets.find((set) => set.id === i.values[0]);
          if (!set) throw new Error('Set not found.');
          return await i.showModal(
            modal(
              s,
              'edit',
              `Edit set ${set.order}`,
              [
                ['reps', 'Reps', set.reps],
                ['weight', 'Resistance', resistanceInput(set.resistance)],
                ['note', 'Note (optional)', set.note, false],
                ['uncertain', 'Questionable? yes / no', set.questionable ? 'yes' : 'no', false],
              ],
              set.id,
            ),
          );
        }
        if (action === 'details')
          return await i.showModal(
            modal(s, 'details', 'Log a detailed set', [
              ['reps', 'Reps', ''],
              ['weight', 'Resistance', resistanceInput(e.workingResistance)],
              ['type', 'normal / warmup / amrap / dropset / partials', 'normal', false],
              ['note', 'Note (optional)', '', false],
              ['uncertain', 'Questionable? yes / no', 'no', false],
            ]),
          );
        if (action === 'note')
          return await i.showModal(
            modal(s, 'note', 'Exercise notes / uncertainty', [
              ['note', 'Exercise note', e.note, false],
              ['uncertain', 'Questionable? yes / no', e.questionable ? 'yes' : 'no', false],
            ]),
          );
        if (action === 'add')
          return await i.showModal(modal(s, 'add-search', 'Find an exercise', [['search', 'Name or alias (e.g. bench, RDL, BW squat)', '', false]]));
        if (action === 'add-page') {
          const search = exerciseSearches.get(s.id);
          if (!search || search.revision !== s.revision) throw new Error('Search expired. Use Add Exercise again.');
          return await exerciseChoices(i, s, search.query, Math.max(0, Number(extra) || 0));
        }
        if (action === 'add-choice')
          return await present(i, apply('add-exercise', { exerciseId: i.values[0] }));
        if (action === 'earlier' || action === 'delete') {
          return await i.update({
            content: 'Choose a set. Older sets beyond the last 25 can be corrected in admin.',
            embeds: [],
            components: [
              new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                  .setCustomId(custom(s, action === 'delete' ? 'delete-choice' : 'edit-choice'))
                  .setPlaceholder('Set to ' + (action === 'delete' ? 'delete' : 'edit'))
                  .addOptions(
                    e.sets.slice(-25).map((set) => ({
                      label: safe(
                        `${set.order}. ${formatResistance(set.resistance)} × ${set.reps}`,
                        100,
                      ),
                      value: set.id,
                    })),
                  ),
              ),
              row(button('Back', custom(s, 'keep-training'))),
            ],
            allowedMentions: { parse: [] },
          });
        }
        if (action === 'recommend') {
          const entry = s.exercises.find((e) => e.id === i.values[0]),
            r = s.recommendations.find((r) => r.id === entry?.id);
          if (!r) throw new Error('Recommendation not found.');
          return await i.update({
            content: `${safe(entry.name)}: ${r.outcome}\n${safe(r.reason)}`,
            embeds: [],
            components: [
              row(
                button(
                  'Accept Progression',
                  custom(s, 'accept', entry.id),
                  ButtonStyle.Primary,
                  !r.proposed || r.outcome !== 'PROGRESS' || !s.programId || !entry.slotId,
                ),
                button('Keep Current', custom(s, 'keep', entry.id)),
                button(
                  'Set Manually',
                  custom(s, 'manual', entry.id),
                  ButtonStyle.Secondary,
                  !s.programId || !entry.slotId,
                ),
              ),
              row(button('Back to Summary', custom(s, 'keep-training'))),
            ],
            allowedMentions: { parse: [] },
          });
        }
        if (action === 'accept' || action === 'keep') {
          const p = s.programId ? workout.owned('programs', s.programId, userId) : null;
          // Automatic acceptance requires the original program revision plus our own accepted decisions.
          const expected =
            s.programRevision +
            s.decisions.filter((d) => d.programId === s.programId && d.choice !== 'keep').length;
          return await present(
            i,
            workout.decide(userId, s.id, {
              entryId: extra,
              choice: action === 'keep' ? 'keep' : 'accept',
              expectedRevision: s.revision,
              expectedProgramRevision: action === 'accept' ? expected : p?.revision,
              requestId: i.id,
            }),
          );
        }
        if (action === 'manual') {
          const p = workout.owned('programs', s.programId, userId),
            entry = s.exercises.find((e) => e.id === extra);
          return await i.showModal(
            modal(
              s,
              'manual',
              'Set next prescribed load',
              [
                ['weight', 'New resistance', resistanceInput(entry.workingResistance)],
                ['programRevision', 'Current program revision (review in admin)', p.revision],
              ],
              extra,
            ),
          );
        }
        throw new Error('Unknown Workout interaction.');
      } catch (error) {
        logger.log('error', 'Workout interaction failed', {
          userId: i.user.id,
          message: error.message,
        });
        const payload = {
          content: safe(logger.redact(error.message), 1800),
          flags: MessageFlags.Ephemeral,
          allowedMentions: { parse: [] },
        };
        try {
          if (i.deferred || i.replied) await i.followUp(payload);
          else await i.reply(payload);
        } catch {
          logger.log('error', 'Could not deliver Workout error.');
        }
      } finally {
        if (acquired) busyUsers.delete(i.user.id);
      }
    },
  };
}
export function resistanceInput(r) {
  if (r.kind === 'bodyweight') return 'BW';
  if (r.kind === 'none') return 'none';
  if (r.kind === 'custom') return 'custom:' + r.display;
  return `${r.kind}:${r.value} ${r.unit}`;
}
