# Give this guide to another project: Community Bot notifications

This is a self-contained integration handoff for a coding agent working on another application. Community Bot is already implemented. Add a small notification client to the **calling project**, then connect it to useful events in that project.

## Copyable project prompt

> Implement Community Bot notifications in this project using this guide. Inspect the project's architecture and existing event/error handling first. Reuse its configuration, logging and dependency injection conventions. Add an optional, reusable notification client and a local Test Notification action or command. Connect notifications to meaningful completion, failure and manual-attention events that actually exist in the code. Notify on state transitions, not every polling iteration. Keep notification failures from crashing or blocking the main workflow. Use the endpoint and dedicated credential described below; keep the token blank in committed templates and load its real value from local secret storage. Do not read Community Bot's Discord token, admin password or TOTP storage. Do not change its destination or regenerate its notification credential. Add focused tests using a mock HTTP service, build/test this project, and document the exact local credential setup. Report which real events were connected and how to try them. Do not claim a Discord message was delivered based only on mock tests.

Good integration points include a scheduled task becoming due, failed workflow verification, a stuck or unknown state, manual intervention, and meaningful task completion. Inspect the calling project to find real events; do not invent events merely to produce notifications.

## What the caller needs

The caller and Community Bot must run on the same Windows PC. Community Bot must be running and connected to Discord.

| Local setting | Value |
| --- | --- |
| Notifications enabled | Add an optional toggle in the calling project; default off until configured |
| `COMMUNITY_NOTIFICATION_URL` | `http://127.0.0.1:3210/api/notifications` by default |
| `COMMUNITY_NOTIFICATION_TOKEN` | Leave blank in examples; user supplies the dedicated notification credential locally |
| Source/application name | A stable name for the calling project, e.g. `Build Agent` |

These environment names match the provided example clients. A project's existing secret/configuration system may supply the same values instead. A `.env` file is not automatically loaded by the examples; use the project's existing loader or actual process environment. Restart the calling application after changing its environment.

Use the literal loopback address **127.0.0.1**, not `localhost`, a LAN IP, or a public URL. The port can be changed if Community Bot uses a different port. Validate the endpoint as HTTP, host `127.0.0.1`, path `/api/notifications`, with no embedded credentials, query or fragment. Disable HTTP redirects so the bearer credential cannot be redirected elsewhere. Avoid routing this request through a proxy.

The caller does **not** need Discord APIs, Discord.js, a Discord bot token, guild/channel/user IDs, slash commands, an admin login, or TOTP. Community Bot's saved Notifications settings choose the recipient.

Community Bot also supports **Agent Channels**: it creates and reuses one channel per `source` inside the administrator's configured category. Use a stable application name (e.g. `Build Agent`) on every event. Do not append job IDs, timestamps or status to `source`; use `title` or `context` for those. A new source automatically gets its channel on its first notification. No extra caller fields or channel-management code are needed. Source names are labels, not authentication identities.

## One-time user setup in Community Bot

1. Open `http://127.0.0.1:3210` and sign in locally.
2. In **Notifications**, enable notifications and choose **Guild Channel** or **Direct Message**. Fill the corresponding IDs, then save. This destination is shared by local callers; changing it never requires edits in their projects.
3. Click **Validate destination**, then **Send Test Notification**. Verify the message arrives.
4. If you already saved a notification credential, reuse it. Otherwise select **Generate / rotate notification credential** and copy the one-time value into the calling project's secret storage. Rotation invalidates the credential used by **all existing callers**, so update those callers too if rotating.
5. Start/restart the calling application with notifications enabled and the credential loaded. Use its explicit test action before enabling recurring events.

Never put the credential into this guide, source code, committed configuration, prompts, screenshots or logs. Community Bot stores a verifier only; its credential cannot be recovered by reading its files. Generation/rotation is an admin operation, not something the caller should automate.

## Request contract

```http
POST /api/notifications HTTP/1.1
Host: 127.0.0.1:3210
Authorization: Bearer <local notification credential>
Content-Type: application/json
```

```json
{
  "source": "Build Agent",
  "severity": "attention",
  "title": "Manual attention required",
  "message": "The workflow could not verify the expected UI state.",
  "context": {
    "workflow": "training",
    "attempt": 3
  }
}
```

| Field | Rules |
| --- | --- |
| `source` | Required nonempty string; max 80 characters |
| `title` | Required nonempty string; max 200 characters |
| `message` | Required nonempty string; max 1,500 characters |
| `severity` | Required: `info`, `success`, `warning`, `error`, `attention`; case-insensitive |
| `timestamp` | Optional ISO 8601 string with timezone, e.g. `2026-10-03T17:00:00Z`; omit to use receipt time |
| `context` | Optional object, max 10 fields. Keys: nonempty strings, max 50 characters. Values: strings, finite numbers or booleans, max 200 characters when converted to text. No nested objects, arrays or null values |

Omit absent optional fields rather than sending `null`. The total JSON body must be at most 64,000 bytes. Unknown top-level fields are rejected. In particular, do not send `guildId`, `channelId`, `userId`, `command`, `settings`, scripts, or recipient overrides. Context metadata is display-only and does not control delivery.

Choose short, actionable text: what happened, what it affects, and what the user should do. Do not send full exception dumps, secrets or large logs. Mentions are suppressed; do not rely on `@everyone`, `@here`, role or user mentions.

## Responses and failure handling

The request waits for delivery or a failure. It does not immediately return a queued acknowledgment.

HTTP 200, accepted by Discord:

```json
{ "id": "request-uuid", "status": "delivered" }
```

HTTP 200, duplicate suppressed:

