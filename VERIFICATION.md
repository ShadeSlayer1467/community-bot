# Verification

## Notification bridge update

Agent Channels update: automatic per-source creation/reuse, restart recovery, deleted/moved channels, slug collisions, category permissions and limits are covered by targeted tests. Existing DM history is not modified by channel setup.

The complete suite passes with 65 tests, including authenticated loopback HTTP delivery, rejected credentials and destination overrides, admin/TOTP separation, channel and DM delivery, destination switching, permissions and delivery failures, rate limiting, deduplication, bounded queue, expiry, delivery timeout, credential rotation and redaction. Existing CustomCommand/TOTP tests still pass.

The .NET 8 notification example builds with zero warnings/errors. Both the JavaScript and compiled C# clients were exercised against the actual local HTTP endpoint using temporary credentials and stub Discord delivery (`scripts/notification-client-smoke.js`). The Edge browser smoke test covers notification settings persistence, channel/DM switching, credential masking/clearing, destination error display and configured test delivery. No real notification credential was created and no notification was sent to Discord during these tests.

After starting the bot, choose a real destination in Notifications, enable and save, validate, generate the caller credential, and use Send Test Notification. Confirm the embed arrives and that your Discord mobile preferences permit phone notifications. Repeat after switching delivery mode if both modes will be used. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

## Original v1 checks

Offline validation uses Node.js 24 LTS. Install Node.js 24 LTS or explicitly select another compatible runtime before launching. Dependency installation produced a lockfile; `npm audit` reported zero vulnerabilities at the time of the recorded run.

`npm run check` passed for v1: 31 JavaScript modules checked and all 39 tests passed, with no skips. The build checks syntax and serializes/validates guild and global DM slash-command definitions; there is no transpilation or generated application bundle. `npm test` uses Node's built-in test runner. The targeted tests cover:

- Blank configuration diagnostics and invalid ID/password settings.
- Explicit owner enforcement, wrong-guild/DM rejection, independent moderator and Discord permission checks.
- Both role hierarchies and protected moderation targets.
- Reserved command names, validation, atomic persistence/reload and snapshot isolation.
- Purge pagination, user/pin/age filtering, zero/one/many deletion paths and cancellation.
- Per-user/per-server task access boundaries.
- Slash permission serialization and optional AI request/error behavior through a stub transport.
- Interaction-level non-owner rejection before the custom worker is reached.
- Actual worker hot reload, exceptions, syntax errors, concurrency rejection, CPU-loop timeout and cancellation with pending host operations.
- Actual loopback HTTP login, session protection, Host/Origin/CSRF rejection, logout and settings validation.
- Client recreation after disconnect and application/token mismatch rejection through a stub login (no external connection).
- DM-only developer access; un-elevated owner denial; other-user denial; group/thread/guild/unknown-context rejection even with elevation; single-use execution tickets and no old-signature bypass.
- Real otplib verification, five-minute expiry (including clock rollback), restart with no elevation, replay prevention and concurrent verification rejection.
- Local session-bound enrollment/confirmation/expiry, one-step drift, persistent lockout, fail-closed storage errors and revocation.
- Actual Windows DPAPI encryption/decryption with temporary generated test credentials; no plaintext TOTP secret on disk.

The real-browser smoke test (`scripts/ui-smoke.js`, optional external Playwright installation) exercises the actual panel in headless Edge: local QR enrollment/confirmation, encrypted storage, QR/URI removal from the DOM, revocation, login, response editing/persistence, missing-token diagnostics, responsive layout and logout. It uses only temporary test credentials/data and no Discord token. Screenshots are taken only after clearing the test enrollment QR.

These tests do not prove live Discord connectivity or actions. No real token was used and no live messages, bans or registrations were changed.

## Live checklist after adding credentials

1. Use a test Discord server; install the bot, configure IDs/roles and Connect from the panel. Confirm ready state and server details.
2. Sync, then refresh registered commands. Check `/ping`, `/server`, `/avatar`, `/roles`, `/card` and `/tasks` from your phone.
3. Add a response in the panel, Save and Sync. Invoke it. Disable it and confirm rejection even before resync. Re-enable or remove it and sync again.
4. Verify an unlisted user cannot moderate, and a non-owner administrator cannot invoke CustomCommand. Verify a configured moderator missing Manage Messages is denied; remove the bot's permission and verify its error too.
5. In a disposable test channel, create fresh messages and a pinned message. Run `/purge count:50`, then a user/time-filtered purge. Confirm actual deletion count and preservation of pinned/old messages.
6. With a disposable test account, verify kick/ban success below both hierarchies, and denial for equal/higher roles and the server owner.
7. Set customOwnerId, restart and sync. Enroll Google Authenticator locally. In a bot DM, confirm CustomCommand is denied before authentication; run `/owner-auth` with a fresh code and then invoke the harmless example. Edit its return value and invoke again without restarting. Verify the same code is rejected if reused. Confirm it cannot execute in a guild/thread/group or under a different account, even an administrator. Test the optional target IDs in a disposable server.
8. Wait five minutes or run `/owner-lock` and confirm execution is denied. Authenticate with a new code. Disconnect/reconnect or restart the process and confirm elevation is gone while enrollment/settings/tasks remain. A fresh code must authenticate again. Test local revocation and harmless worker cancellation too.
9. If using AI, fill the optional key/model, enable and sync `/ask`, verify authorized access, and check provider billing/rate-limit behavior.

Startup retry and scope-validated command registration removal are also tested. Windows sign-in startup is provided by Enable-Startup.ps1; automatic Discord connection was verified live after restarting the bot.

Remaining limits: the PC must stay awake and running; startup requires Windows sign-in, not a background Windows service before login. The admin panel is local only. Custom code is trusted host-side JavaScript, not a secure container. Purge is a bounded current-channel operation, not complete server-wide history erasure. JSON storage is intended for one host process, not multiple replicas. Existing legacy SQL task data is preserved in the backup but not automatically imported.
