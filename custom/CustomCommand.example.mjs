// Copy to CustomCommand.local.mjs. Authenticate with /owner-auth in the BOT DM first.
// Each /customcommand invocation loads a fresh worker/module. Server invocation is denied.
// This is TRUSTED local code with host-account privileges, not hostile-code isolation.
export default async function CustomCommand({ api, guildId, channelId, userId, args }) {
  await api.log('Running my temporary utility');
  return { guildId, channelId, userId, args, server: await api.inspect() };
  // Replace the return above with your own logic. Always await API calls.
  // Pass guild-id and channel-id in the DM command for purge; guild-id for kick/ban.
  // return await api.purge({ count: 50 });
  // return await api.purge({ count: 100, userId: args, scan: 1000 });
  // return await api.ban(args, 'Owner-requested maintenance');
  // For other Discord endpoints: await api.discord('GET', `/guilds/${guildId}/roles`);
}
