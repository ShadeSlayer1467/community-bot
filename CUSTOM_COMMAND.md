# CustomCommand: edit on the PC, invoke from your phone

1. Copy `custom/CustomCommand.example.mjs` to `custom/CustomCommand.local.mjs`.
2. Put your logic inside its default exported async function. Save the file on the host PC.
3. Set `customOwnerId` to your exact Discord user ID (a quoted string), also list it in `ownerIds`, and restart. No other owner/moderator/administrator inherits developer access.
4. Enroll Google Authenticator locally using the steps below. Connect and Sync commands once to remove old guild registrations and register the DM commands globally.
5. From your phone, open a **direct message with this bot**, invoke `/owner-auth`, and enter a fresh six-digit code in its form. This grants five minutes of developer access. Invoke `/customcommand` in that same bot DM; optionally supply `args` as data and `guild-id` / `channel-id` as action targets. Guilds, threads, group DMs, other private contexts and unknown contexts are always rejected, even for administrators.
6. Edit and save the file again for your next operation. Every invocation starts a fresh worker and reloads the module and its imports; no bot restart is required.

There is no Discord option for submitting code, a file path, or a shell command. Only the fixed local file is loaded. You can import local modules and write arbitrary JavaScript logic. Code requiring persistent services or interaction components should become a normal source command/service rather than a temporary worker.

## Google Authenticator enrollment

1. Run the bot on Windows under the Windows account that will normally host it. Open the local panel at `http://127.0.0.1:3210` and sign in.
2. In **Developer authenticator**, re-enter the local admin password and click **Enroll / replace authenticator**. The configured `customOwnerId` is displayed above it.
3. In Google Authenticator, choose **+ → Scan a QR code** and scan the QR shown on this PC. Other standard TOTP apps work too. The expandable standard `otpauth://` provisioning URI is an alternative setup mechanism. Treat both as a credential; never share them.
4. Enter the six-digit code from the new authenticator entry into **Authenticator setup code**, then click **Confirm enrollment**. Setup expires after five minutes or five incorrect codes. It is bound to that panel login session. The existing authenticator is replaced only after successful confirmation; any current developer session is revoked.
5. The QR and URI disappear after confirmation, expiry or logout. Enrollment itself does **not** elevate Discord access. Wait for the next authenticator code, then use `/owner-auth` in the bot DM. The enrollment code's time step has already been consumed.

The implementation uses otplib 13.5.0: standard SHA-1 TOTP, six digits, 30-second periods, with at most one time step of clock drift in either direction. Accepted time steps are saved before elevation and cannot be replayed, including after a restart. Five failed codes cause a five-minute authentication lockout, also retained across restart. Synchronize the time automatically on both your phone and PC.

Elevation lasts five minutes without sliding renewal, lives only in process memory, and disappears on restart/disconnect. `/owner-lock` in the DM or **Revoke developer session** in the panel revokes it immediately and cancels the custom worker. A newly authenticated session supersedes the previous session. Worker runtime is limited to the lesser of the configured execution timeout and the remaining elevation lifetime; existing tickets and further bridge calls are denied after expiry/revocation.

## Credential storage and recovery

The secret and replay/lockout metadata are encrypted with Windows DPAPI **CurrentUser** in `data/security/totp.dpapi.json`. That file and all `data/` are ignored by Git; plaintext secrets are never written there. The bot never sends the secret through Discord, includes it in ordinary status responses, or logs authenticator form fields. QR generation happens locally, without an external QR service. No TOTP enrollment is performed automatically for you.

DPAPI binds decryption to the host Windows account/profile. Run the bot under the same account after restarting; don't copy the protected file to a different host/account and expect it to decrypt. If you lose the authenticator, sign in locally and enroll a replacement with your admin password. If the encrypted file is inaccessible/corrupt and prevents startup, stop the bot, move that exact credential file to a private backup, restart and re-enroll locally. Removing it never grants access: the feature remains locked until enrollment and a fresh DM authentication succeed. Backups and the host account remain sensitive; run only one bot process against this data directory.

## Examples

Delete up to 50 recent unpinned messages in a target server channel. In the bot DM, run `/customcommand guild-id:<server-id> channel-id:<channel-id>`:

```js
export default async function CustomCommand({ api }) {
  return await api.purge({ count: 50 });
}
```

Delete a particular user's recent messages. From the bot DM, invoke `/customcommand guild-id:<server-id> channel-id:<channel-id> args:<user-id>`:

```js
export default async function CustomCommand({ api, args }) {
  const userId = args.trim();
  if (!/^\d{17,20}$/.test(userId)) throw new Error('Pass a Discord user ID.');
  return await api.purge({ userId, count: 1000, scan: 10000 });
}
```

