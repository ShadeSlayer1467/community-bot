import { snowflake } from './config.js';
export const builtinNames = [
  'help',
  'ping',
  'server',
  'user',
  'avatar',
  'roles',
  'add',
  'embed',
  'card',
  'feedback',
  'tasks',
  'ask',
  'purge',
  'kick',
  'ban',
  'customcommand',
  'workout',
];
export const defaults = {
  disabled: ['ask'],
  moderatorUserIds: [],
  moderatorRoleIds: [],
  customTimeoutSeconds: 30,
  responses: [
    {
      name: 'hi',
      description: 'A friendly greeting',
      text: 'Hello, {user}!',
      enabled: true,
      access: 'everyone',
    },
  ],
};
export function validateSettings(s) {
  if (!s || !Array.isArray(s.disabled) || !s.disabled.every((n) => builtinNames.includes(n)))
    throw new Error('Invalid disabled command list.');
  for (const k of ['moderatorUserIds', 'moderatorRoleIds'])
    if (!Array.isArray(s[k]) || !s[k].every(snowflake))
      throw new Error(`${k}: enter valid Discord IDs.`);
  if (
    !Number.isInteger(s.customTimeoutSeconds) ||
    s.customTimeoutSeconds < 1 ||
    s.customTimeoutSeconds > 120
  )
    throw new Error('Custom timeout must be 1–120 seconds.');
  if (!Array.isArray(s.responses) || s.responses.length > 50)
    throw new Error('At most 50 response commands are allowed.');
  const seen = new Set([...builtinNames, 'owner-auth', 'owner-lock']);
  for (const c of s.responses) {
    if (
      !c ||
      typeof c.name !== 'string' ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(c.name) ||
      seen.has(c.name)
    )
      throw new Error('Response command names must be unique, lowercase, and not reserved.');
    seen.add(c.name);
    if (typeof c.description !== 'string' || !c.description.trim() || c.description.length > 100)
      throw new Error('Descriptions must be 1–100 characters.');
    if (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 1800)
      throw new Error('Responses must be 1–1800 characters.');
    if (typeof c.enabled !== 'boolean' || !['everyone', 'moderator', 'owner'].includes(c.access))
      throw new Error('Invalid response access or enabled value.');
  }
  return s;
}
