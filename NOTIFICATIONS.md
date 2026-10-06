# Local notifications

Other programs on this PC can POST notification content to Community Bot. The bot sends a colored Discord embed to the channel or DM recipient saved in its local Notifications panel. This requires no slash commands or TOTP. It never executes submitted text or changes settings.

## Setup

### Agent Channels: one channel per application

Select **Agent Channels (one per source)**, enter your personal server's Guild ID, then use **Create Agent Notifications category** or enter an existing Category ID. Enable and save. The create button makes a category visible to configured owners and the bot (server administrators can also access it). Existing categories retain their permissions. Set the category's Discord notification preference to **All Messages** on your account if you want mobile alerts without mentions.

Each first notification dynamically creates a text channel from the existing `source` field: `Build Agent` becomes `#build-agent`. Later notifications reuse its stored channel ID, even across bot restarts. New applications just send their own stable `source`; callers need no new fields or Discord IDs. Case-only differences reuse a source. Different spellings are separate sources. Test Notification uses the editable **Test source** field (default `Community Bot`); set it to your agent's exact source to test that agent's channel.

Channels inherit category permissions. The bot needs Manage Channels plus View Channel, Send Messages and Embed Links. Renamed channels keep working by ID; deleted agent channels are recreated. Channels moved outside the configured category are rejected, not followed. There is a 25-agent/channel cap per category to bound accidental creation; the existing notification rate and queue limits still apply. Category/channel creation is explicit to this configured mode: callers cannot supply arbitrary recipients or categories. Source is a routing label, not an authenticated agent identity, since callers share one credential. Agent mappings are stored in ignored `data/notification-agent-channels.json` and shown in the panel. Existing DM history is left intact; future messages follow the selected mode.

### Single destination setup

