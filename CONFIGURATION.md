# Configuration and Developer Portal setup

Copy `config.example.json` to `config.local.json` next to package.json. Keep API keys and the admin password in this local file, not this document. It is ignored by Git. TOTP is enrolled separately and stored encrypted; do not put its secret in the configuration. IDs must be quoted strings; never JSON numbers. Arrays start empty and must be filled with your own values.

| Setting | Where to get it / purpose |
| --- | --- |
| `discordToken` | [Discord Developer Portal](https://discord.com/developers/applications) → your application → Bot → Reset Token / copy token. Use a bot token, never your personal account token. |
| `applicationId` | Same application → General Information → Application ID. Must match the token's application. |
| `guildIds` | Discord Settings → Advanced → Developer Mode, then right-click/long-press your server → Copy Server ID. Add each server where this bot should work. |
| `ownerIds` | Developer Mode → your Discord profile → Copy User ID. These owners pass the ordinary moderation allowlist. At least one is required to connect. This array alone never grants CustomCommand access. |
| `customOwnerId` | One exact quoted Discord user ID, also listed in `ownerIds`. Only this account may authenticate for CustomCommand. Blank disables developer access. Add this field when upgrading an older config, then restart. |
| `adminPassword` | Choose your own unique password of at least 16 characters. Used only by the local admin panel. Required even for offline setup. |
| `port` | Local panel port, default 3210. Open the exact `http://127.0.0.1:<port>` URL. `localhost` is intentionally not accepted as an alternative Host header. |
| `openaiApiKey` | Optional: create an API key in your [OpenAI project](https://platform.openai.com/api-keys). Leave blank if you do not use `/ask`. |
| `openaiModel` | Optional: choose a text model your OpenAI API project can access. No model is silently selected for you. |

The old projects contained hard-coded credentials. Rotate any tokens/API keys/webhooks that are still active before reuse. The recoverable legacy backup can still contain those old credentials and must stay private.

## Install the bot in Discord

1. Create a dedicated Discord application (recommended to avoid old global commands), or select the application you intend this unified bot to own. Configure it for **Guild Install**.
2. In Installation / OAuth2 URL Generator, select `bot` and `applications.commands` scopes. Install it into the server(s) listed in `guildIds`.
3. Grant View Channels, Send Messages, Read Message History, Embed Links, and Attach Files. Grant Manage Messages, Kick Members and Ban Members only if you will use those features. Administrator is not required for the bot.
4. Move the bot's highest role above the roles of members it will moderate. Channel overwrites still matter. Give human moderators their required Discord permissions too.
5. Leave Message Content, Server Members, and Presence privileged intents off. The bot requests the non-privileged Guilds and DirectMessages intents; it fetches individual members through REST when necessary. Leave the Interactions Endpoint URL blank: this bot receives interactions through its outbound Gateway connection.
6. Start the bot, log in to the local panel, click Connect, then Sync commands to Discord. Normal commands are guild-scoped. The three developer commands are global with **BOT_DM-only** context and Guild Install integration type; this requires sharing an installed server with the bot. Global command changes can take time to appear in Discord clients.
7. Enroll an authenticator in the local panel following [CUSTOM_COMMAND.md](CUSTOM_COMMAND.md). Open a DM with the bot from your phone, run `/owner-auth`, submit a fresh code, then run `/customcommand`. No server command-permission override can bypass its runtime DM/TOTP gate.
8. Add moderator user/role IDs in the local panel and save. Discord command visibility may additionally need an Integrations override, particularly for `/ask` and moderator response commands (default Manage Server permission). The bot's allowlist remains enforced regardless of visibility overrides.

Sync replaces guild command lists for this application in configured guilds, removing their old CustomCommand registration, then upserts the three dedicated global DM commands. Other global commands are preserved. Disabling CustomCommand removes its global registration on the next sync, while owner-auth/owner-lock remain available. Old registrations in unconfigured guilds may remain visible, but execution there is always denied. Use a dedicated application because guild sync replaces its other guild command types too.

## Operating the panel

Browse to the printed loopback URL, enter your local password, and use the controls. The process automatically connects to Discord after the local panel starts, retrying failed initial connections every 30 seconds while the network becomes available. Missing configuration leaves the panel available for setup. After manually disconnecting, use Connect to reconnect.

Run `./Enable-Startup.ps1` to launch silently at Windows sign-in under your Windows account (required for the encrypted authenticator credential). This installs a shortcut in your Windows Startup folder. To disable it, use Windows Startup apps or remove `Community Bot.lnk` from `shell:startup`. The PC must remain awake. The local panel remains at the configured loopback URL; startup does not open a browser or synchronize commands automatically.

Saving toggles/access/responses updates runtime checks immediately. Click Sync to add or remove Discord slash registrations. Disabling a command blocks its handler even if Discord still displays an older registration. Removing a response command makes the old registration fail closed until sync.

Owner IDs/API keys cannot be edited from this web panel. Edit `config.local.json` locally and restart. Authenticator enrollment/replacement is available locally with admin-password re-entry and confirmation. The encrypted credential is in `data/security/totp.dpapi.json`; elevation exists only in memory. Settings and allowlists are saved to `data/settings.json` with atomic replacement. Windows file access follows your account/directory ACLs; do not share the folder with untrusted users. Do not port-forward or reverse-proxy this panel. It binds only to 127.0.0.1 and uses a password, expiring HttpOnly/SameSite session cookie, CSRF checks, Host/Origin checks and a restrictive content security policy.

## Optional AI

Fill both OpenAI values, restart, enable `/ask` in the panel, Save and Sync. It uses the [Responses API](https://developers.openai.com/api/docs/quickstart), with storage disabled and an output token cap. Only the entered question is sent; the bot does not read conversation history. Requests may incur OpenAI API charges. Use your project spending controls. AI is a text-only feature; it has no link to moderation or custom-code execution.

## Official references checked for this implementation

- [Application commands and permissions](https://docs.discord.com/developers/interactions/application-commands): guild registration, default member permissions and visibility.
- [Interaction responses](https://docs.discord.com/developers/interactions/receiving-and-responding): defer promptly within the three-second response window; interaction tokens last 15 minutes.
- [Message resource](https://docs.discord.com/developers/resources/message#bulk-delete-messages): bulk delete accepts 2–100 messages and rejects messages older than two weeks.
- [Permissions](https://docs.discord.com/developers/topics/permissions): bot/caller permission checks and role hierarchy.
- [Gateway intents](https://docs.discord.com/developers/events/gateway#gateway-intents): minimal intents for a slash-command bot.
- [Rate limits](https://docs.discord.com/developers/topics/rate-limits): respect server-provided retry timing; use discord.js's shared REST queue.
