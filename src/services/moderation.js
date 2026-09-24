import { checkTarget, requirePermissions, P } from '../authorization.js';
export const BULK_AGE = 14 * 24 * 60 * 60 * 1000;
export function selectMessages(messages, { userId, after, count }, now = Date.now()) {
  const matches = messages.filter(
    (m) =>
      (!userId || m.author.id === userId) &&
      (!after || m.createdTimestamp >= after) &&
      !m.pinned &&
      m.deletable !== false,
  );
  return {
    recent: matches.filter((m) => now - m.createdTimestamp < BULK_AGE - 60_000).slice(0, count),
    old: matches.filter((m) => now - m.createdTimestamp >= BULK_AGE - 60_000).length,
  };
}
export async function purge(i, { count = 50, userId, minutes, scan = 1000 } = {}, signal) {
  requirePermissions(i, P.ManageMessages | P.ViewChannel | P.ReadMessageHistory);
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 1000 ||
    !Number.isInteger(scan) ||
    scan < 1 ||
    scan > 10000
  )
    throw new Error('Count must be 1–1000; scan must be 1–10000.');
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 1 || minutes > 20160))
    throw new Error('Minutes must be 1–20160.');
  if (!i.channel?.bulkDelete) throw new Error('Purge requires a server text channel.');
  let before,
    scanned = 0,
    deleted = 0,
    skippedOld = 0;
  const after = minutes ? Date.now() - minutes * 60_000 : undefined;
  while (scanned < scan && deleted < count) {
    signal?.throwIfAborted();
    const batch = await i.channel.messages.fetch({
      limit: Math.min(100, scan - scanned),
      ...(before ? { before } : {}),
    });
    if (!batch.size) break;
    scanned += batch.size;
    before = batch.last().id;
    const selected = selectMessages([...batch.values()], { userId, after, count: count - deleted });
    skippedOld += selected.old;
    signal?.throwIfAborted();
    if (selected.recent.length === 1) {
      await selected.recent[0].delete();
      deleted++;
    } else if (selected.recent.length > 1)
      deleted += (
        await i.channel.bulkDelete(
          selected.recent.map((m) => m.id),
          true,
        )
      ).size;
    if (
      batch.last().createdTimestamp < Date.now() - BULK_AGE + 60_000 ||
      (after && batch.last().createdTimestamp < after)
    )
      break;
  }
  return {
    deleted,
    scanned,
    skippedOld,
    note: 'Current channel only. Pinned and older messages are preserved; this is a bounded history scan.',
  };
}
export async function moderate(i, action, targetId, reason = 'Requested moderation', signal) {
  if (!['kick', 'ban'].includes(action)) throw new Error('Unknown moderation action.');
  requirePermissions(i, action === 'ban' ? P.BanMembers : P.KickMembers);
  const [actor, target, bot] = await Promise.all([
    i.guild.members.fetch({ user: i.user.id, force: true }),
    i.guild.members.fetch({ user: targetId, force: true }),
    i.guild.members.fetchMe({ force: true }),
  ]);
  checkTarget(actor, target, bot, i.guild.ownerId);
  if (!(action === 'ban' ? target.bannable : target.kickable))
    throw new Error('Discord role hierarchy prevents this action.');
  signal?.throwIfAborted();
  const auditReason = `${i.user.id}: ${reason}`.slice(0, 500);
  if (action === 'ban') await target.ban({ reason: auditReason, deleteMessageSeconds: 0 });
  else await target.kick(auditReason);
  return `${action === 'ban' ? 'Banned' : 'Kicked'} ${target.user.tag}.`;
}