Ban one current server member, with permission and hierarchy checks. Supply `guild-id` and `args:<user-id>` in the DM command:

```js
export default async function CustomCommand({ api, args }) {
  const userId = args.trim();
  if (!/^\d{17,20}$/.test(userId)) throw new Error('Pass a Discord user ID.');
  return await api.ban(userId, 'Owner maintenance');
}
```

Write a different operation using the general Discord REST bridge:

```js
export default async function CustomCommand({ api, guildId }) {
  const roles = await api.discord('GET', `/guilds/${guildId}/roles`);
  return roles.map(role => ({ id: role.id, name: role.name }));
}
```

This is not limited to those examples. You can branch on `args`, transform results, import your own libraries, or call other Discord endpoints. The bridge uses the main bot's authenticated, rate-limited REST client; it accepts only Discord-relative routes and GET/POST/PUT/PATCH/DELETE. It does not accept arbitrary network destinations. For POST/PUT/PATCH pass a JSON body as the third argument. File uploads and specialized request options require extending the host bridge or adding a normal source service.

## Context and helpers

Your function receives `{ guildId, channelId, userId, dmChannelId, args, api }`. `userId` and `dmChannelId` come from the authenticated DM interaction. `guildId` and `channelId` are optional, explicitly selected and validated targets; they are null if omitted. Target guilds must be configured in `guildIds`; a target channel must belong to that guild. For helpers, caller and bot permissions are resolved from the target server, never assumed from the DM. Target selection does not change the invocation context.

| Helper | Behavior |
| --- | --- |
| `await api.purge({ count, userId?, minutes?, scan? })` | Selected target channel only, bounded scan, preserves pins/old messages, checks caller and bot permissions |
| `await api.ban(userId, reason)` | Bans a current member after permissions/hierarchy checks; does not delete history |
| `await api.kick(userId, reason)` | Kicks a current member after permissions/hierarchy checks |
| `await api.inspect()` | Returns selected server details, or a harmless DM context summary if no target was provided |
| `await api.discord(method, route, body?)` | General Discord REST escape hatch for trusted owner code |
| `await api.log(message)` | Writes a bounded message to the host log |

Return a string or a JSON-serializable value for an ephemeral response. Keep the result small; custom output is capped at 1,900 characters. Always await every helper call before returning. Worker stdout/stderr are drained, not shown in the panel; use `api.log` for useful diagnostics. Never log secrets.

## Execution and trust boundaries

- The central DeveloperAccess service requires BOT_DM context, a real one-to-one DM channel, no guild, exact `customOwnerId` equality and a current TOTP session. It creates an opaque, single-use execution ticket. The runner requires that ticket and rechecks elevation before host API calls. The old owner-ID-only runner signature cannot execute code. Normal command names cannot obtain tickets.
- The worker is separate from the bot event loop. A syntax error, thrown error, or infinite JavaScript loop is reported without killing the bot. Each worker has a V8 heap limit and a configurable 1–120 second deadline (default 30).
- Only one custom invocation runs per bot process. API bridge calls are serialized, capped at 200 per invocation, and checked again for owner authorization and enabled state. The panel can cancel the active invocation.
- At timeout/cancel/return, the worker is terminated and no new bridge calls are started. An already-submitted Discord action might complete; it cannot be rolled back. The lock remains held until the worker exits and pending host calls drain. Purge checks cancellation between pages and before deletion; REST requests already in progress may finish.
- This is **trusted local developer code**, not an operating-system security sandbox. Workers can import Node modules, read files, use the network, or spawn processes under your Windows account. Terminating a worker cannot guarantee termination of child processes or native work it launches. Do not run untrusted scripts or use this mechanism to spawn unmanaged background work.
- The general REST escape hatch enforces owner authorization and Discord's bot permissions, but it cannot infer the human permission or role-hierarchy policy of every possible endpoint. Use the moderation helpers for their additional caller checks; when writing another sensitive operation, implement the appropriate authorization and scope in your local code.
- Ordinary response commands are plain data and cannot become custom code. The local panel cannot upload or edit executable scripts. No owner-array entry, moderator role or Administrator permission substitutes for the exact developer ID plus TOTP elevation in a bot DM.

To perform a long historical cleanup, write a bounded operation with an explicit cutoff/channel/user scope, cursor/checkpoint and dry-run mode, then run it in chunks. The built-in purge is intentionally not a promise to erase every historical message across a server.

References: [otplib verification](https://otplib.yeojz.dev/guide/getting-started.html), [Discord bot-DM command contexts](https://docs.discord.com/developers/interactions/application-commands#contexts), [Windows DPAPI](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata).
