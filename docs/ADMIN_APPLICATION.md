# Admin application architecture

Community Bot remains one process and one Discord application. The local admin uses native browser ES modules with no frontend build or plugin framework.

`src/admin/public/registry.js` declares first-party page IDs, names, routes and descriptions. The server uses this same registry to allow exact page routes. `shell.js` builds primary navigation, mounts page templates once, switches the current page with browser history, sets the title and active link, and renders optional module dashboard contributions. Forms retain drafts during navigation. Pages share the existing panel, form, button, toast and responsive CSS.

Home (`/`) is the default landing page. Module files in `public/modules/` export a template and may export `summary(state)`. Home renders those summaries as text and links without knowing their internals. The state comes from the authenticated existing state API, with application uptime added. Recent activity is the latest five actual log events. No sample statistics are shown.

## Page ownership

- Notifications: destination, enablement, rate/queue/deduplication, credential rotation, validation, test delivery and recent results. Its controller lives in `notification-controls.js`.
- Commands: built-in switches, response editing/access, moderator allowlists and Discord registrations. Its controller lives in `command-controls.js`.
- CustomCommand: timeout/cancellation, owner status, enrollment, revocation and usage guidance. Its authenticator controller lives in `custom-controls.js`. Enrollment material is temporary; the stored authenticator secret is never returned. Navigating away clears displayed enrollment material and notification credentials.
- Logs: recent application logs and refresh.
- Settings: global Discord connection controls, server state and guidance for global configuration. Credentials, owner IDs, admin password, local port and startup configuration remain host-file configuration requiring restart.
- Workout: implemented first-party training module with its own child routes, service, APIs, catalogs, session persistence and Discord interactions. See [Workout](WORKOUT.md). Kingshot remains an unimplemented placeholder. There is no food page.

Command and execution forms save only their own changes into the existing settings payload; the API contract stays compatible. Module settings are not duplicated in global Settings. The old control-room page has been removed.

## Adding a first-party module

1. Add its ID, name, route and description to `registry.js`.
2. Create `modules/<id>.js` exporting `template` and optionally `summary(state)` returning concise text. Use existing shared CSS and unique element IDs.
3. For interactive controls, add a small module controller initialized by `app.js` with the shared transport/status helpers. Allowlist its static filename in the server assets list. The shell needs no feature-specific branch.
4. Add necessary authenticated APIs/state to the same application, then targeted API and browser checks. The registry does not grant API authorization.

## Routing and security

The root serves the login shell. Unauthenticated module URLs redirect to login with their intended destination; authenticated refreshes serve the same shell and restore the session through `/api/session`, which returns the existing session's CSRF token. Browser navigation/back/forward needs no reload. Unknown server routes return 404.

Local-address, Host/Origin validation, same-site cookies, login throttling, CSRF checks, CSP and no-store headers are retained. Notification callers remain isolated from admin sessions. Discord CustomCommand still requires the exact configured owner, bot DM and TOTP elevation; no Discord authorization code changed.

## Verification

Run `npm run check` with Node 22.12 or newer. The admin test checks every registered route before/after authentication, static module availability, session restoration and unknown routes alongside existing CSRF/Origin/TOTP checks.

Run `scripts/ui-smoke.js` with `PLAYWRIGHT_MODULE` pointing at an installed Playwright package. Headless Edge exercises Home, all page navigation and active links, authenticated deep refresh, redirected login, browser back, logout, temporary authenticator enrollment/revocation, response-command persistence, notification credential clearing, destination errors, DM/guild/agent settings and stub test deliveries. Every page is checked at 390px width for horizontal overflow. No live Discord sends or production configuration changes are involved.

Dashboard state refresh is manual; there is no polling or persistent activity database. The existing global settings API remains a complete-payload API, so simultaneous edits from multiple admin tabs are not conflict-resolved. Live Discord registration/delivery depends on a configured connection and was verified with existing tests/stubs, not a live account.
