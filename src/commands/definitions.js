import { workoutDefinition } from '../workout/discord.js';
import {
  SlashCommandBuilder,
  PermissionFlagsBits as P,
  InteractionContextType,
  ApplicationIntegrationType,
} from 'discord.js';
const base = (name, description) =>
  new SlashCommandBuilder().setName(name).setDescription(description);
const target = (b) =>
  b.addUserOption((o) => o.setName('target').setDescription('Server member').setRequired(true));
export function definitions(settings) {
  const commands = [
    base('help', 'List available commands'),
    base('ping', 'Check bot latency'),
    base('server', 'Show server information'),
    base('user', 'Show your user information'),
    base('avatar', 'Show an avatar').addUserOption((o) =>
      o.setName('target').setDescription('User (defaults to you)'),
    ),
    target(base('roles', 'List a member’s roles privately')),
    base('add', 'Add two numbers')
      .addNumberOption((o) => o.setName('a').setDescription('First number').setRequired(true))
      .addNumberOption((o) => o.setName('b').setDescription('Second number').setRequired(true)),
    base('embed', 'Format text as an embed').addStringOption((o) =>
      o.setName('text').setDescription('Text').setMaxLength(1500).setRequired(true),
    ),
    base('card', 'Draw cards against the bot (Ace low; no wagers)'),
    base('feedback', 'Save a rating').addIntegerOption((o) =>
      o
        .setName('rating')
        .setDescription('Rating from 1 to 5')
        .setMinValue(1)
        .setMaxValue(5)
        .setRequired(true),
    ),
    base('tasks', 'Manage your private task list')
      .addStringOption((o) =>
        o
          .setName('action')
          .setDescription('Action')
          .setRequired(true)
          .addChoices(
            ...['list', 'add', 'toggle', 'remove'].map((name) => ({ name, value: name })),
          ),
      )
      .addStringOption((o) =>
        o
          .setName('value')
          .setDescription('Task text for add, full task ID for toggle/remove')
          .setMaxLength(300),
      ),
    base('ask', 'Ask the configured AI service (moderators only)')
      .setDefaultMemberPermissions(P.ManageGuild)
      .addStringOption((o) =>
        o
          .setName('prompt')
          .setDescription('Question sent to the AI provider')
          .setMaxLength(2000)
          .setRequired(true),
      ),
    base('purge', 'Delete recent unpinned messages in this channel')
      .setDefaultMemberPermissions(P.ManageMessages)
      .addIntegerOption((o) =>
        o
          .setName('count')
          .setDescription('Maximum to delete')
          .setMinValue(1)
          .setMaxValue(1000)
          .setRequired(true),
      )
      .addUserOption((o) => o.setName('target').setDescription('Only messages by this user'))
      .addIntegerOption((o) =>
        o
          .setName('minutes')
          .setDescription('Only messages sent in the last N minutes')
          .setMinValue(1)
          .setMaxValue(20160),
      )
      .addIntegerOption((o) =>
        o
          .setName('scan')
          .setDescription('Maximum messages to examine (default 1000)')
          .setMinValue(1)
          .setMaxValue(10000),
      ),
    ...['kick', 'ban'].map((action) =>
      target(
        base(action, `${action} a server member`).setDefaultMemberPermissions(
          action === 'ban' ? P.BanMembers : P.KickMembers,
        ),
      ).addStringOption((o) =>
        o.setName('reason').setDescription('Audit log reason').setMaxLength(400),
      ),
    ),
  ].filter((c) => !settings.disabled.includes(c.name));
  for (const c of settings.responses.filter((c) => c.enabled)) {
    const command = base(c.name, c.description);
    if (c.access === 'owner') command.setDefaultMemberPermissions(0n);
    else if (c.access === 'moderator') command.setDefaultMemberPermissions(P.ManageGuild);
    commands.push(command);
  }
  return [
    ...commands.map((c) => c.toJSON()),
    ...(!settings.disabled.includes('workout') ? [workoutDefinition({ guild: true })] : []),
  ];
}

// BOT_DM contexts only apply to global commands, not guild registrations.
export function developerDefinitions(settings) {
  const dm = (name, description) =>
    base(name, description)
      .setContexts(InteractionContextType.BotDM)
      .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
  return [
    dm('owner-auth', 'Authenticate with your authenticator to elevate for five minutes'),
    dm('owner-lock', 'Revoke your developer session and cancel custom execution'),
    ...(!settings.disabled.includes('customcommand')
      ? [
          dm('customcommand', 'Run your locally written developer utility after authentication')
            .addStringOption((o) =>
              o.setName('args').setDescription('Data for your local code').setMaxLength(1500),
            )
            .addStringOption((o) =>
              o
                .setName('guild-id')
                .setDescription('Optional target server ID (not the invocation context)')
                .setMaxLength(20),
            )
            .addStringOption((o) =>
              o
                .setName('channel-id')
                .setDescription('Optional target server channel ID')
                .setMaxLength(20),
            ),
        ]
      : []),
  ].map((c) => c.toJSON());
}
