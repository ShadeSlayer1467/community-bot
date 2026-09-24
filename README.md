# Community Bot

One Discord bot with a password-protected local control panel and an owner-only, hot-reloaded JavaScript extension point. Node.js 24 LTS is recommended; minimum 22.12.0. Uses discord.js 14.27.0 and Discord API v10.

## Start here

1. Node.js 24 LTS is recommended. The launcher uses a compatible Node.js on PATH or falls back to the bundled Codex runtime on this PC. If neither is available, install Node.js 24 LTS. The old system Node.js 18.12.1 cannot run this project directly.
2. Copy `config.example.json` to `config.local.json`. Fill in the values using [CONFIGURATION.md](CONFIGURATION.md). All supplied credentials and IDs are blank.
3. Double-click `start.bat`. It checks Node.js, installs missing dependencies, and keeps startup errors visible. Keep its window open while the bot runs; Ctrl+C stops it. Alternatively, run `npm ci`, `npm run check`, then `npm start` in this folder.
4. Open `http://127.0.0.1:3210`. Sign in with your configured admin password. The bot connects automatically when configured; click **Sync commands to Discord** to register commands. Run `./Enable-Startup.ps1` to enable silent launch at Windows sign-in.
5. On your phone, use normal slash commands in a configured Discord server. Developer commands require a bot DM and TOTP; enroll through the local panel as described below. The PC and bot process must remain running.

You can use the panel offline with only an admin password filled in. Connect explains which Discord values are missing. Configuration-file changes require restarting the process; panel settings take effect as soon as you save. Sync updates Discord's visible command list.

## What is included

| Area | Commands / behavior |
| --- | --- |
| Utilities | `/help`, `/ping`, `/server` (including channel topic), `/user`, `/avatar`, `/roles`, `/add`, `/embed` |
| Community | `/card` (Ace low, no real currency), `/feedback` (one saved rating per member/server), `/tasks` (private per-user and per-server list) |
| AI | `/ask`; disabled by default, configured provider/model, moderation allowlist, cooldown and one concurrent request |
| Moderation | `/purge count:50`, optional `target`, `minutes`, and `scan`; `/kick`, `/ban` with reasons |
| Text commands | Add/edit/delete responses through the panel, with everyone/moderator/owner access and `{user}` / `{server}` placeholders |
| Local code | Bot DM only: `/owner-auth` grants five minutes with TOTP; `/customcommand` loads local JavaScript fresh; `/owner-lock` revokes access |

Replies are ephemeral (visible to the invoking user). Mentions are suppressed. Long results are attached as a text file. Ordinary chat is not monitored; no message-content privileged intent is needed.

The panel shows connection state, server details, currently configured commands, registered commands read from Discord, and recent logs. Refresh registered commands to remove individual obsolete registrations by their global/server scope. Sync restores enabled commands. It manages built-in toggles, response commands, moderation allowlists, custom execution timeout, cancellation, and persistent settings. Complex command behavior stays in source modules.

## Architecture

| Boundary | Location |
| --- | --- |
| Composition and lifecycle | `src/main.js`, `src/discord-host.js` |
| Slash schemas and dispatch | `src/commands/` |
| Owner, allowlist, Discord permissions, hierarchy | `src/authorization.js` |
| DM-only developer authorization, TOTP, replay guard and Windows credential encryption | `src/security/` |
| Moderation, tasks, optional AI | `src/services/` |
| Validated configuration, atomic JSON stores, logging | `src/config.js`, `src/settings.js`, `src/persistence.js`, `src/logging.js` |
| Loopback HTTP server and browser UI | `src/admin/` |
| Worker lifecycle and host API bridge | `src/custom/` |
| Your temporary source | `custom/CustomCommand.local.mjs` (ignored by Git) |

`data/` contains settings, tasks, feedback and rotating logs. It is ignored by Git; back it up yourself. Only one bot process should use a data directory. No external database or public web server is needed. This is a local browser interface, not a packaged native desktop executable.

## CustomCommand

Set the exact `customOwnerId` in your local config, also list it in `ownerIds`, and restart. Enroll Google Authenticator using the local panel's QR code, Connect and Sync. Copy `custom/CustomCommand.example.mjs` to `custom/CustomCommand.local.mjs`, edit locally, save, then use `/owner-auth` and `/customcommand` **in a direct message with the bot**. No restart or command registration is needed when editing the JavaScript file. See [CUSTOM_COMMAND.md](CUSTOM_COMMAND.md) for enrollment, five-minute sessions, target server/channel options and examples.

Only the exact developer owner with an active TOTP session in a bot DM can run it. Guilds, threads, groups and Administrator bypasses are denied. The secret is encrypted using Windows DPAPI and excluded from Git; elevated sessions disappear on restart. The worker isolates execution lifetime and most JavaScript failures; it is **not an OS security sandbox**. Locally written code runs with the host user's privileges. No endpoint accepts uploaded code or shell commands.

## Moderation limits

The caller must be a configured owner or allowed moderator and hold the appropriate Discord permission. The bot must also hold the required permission in the current channel. Kick/ban additionally check both role hierarchies and protected targets. A ban does not automatically remove historical messages.

Purge examines at most `scan` messages (default 1,000; maximum 10,000), deletes at most `count` (maximum 1,000), and works only in the current channel. It skips pinned messages and messages older than two weeks, with a one-minute safety margin. It batches 2–100 IDs and handles a single message separately. It does not claim to delete every message a user ever sent. Custom code can implement longer, explicitly scoped maintenance using individual delete requests, but must respect permissions, rate limits and timeout boundaries. Discord.js handles REST rate-limit queues; this bot does not run its own immediate retry loop.

See [REVIEW.md](REVIEW.md) for the original-project review and [VERIFICATION.md](VERIFICATION.md) for offline results and the live-test checklist.
