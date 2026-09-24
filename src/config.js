import fs from 'node:fs';
import path from 'node:path';
export const root = path.resolve(import.meta.dirname, '..');
export const snowflake = (value) => typeof value === 'string' && /^[0-9]{17,20}$/.test(value);
export function validateConfig(c) {
  if (!c || typeof c !== 'object') throw new Error('Configuration must be an object.');
  c.customOwnerId ??= '';
  if (c.customOwnerId !== '' && !snowflake(c.customOwnerId))
    throw new Error('customOwnerId must be one quoted Discord user ID.');
  for (const key of [
    'discordToken',
    'applicationId',
    'adminPassword',
    'openaiApiKey',
    'openaiModel',
  ]) {
    if (typeof c[key] !== 'string') throw new Error(`${key} must be a string.`);
  }
  for (const key of ['guildIds', 'ownerIds']) {
    if (!Array.isArray(c[key]) || !c[key].every(snowflake))
      throw new Error(`${key} must contain Discord IDs as quoted strings.`);
  }
  if (c.applicationId && !snowflake(c.applicationId))
    throw new Error('applicationId must be a Discord ID.');
  if (c.customOwnerId && !c.ownerIds.includes(c.customOwnerId))
    throw new Error('customOwnerId must also appear in ownerIds.');
  if (!Number.isInteger(c.port) || c.port < 1024 || c.port > 65535)
    throw new Error('port must be 1024–65535.');
  if (c.adminPassword && c.adminPassword.length < 16)
    throw new Error('adminPassword must have at least 16 characters.');
  return c;
}
export function loadConfig(file = path.join(root, 'config.local.json')) {
  if (!fs.existsSync(file))
    throw new Error(
      'Copy config.example.json to config.local.json and fill in the values described in CONFIGURATION.md.',
    );
  try {
    return validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error('config.local.json is not valid JSON.');
    throw e;
  }
}
export function connectionIssues(c) {
  return ['discordToken', 'applicationId']
    .filter((k) => !c[k])
    .map((k) => `Fill in ${k} in config.local.json.`)
    .concat(c.ownerIds.length ? [] : ['Configure at least one ownerIds entry.'])
    .concat(c.guildIds.length ? [] : ['Configure at least one guildIds entry.']);
}
