// Set COMMUNITY_NOTIFICATION_TOKEN in this caller's local environment/secret store.
// Optional COMMUNITY_NOTIFICATION_URL overrides only the loopback port.
export async function sendNotification(
  notification,
  {
    token = process.env.COMMUNITY_NOTIFICATION_TOKEN,
    endpoint = process.env.COMMUNITY_NOTIFICATION_URL || 'http://127.0.0.1:3210/api/notifications',
  } = {},
) {
  const url = new URL(endpoint);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/api/notifications' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use http://127.0.0.1:<port>/api/notifications.');
  if (!token) throw new Error('Configure COMMUNITY_NOTIFICATION_TOKEN in the calling program.');
  const response = await fetch(url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(notification),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(`${result.code}: ${result.error}`);
    error.code = result.code;
    error.retryAfterSeconds = result.retryAfterSeconds;
    throw error;
  }
  return result; // delivered OR duplicate (inspect originalStatus for pending/delivered)
}