**Phone alerts for the whole agent category:** in Discord's server Notifications, open Notification Overrides, select **Agent Notifications**, and choose **All Messages**. Enable Mobile Push Notifications and unmute the category/server. Leave child channels on their default/inherited notification setting; explicit per-channel Mentions-only overrides take precedence and should be removed. This is an account preference, not a permission or writable bot channel setting, so Community Bot cannot turn it on using its bot token. Category permissions and notification preferences are separate. See [Discord's notification settings guide](https://support.discord.com/hc/en-us/articles/215253258-Notifications-Settings-101).

1. Start Community Bot and connect to Discord. Open `http://127.0.0.1:3210` and sign into the admin panel.
2. Open **Notifications**. Notifications are initially disabled and the default mode is **Guild Channel**.
3. For **Guild Channel**, enter **Notification Guild ID** and **Notification Channel ID**. Copy these IDs using Discord Developer Mode. The bot must be a member of that server and have **View Channel**, **Send Messages**, and **Embed Links** in that channel. Use a text or announcement channel; threads, forums, voice channels and group DMs are not supported.
4. For **Direct Message**, select that mode and enter **Notification User ID**. This initially uses `customOwnerId`, or the first `ownerIds` entry, when notification settings are first created. The saved ID remains independently editable afterward. The recipient must allow DMs from the bot.
5. Enable notifications and click **Save notification settings**, then **Validate destination**. The panel shows the resolved server/channel name or DM recipient. DM validation resolves the account; only a test send proves DMs can be delivered.
6. Click **Send Test Notification**. It uses the saved destination and the same queue, rate limits and deduplication as other notifications. Repeated identical tests may report `duplicate` within the dedup window.
7. Click **Generate / rotate notification credential**, confirm, and use **Copy notification credential**. The credential is shown once in a masked field, cleared after 60 seconds or on logout, and cannot be retrieved later. Keep it in the calling application's local secret storage or environment variable `COMMUNITY_NOTIFICATION_TOKEN`. Do not commit it or include it in screenshots, logs or diagnostics.

To change server, channel, or DM recipient, edit the corresponding ID in Notifications and save. To switch delivery mode, select the other mode, check its IDs and save. No source edit, restart or Discord command sync is necessary. Queued work is cancelled with `settings_changed`; a delivery already in progress may finish at its original destination. Future submissions use the new settings.

Rotation immediately rejects the old credential. Update your callers with the new one. Already accepted deliveries may finish. The bot stores only a SHA-256 verifier of the random 256-bit credential in ignored `data/security/notification-credential.json`, not the original credential. Caller applications must secure their own copies. The notification API cannot retrieve, rotate or change credentials/settings; these operations require the existing browser admin session and CSRF protection.

## HTTP contract

`POST http://127.0.0.1:3210/api/notifications` (use your configured panel port).

Headers:

```text
Authorization: Bearer <notification credential>
Content-Type: application/json
```

This shares the existing server bound to `127.0.0.1`. Use that exact address, not a LAN address or `localhost` alias: strict Host checks remain enabled. Browser cross-origin access is rejected. No CORS exemption is added. The API credential grants only notification submission, never admin, TOTP or CustomCommand access.

```json
{
  "source": "Build Agent",
  "severity": "attention",
  "title": "Manual attention required",
  "message": "The release workflow could not verify the expected deployment state.",
  "timestamp": "2026-10-03T17:00:00Z",
  "context": { "workflow": "training", "attempt": 3 }
}
```

The application name is just a routing label; Community Bot contains no caller-specific behavior.

| Field | Contract |
| --- | --- |
| source | Required string, 1–80 characters |
| title | Required string, 1–200 characters |
| message | Required string, 1–1,500 characters |
| severity | Required: info, success, warning, error, attention; case-insensitive |
| timestamp | Optional ISO 8601 string including timezone; defaults to receipt time |
| context | Optional object: at most 10 fields; keys 1–50 characters; values string/number/boolean, at most 200 characters each; no nested structures |

Unknown top-level fields are rejected, including `guildId`, `channelId`, `userId`, `command`, and `settings`. The caller cannot choose a destination. The HTTP body limit is 64,000 bytes; content lengths are additionally validated. Recognizable notification credentials and configured secrets are redacted from outbound content. Do not intentionally send credentials.

HTTP **200** waits for delivery, returning:

```json
{ "id": "request-uuid", "status": "delivered" }
```

A suppressed duplicate returns HTTP **200**:

```json
{ "id": "request-uuid", "status": "duplicate", "originalId": "original-uuid", "originalStatus": "delivered" }
```

`originalStatus` can also be `pending`: suppression is not a delivery guarantee. Check the panel's history for the original ID. The embed shows source, title, body, severity, timestamp and optional context. Mentions are disabled for everyone/here/users/roles. Discord mobile push notifications still depend on your Discord channel/DM notification settings, mute/DND settings and desktop/mobile behavior; HTTP success means Discord accepted the message, not that your phone displayed a push.

## Limits and failures

Default limits: **10 submissions per rolling minute**, **20 active+queued notifications**, **60 seconds duplicate suppression**. The panel permits 1–60/minute, 1–100 queue capacity and 0–3,600 seconds deduplication. Limits are shared by all callers, so changing `source` cannot bypass them. Failed delivery attempts count against the rate limit; duplicates do not. Notifications are serialized. Identical source/title/body/severity/context to the same destination deduplicate independent of timestamp; deduplication covers pending work and starts its post-success window on delivery. Failed deliveries are eligible for explicit retry.

Queued jobs older than 60 seconds expire. A delivery has a 30-second deadline and cancellable Discord message request. Discord.js handles its own rate-limit pacing; the bridge does not add automatic delivery retries. A timeout/network interruption can leave delivery uncertain; avoid tight retry loops. Client helpers use a 120-second timeout. Cancelling the caller's HTTP request does not retract an already accepted notification.

```json
{ "code": "rate_limited", "error": "Notification limit reached. Retry after the indicated delay.", "retryAfterSeconds": 60 }
```

| HTTP | Codes / meaning |
| --- | --- |
| 400 | invalid_payload: schema, JSON, lengths, or unexpected fields |
| 401 | unauthorized: missing, wrong, or rotated notification credential |
| 403 | wrong Host/Origin or non-loopback request |
| 429 | rate_limited, queue_full, discord_rate_limit; honor Retry-After header and retryAfterSeconds |
| 502 | invalid_guild, invalid_channel, missing_permissions, invalid_recipient, dm_delivery_failed, delivery_failed |
| 503 | disabled, disconnected, settings_changed, queue_expired, stopping, unavailable |
| 504 | delivery_timeout: result uncertain, inspect destination/history before retrying |

The panel retains the latest 100 result records in memory (including failures, rejections and duplicate IDs). Rotating application logs retain safe status/error codes without notification content or credentials. Queue, rate history and dedup state are in memory and reset on restart; this is a best-effort bridge, not a durable delivery system. Graceful shutdown rejects queued work. A crash can lose queued requests; callers should retain important events themselves and use bounded backoff, especially when a response was lost.

## JavaScript caller

Copy `examples/notifications/notify.mjs` into your Node.js 22+ application:

```js
import { sendNotification } from './notify.mjs';
await sendNotification({
  source: 'My Application', severity: 'success',
  title: 'Finished', message: 'The operation completed.'
});
```

Set `COMMUNITY_NOTIFICATION_TOKEN` locally first. To try the bundled sample: `node examples/notifications/send-example.mjs`. Optional `COMMUNITY_NOTIFICATION_URL` changes the loopback port; it cannot redirect credentials to another host.

## C# caller

Copy `examples/notifications/csharp/CommunityNotifier.cs` into a .NET 8+ project. It uses only framework libraries. The bot itself remains JavaScript.

```csharp
using var notifier = new CommunityNotifier(
    Environment.GetEnvironmentVariable("COMMUNITY_NOTIFICATION_TOKEN")!);
await notifier.SendAsync(new Notification
{
    Source = "Build Agent",
    Severity = "Attention",
    Title = "Needs attention",
    Message = "Could not verify the expected UI state."
});
```

Reuse the client and handle `NotificationException` (including `Code` and `RetryAfterSeconds`) and network exceptions in the caller. No Discord IDs or Discord token belong in the caller. `dotnet run --project examples/notifications/csharp` runs the sample after setting the environment credential. Both helpers disable redirects and validate the endpoint. Neither retries automatically.

## Architecture and troubleshooting

`src/notifications/model.js` validates data, `credential.js` handles the dedicated verifier and redaction, `delivery.js` resolves Discord destinations/checks permissions, and `service.js` owns limits, queue, deduplication and history. `src/admin/server.js` exposes the authenticated content route and existing admin-protected settings/actions. `data/notifications.json` persists settings through the existing atomic store.

CustomCommand still uses its separate DM → exact owner → TOTP → short-lived elevation flow. Notification submission never calls its runner. The public payload accepts no scripts, recipient overrides, settings mutations or admin actions.

If nothing arrives: check enabled state, Discord connection, saved destination validation and notification history; then use Send Test. For channel errors, check both IDs, bot membership and channel overrides including Embed Links. For DM errors, check User ID, shared server and privacy settings. For 401, update the caller's credential after rotation. For 429, honor Retry-After. If the channel receives the embed but the phone stays quiet, check Discord notification preferences. Use the local Activity log for safe failure codes.

Discord references: [Create Message / embeds / allowed mentions](https://docs.discord.com/developers/resources/message#create-message), [Create DM](https://docs.discord.com/developers/resources/user#create-dm).