```json
{
  "id": "request-uuid",
  "status": "duplicate",
  "originalId": "original-uuid",
  "originalStatus": "pending"
}
```

`originalStatus` is `pending` or `delivered`. A pending duplicate is not a delivery guarantee. Store the returned IDs in safe local diagnostics for correlation with the Community Bot panel. There is no notification-status polling API for callers.

Example failure:

```json
{
  "code": "rate_limited",
  "error": "Notification limit reached. Retry after the indicated delay.",
  "retryAfterSeconds": 60
}
```

| HTTP result | Caller behavior |
| --- | --- |
| 400: invalid payload | Fix schema/lengths; do not retry unchanged input |
| 401: unauthorized | Missing, wrong or rotated credential; report a setup problem without printing it |
| 403: local-origin restriction | Check literal loopback address and request headers; do not bypass the admin security model |
| 429: rate limit / queue full / Discord rate limit | Honor `Retry-After` and `retryAfterSeconds`; use bounded retries |
| 502: destination/permissions/DM/delivery failure | Record the safe error and direct the user to Community Bot's destination settings |
| 503: disabled/disconnected/stopping/queue expired/settings changed | Keep the main application working; report unavailable delivery and retry later only under a bounded policy |
| 504 or client timeout | Delivery may be uncertain; do not immediately loop and resend |
| Connection refused | Community Bot is stopped or using another port; handle as optional service unavailable |

Use a 120-second client timeout and asynchronous I/O. Await or supervise background tasks; avoid unobserved fire-and-forget exceptions. Catch network failures as well as non-2xx responses. Do not make notification delivery a prerequisite for completing the calling application's main work.

Defaults are **10 notifications per rolling minute**, **20 active+queued jobs**, and **60 seconds deduplication**, shared across applications and editable in Community Bot. Do not try to bypass limits by changing source names. Identical source/title/message/severity/context for the same destination deduplicate regardless of timestamp. Failed delivery attempts consume rate-limit capacity. Queued jobs expire after 60 seconds; each delivery has a 30-second deadline.

Queue and deduplication are in memory and reset when Community Bot restarts. This is best-effort delivery, not an exactly-once or durable job system. If a calling project must retain critical events, persist a small bounded outbox in that project. Keep event text stable when retrying, cap attempts, and coalesce repeated stuck/error states instead of flooding the transport.

## Existing helpers on this PC

Copy the relevant helper from this repository into the calling project and adapt it to that project's conventions. Avoid adding a runtime dependency on this repository's location. If the helper is unavailable, implement the HTTP contract above with the project's standard HTTP library.

### C# / .NET 8+

Reusable helper:

[`examples/notifications/csharp/CommunityNotifier.cs`](../examples/notifications/csharp/CommunityNotifier.cs)

The helper contains `Notification`, `NotificationResult`, `NotificationException` and `CommunityNotifier`; it needs only .NET libraries. Reuse a client instance and dispose it at application shutdown. It supports cancellation and handles camelCase JSON correctly.

```csharp
var token = Environment.GetEnvironmentVariable("COMMUNITY_NOTIFICATION_TOKEN");
// In production, treat a missing token as optional integration unavailable.
if (!string.IsNullOrWhiteSpace(token))
{
    using var notifier = new CommunityNotifier(token,
        Environment.GetEnvironmentVariable("COMMUNITY_NOTIFICATION_URL")
        ?? "http://127.0.0.1:3210/api/notifications");

    try
    {
        var result = await notifier.SendAsync(new Notification
        {
            Source = "Build Agent",
            Severity = "Attention",
            Title = "Needs attention",
            Message = "Could not verify the expected UI state."
        });
        Console.WriteLine($"Notification {result.Id}: {result.Status}");
    }
    catch (NotificationException ex)
    {
        Console.WriteLine($"Notification unavailable: {ex.Code}; retry delay: {ex.RetryAfterSeconds}");
    }
    catch (HttpRequestException)
    {
        Console.WriteLine("Community Bot is unreachable.");
    }
    catch (OperationCanceledException)
    {
        Console.WriteLine("Notification timed out or was cancelled; delivery may be uncertain.");
    }
}
```

For .NET versions older than 8, adapt the types/language syntax and HTTP calls to the existing target rather than upgrading the whole application solely for notifications.

### JavaScript / Node.js 22+

Reusable helper:

[`examples/notifications/notify.mjs`](../examples/notifications/notify.mjs)

```js
import { sendNotification } from './notify.mjs';

try {
  const result = await sendNotification({
    source: 'My Application',
    severity: 'success',
    title: 'Task completed',
    message: 'The operation finished successfully.'
  });
  console.log('Notification', result.id, result.status);
} catch (error) {
  // Do not log HTTP request objects or Authorization headers.
  console.warn('Notification unavailable:', error.code || 'transport_error');
}
```

The helper reads the two environment variables above. Neither helper implements automatic retries; that policy belongs to the calling application.

## Completion criteria for the receiving project

- Notifications are optional and configurable without source edits; secrets stay outside version control.
- Real event transitions produce appropriate messages, with caller-side cooldown/coalescing where polling is involved.
- Requests contain content only and use the dedicated notification credential.
- A Test Notification action sends a clearly labeled message through the same client as real events.
- Mock tests cover successful delivery, duplicate responses, 401, 429, unavailable service and malformed configuration. Main application work survives delivery failure.
- The project builds and its relevant tests pass. Document what was tested offline versus actually delivered.
- A live test, when requested, returns `delivered` and is confirmed in Discord. Phone push behavior depends on Discord/device settings.

For Community Bot's own setup details, see [NOTIFICATIONS.md](NOTIFICATIONS.md). Do not reimplement or modify Community Bot to integrate another caller.
