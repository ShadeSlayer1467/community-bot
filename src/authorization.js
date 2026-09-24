import { PermissionFlagsBits as P } from 'discord.js';
export function requireOwner(userId, config) {
  if (!config.ownerIds.includes(userId))
    throw new Error('Only an explicitly configured bot owner can use CustomCommand.');
}
export function requireAccess(i, config, settings, access) {
  if (!i.inGuild() || !config.guildIds.includes(i.guildId))
    throw new Error('This server is not configured for this bot.');
  if (access === 'owner') return requireOwner(i.user.id, config);
  if (access === 'moderator') {
    const roles = i.member.roles.cache ? [...i.member.roles.cache.keys()] : i.member.roles;
    if (
      !config.ownerIds.includes(i.user.id) &&
      !settings.moderatorUserIds.includes(i.user.id) &&
      !roles.some((id) => settings.moderatorRoleIds.includes(id))
    )
      throw new Error('You are not on the bot moderation allowlist. Ask the host administrator.');
  }
}
export function requirePermissions(i, permission) {
  if (!i.memberPermissions?.has(permission))
    throw new Error('You lack the required Discord permission for this action.');
  if (!i.appPermissions?.has(permission))
    throw new Error('The bot lacks the required Discord permission in this channel.');
}
export function checkTarget(actor, target, bot, guildOwnerId) {
  if ([actor.id, bot.id, guildOwnerId].includes(target.id))
    throw new Error('Cannot target yourself, the bot, or the server owner.');
  if (actor.id !== guildOwnerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0)
    throw new Error('Your highest role must be above the target.');
  if (bot.roles.highest.comparePositionTo(target.roles.highest) <= 0)
    throw new Error('The bot role must be above the target.');
}
export { P };
