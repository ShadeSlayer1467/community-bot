import { snowflake } from '../config.js';

export class NotificationError extends Error {
  constructor(code, message, status = 400, retryAfter) {
    super(message);
    Object.assign(this, { code, status, retryAfter });
  }
}
export const fail = (code, message, status = 400, retryAfter) => {
  throw new NotificationError(code, message, status, retryAfter);
};
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some((k) => !allowed.includes(k)))
    fail(
      'invalid_payload',
      'Unexpected fields or invalid object. Destinations belong in admin settings.',
    );
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(
      'invalid_payload',
      `Text fields must be nonempty strings within their documented limits (maximum ${max}).`,
    );
  return value.trim();
}
export function notificationDefaults(config) {
  return {
    enabled: false,
    mode: 'guild',
    guildId: '',
    channelId: '',
    categoryId: '',
    userId: config.customOwnerId || config.ownerIds?.[0] || '',
    perMinute: 10,
    queueLimit: 20,
    dedupSeconds: 60,
  };
}
export function validateNotificationSettings(s) {
  keys(s, [
    'enabled',
    'mode',
    'guildId',
    'channelId',
    'categoryId',
    'userId',
    'perMinute',
    'queueLimit',
    'dedupSeconds',
  ]);
  s.categoryId ??= '';
  if (typeof s.enabled !== 'boolean' || !['guild', 'dm', 'agents'].includes(s.mode))
    fail('invalid_settings', 'Choose Guild Channel, Direct Message or Agent Channels.');
  for (const k of ['guildId', 'channelId', 'userId', 'categoryId'])
    if (s[k] !== '' && !snowflake(s[k]))
      fail('invalid_settings', `${k} must be a quoted Discord ID or blank.`);
  if (
    s.enabled &&
    (s.mode === 'guild'
      ? !s.guildId || !s.channelId
      : s.mode === 'agents'
        ? !s.guildId || !s.categoryId
        : !s.userId)
  )
    fail(
      'invalid_settings',
      'Fill in the IDs for the selected destination before enabling notifications.',
    );
  for (const [key, min, max] of [
    ['perMinute', 1, 60],
    ['queueLimit', 1, 100],
    ['dedupSeconds', 0, 3600],
  ])
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max)
      fail('invalid_settings', `${key} must be an integer from ${min} to ${max}.`);
  return s;
}
export function validateNotification(p, now = Date.now()) {
  keys(p, ['source', 'title', 'message', 'severity', 'timestamp', 'context']);
  const source = text(p.source, 80),
    title = text(p.title, 200),
    message = text(p.message, 1500);
  const severity = typeof p.severity === 'string' ? p.severity.toLowerCase() : '';
  if (!['info', 'success', 'warning', 'error', 'attention'].includes(severity))
    fail('invalid_payload', 'severity must be info, success, warning, error, or attention.');
  if (
    p.timestamp !== undefined &&
    (typeof p.timestamp !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.timestamp) ||
      !Number.isFinite(Date.parse(p.timestamp)))
  )
    fail('invalid_payload', 'timestamp must be an ISO 8601 date with a timezone.');
  const context = {};
  if (p.context !== undefined) {
    if (!object(p.context) || Object.keys(p.context).length > 10)
      fail('invalid_payload', 'context must contain at most 10 simple fields.');
    for (const [key, value] of Object.entries(p.context)) {
      text(key, 50);
      if (
        !['string', 'number', 'boolean'].includes(typeof value) ||
        (typeof value === 'number' && !Number.isFinite(value)) ||
        String(value).length > 200
      )
        fail(
          'invalid_payload',
          'context values must be strings, finite numbers, or booleans of at most 200 characters.',
        );
      Object.defineProperty(context, key, { value, enumerable: true });
    }
  }
  return {
    source,
    title,
    message,
    severity,
    timestamp: new Date(p.timestamp ?? now).toISOString(),
    context,
  };
}
