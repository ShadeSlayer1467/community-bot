# Consolidation review

## Starting state

The project consolidates useful ideas from several earlier experiments into one maintained Discord bot. Legacy source and its deployment-specific configuration were intentionally kept outside this repository; no historical credentials or private runtime data are part of Community Bot.

## Feature decisions

| Original project | Findings and retained functionality | Removed or replaced |
| --- | --- | --- |
| RageBot modular JavaScript project | Kept the discord.js slash-command/module approach; ping, greeting, user, server, avatar, prune concepts; command reload workflow became the fresh CustomCommand worker | Game-specific integrations/assumptions, duplicate workers, unguarded mass-ban path, hard-coded users/channels, public reload of source modules; the old kick was only a mock and is now a real checked operation |
| EasyDiscordBot | Count-based deletion and recent-time deletion became `/purge count` and optional `minutes` | Prefix parsing, message-content intent, unbounded deletion assumptions and missing caller permission checks |
| Discord ChatGPT | AI questions became optional `/ask`; addition/greeting utilities retained | Retired completion model/API use, hard-coded credentials/user IDs and unsolicited personalized DMs; unrelated Next.js quickstart is no longer active |
| Discord Gamble Bot (FunBug) | Retained status/error logging and channel-topic inspection in the host/panel and `/server` | Hard-coded channel/token and message-edit content logging; this project did not actually implement a wagering engine |
| FunBug tutorial and companion WebAPI | Ping, addition, embeds, random card game (Ace low), role listing, feedback and personal task CRUD retained; persistent local JSON replaces the companion task API | Duplicate C# hosts/registration executable, placeholder demo commands and field settings, unauthenticated task mutations, SQL Server/MySQL migration alternatives and unused web scaffolding |
| Legacy screen/OCR utilities within the game-oriented group | Reviewed as game-specific screenshot/OCR/webhook tooling | Not part of a generic Discord bot; preserved only in the external backup |

Original projects mixed discord.js 12/14, Discord.Net 3.3.2/.NET Framework, Python screenshot tooling, and ASP.NET database experiments. A unified JavaScript project was chosen because the existing modular discord.js implementation already provided the closest command/extension workflow. Small utility behaviors were ported, moderation was corrected, and the C# task/card features were adapted rather than retaining duplicate runtime stacks. No pre-existing runnable test suite was found.

## Important corrections

Secrets and all deployment-specific IDs are blank in the example. No old credential is copied into active source. Complex logic stays in code. Moderation requires a configured allowlist plus Discord permissions, and kick/ban enforce hierarchy. Purge observes bulk-delete age/batch limits. Response commands validate reserved names so none can replace CustomCommand or another built-in.

The admin panel has loopback binding, password login, session/CSRF protection, strict Host/Origin checks and no executable-upload endpoint. Custom code requires a bot DM, the exact configured developer owner ID, and an active five-minute TOTP-authenticated session. Local QR enrollment stores the credential encrypted with Windows DPAPI; elevation is never persisted. A dedicated lifetime-controlled JavaScript worker executes local code; its limitations are documented without describing it as hostile-code isolation.

All active source/configuration/path branding from the game integrations has been removed. Historical references remain only in the external recovery backup. Dependency internals may naturally contain unrelated words or author names; third-party packages were not modified for branding cleanup.
