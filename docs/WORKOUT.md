# Workout module

Workout is a first-party Community Bot module in the same application and Discord client. It has its own service, persistence, progression engine, admin API adapter, Discord interaction handler and browser controller. No workout credentials, database server, second bot, food features or historical message importer are introduced.

## Start using it

1. Open the local admin, sign in, and choose **Workout → Exercises**. Select your Discord user ID if it is not filled automatically. The personal library starts with 404 editable starter exercises. Search by name/alias and filter by category, equipment or Active/Archived/All; results are paginated. Create each meaningful variation separately. Name/variation/notes can preserve cable positions, grip, unilateral work and machine settings.
2. Starter defaults use neutral 1-set/1-rep placeholders and manual progression, not a recommended prescription. Enter your program target sets, minimum/maximum reps, resistance type and units. Loaded starters require Change Weight before logging; no current working load is invented. Configure an increment or ordered available loads; for bodyweight progressions, create distinct exercises first, create an ordered chain, and assign that chain to exercise defaults or a program prescription.
3. In **Programs**, create a program and one or more named planned workouts. Add exercises, edit each prescription, use Move up/down to set order, and save. Choose a planned workout as next. The selected next program/workout is shown by name. Use Set as Next; no internal IDs need copying.
4. In **Workout Settings**, check allowed Discord user IDs (initially the configured owners) and the default unit. Existing resistance is never converted when the default unit changes.
5. Connect the bot and **Sync commands to Discord** from Commands. Workout is registered in configured servers, with a separate DM-only global registration so server command lists have one copy. Open your chosen server channel on your phone; the bot needs View Channel, Send Messages and Embed Links there. Developer commands retain their separate DM-only protection.
6. Use `/workout today`: a saved next workout opens immediately; otherwise a single active program/template is automatic and multiple choices use named menus. Select the program/workout when asked, review the plan, then press **Start Workout**. **Choose Different Workout** reopens selection safely. `/workout start` starts a resolved plan or shows the same menus when a choice is needed. For an unplanned workout use `/workout start free:true` and Add Exercise. This opens a name/alias search modal (for example bench, RDL or BW squat), then a matching exercise menu. Empty search browses all active exercises; Search again changes the query. `/workout resume` recovers an active workout after restart or a stale message. `/workout history` shows five concise recent completed sessions.

## Starter catalog

`src/workout/starter-catalog.json` is versioned seed data. `starter.js` creates user-specific deterministic IDs. The persistent `starter-seeds.json` ledger records every processed starter name, including matches to existing user exercises. Seeding atomically merges only missing base names/aliases; user records and variations remain authoritative. Archived or deleted starters are never recreated on restart. Future catalog additions are processed once, without changing existing IDs, exercises, program definitions or session/history snapshots. Each allowed user is initialized at startup; newly selected users are initialized on first library access. Keep the ledger with your Workout backups. No global database, historical import or automatic progression chains are introduced.

## Data and architecture

`src/workout/model.js` defines validation and schema version 1. `repository.js` uses the existing atomic `Store`. `service.js` is the shared source of truth for both interfaces. `progression.js` is a pure deterministic recommendation engine. `discord.js` owns slash definitions, embeds, buttons, selection menus and modals. `admin.js` dispatches module APIs only after the central server has enforced its authentication/CSRF/Origin rules. `public/modules/workout-controls.js` owns the browser editors and views.

Records are distinct:

- **Exercise:** stable ID, user ID, name, aliases, variation, equipment/category, notes, active flag, default prescription and catalog revision. No automatic equivalence between similarly named exercises.
- **Program:** stable ID, owner user ID, name, active flag, revision, and ordered planned-workout templates. Templates have stable IDs, names and ordered slots. Slots have stable IDs, exercise ID, sets, rep range, resistance, progression rule and note.
- **Workout Session:** independent UUID, user ID, planned/free mode, active/completed/abandoned state, start/end timestamps, notes/uncertainty, current exercise index, source program/template/revision, revision counter and a durable Discord message reference. One active session per user.
- **Workout Exercise:** independent ID, exercise ID, snapshotted name/variation/notes and prescription, working resistance, skip/uncertainty flags, notes, previous completed performance, and ordered actual sets. Program/library edits do not rewrite an active plan or old history.
- **Set:** stable ID and order within its session exercise, actual resistance, reps, type, note, uncertainty, optional RPE/RIR and log/edit timestamps. The containing session/exercise provides association. Reps must be positive integers.
- **Progression Rule:** double, chain or manual, numeric increment, optional ordered available loads and chain ID. A chain is an independently versioned ordered list of distinct exercise IDs. Chain context needed by a planned session is snapshotted at start.
- **Recommendation/decision:** per-session-exercise outcome, explanation and optional next exercise/resistance. Decisions record accept/keep/manual, before/after values, timestamp and validity. Historical corrections retain an audit record.

Catalogs live in `data/workout/exercises.json`, `programs.json`, `chains.json`, and `preferences.json`. Each session is a separate `sessions/<uuid>.json`. All files are versioned and atomically replaced. A durable `transaction.json` intent journal makes changes across the program and session recoverable after a crash. Startup replays a pending intent before exposing state. Unknown schema versions fail clearly rather than being guessed or overwritten. JSON storage supports one host process; do not run multiple replicas against the same directory.

A future importer can create validated records with stable IDs, original timestamps, exact resistance representations, notes and uncertainty flags. No historical Discord messages are read or reinterpreted here.

## Resistance

Resistance is `{kind, value, unit, display}` on each prescription and actual set. Supported kinds: total, pair/two implements, per-side, stack, bodyweight, added bodyweight load, bodyweight assistance, none, custom. Pair values are per implement: `2x135` remains **2 × 135**, never 135 total. Per-side values stay per-side. Assistance progresses by reducing assistance. Bodyweight and no-external-resistance values use zero numeric external load; added/assisted kinds represent adjustments. Custom labels remain manual.

The Discord Change Weight field accepts `235 lb`, `2x135`, `total:235`, `per-side:45`, `stack:30`, `BW`, `added:10`, `assisted:20`, `none`, or `custom:manual label`; append lb/kg to numeric forms when needed. Units inherit the working load if omitted. Parsing is explicit and rejects unrecognized/negative/excessive loads rather than guessing.

## Fast Discord workflow

Workout interactions require a configured server or this bot’s DM, plus an explicitly allowed user ID. Server messages are visible to people who can read the channel; only the session owner can use its controls. Unconfigured servers and other users are rejected. Workout does not require or grant developer/TOTP elevation. Each interaction resolves the session by user ID, checks the latest revision and source message, and persists changes before refreshing the embed. Source Discord message IDs locate the UI; session UUIDs identify the records.

Log Set asks only for reps and uses the current working resistance. That resistance carries forward. Change Weight changes the following sets. Repeat Last opens a reps field prefilled from the last set and reuses that set’s resistance. Edit Last and Edit Earlier correct mistakes; Log Details adds set type, notes or an uncertainty flag without burdening normal logging. Exercise notes and uncertainty have their own modal. The admin also supports session-level notes/uncertainty and optional RPE/RIR.

Previous/Next navigation is safe and does not imply completion or skip. Add Exercise adds an unplanned slot, even to a planned session. Skip, Delete Set, Finish and Abandon first show confirmation with Keep Training. Confirmation tokens are short-lived, user/session/action/target/revision bound, single use and invalid after state changes or restart. There is no Dismiss or Close button. Abandon preserves the record; it does not erase data.

The active channel/DM message updates in place. `/workout resume` edits the saved message or creates a replacement if it cannot be fetched; old controls then fail source checks. Requests have persisted IDs and revisions to prevent duplicate sets or stale overwrites. A failed Discord update can be recovered with resume; saved performance remains authoritative. Slash start/resume has a small acknowledgement in addition to the durable workout message; normal set logging does not create a new message.

## Progression rules

Only normal and AMRAP working sets count toward mastering the prescription. Warmups, dropsets and partials remain visible in history but do not establish progression.

1. Set/exercise/session uncertainty produces **QUESTIONABLE**, with no automatic proposal.
2. Free/unplanned exercise slots receive **MAINTAIN** with an explicit unplanned explanation, not a failed-prescription judgment.
3. Skipped/incomplete prescriptions maintain and explain the missing working sets.
4. Mixed resistance versus the plan produces **REVIEW**; it is not silently normalized into a single load.
5. All prescribed working sets reaching the maximum, with any additional working sets still meeting the minimum, produce **PROGRESS**.
6. All prescribed sets below minimum, or a majority below minimum with average reps below 75% of minimum, produce **REVIEW**. One late fatigue drop alone does not force regression.
7. Other results **MAINTAIN** and encourage building toward the top of the range.

For 3 × 8–12, 12/10/8 and 12/10/7 maintain; 5/4/3 reviews; 12/12/12 progresses. For 3 × 6–10, 8/6/6 maintains and 10/10/10 earns progression.

Weighted progression proposes the configured increment in the stored representation or the next configured available load. Assistance proposes less assistance. Ordered chains propose the next configured active variation and its default resistance. Manual/bodyweight/custom difficulty without a configured next step explains that the next difficulty needs manual selection. No next load/variation is invented.

**Accept Progression**, **Keep Current** and **Set Manually** are explicit decisions. Accept changes a future program slot only when the current prescription still matches the session plan and catalog revisions are reviewed. Discord acceptance rejects unrelated program edits since the session began; review those in admin. The browser shows the current prescription/revision before confirming. Manual changes may choose another active exercise in admin or another load in Discord. Free/added slots have no permanent program prescription to update.

Historical corrections recalculate recommendations and invalidate previous decisions. Already-applied program changes are deliberately retained and displayed for manual review, avoiding a silent rollback of subsequent training choices. Notes/uncertainty can be corrected at set, exercise or session scope.

## Browser views

- **Overview:** active session, selected next workout, most recent workout, recent recommendations, and planned/free starts.
- **Programs:** multiple programs/templates, active flags, names, ordered exercises, prescriptions/rules/notes and next-plan selection.
- **Exercises:** create/edit/archive exercises, aliases, defaults, settings metadata and ordered progression-chain editor. Archiving preserves all history.
- **History:** recent sessions, session detail, exercise filter, actual-rep timeline with exact resistance labels, planned versus actual sets, notes, decisions and confirmed corrections.
- **Progression:** explanations and accept/keep/manual decisions across completed sessions.
- **Active:** quick reps logging, repeats, load changes, navigation, set edits/deletion, notes/uncertainty and confirmed finish/abandon.
- **Settings:** module-specific allowed users and default units.

Routes are `/workout` and `/workout/{programs,exercises,history,progression,active,settings}`. They share the existing shell and authenticated deep-link behavior. Home gets the optional summary export from the Workout module; it has no workout editor logic. Selection menus use internal IDs only in option values/custom IDs, are user/channel-bound and expire after ten minutes or restart. Edited/removed programs or templates reject stale selections/previews and ask you to choose/review again. Selecting next only changes your preference; active sessions, history and program definitions stay intact.

Workout state refresh is explicit. Browser edits to an active session make an older Discord embed stale until resume. Unsaved Workout editor changes should be saved before changing subpages or users.

## Limits and verification

There is no automatic calendar/scheduling philosophy, program cycling, exercise equivalence inference, nutrition, historical importer, external database or live health advice. Select the next workout explicitly.

Catalog limits: 30 templates per program, 50 exercise slots per template/session, 100 actual sets per exercise, 30 variations per chain. Discord displays concise previews/summary fields (first five exercises); full sessions remain in admin. Exercise selection is paginated in groups of 25. Discord earlier-set menus show the last 25 sets; admin edits all sets. Recommendations use paginated pending menu options and can also be reviewed in admin. These bounds respect Discord message/component limits. See the [official interaction guide](https://discord.com/developers/docs/interactions/receiving-and-responding) for the underlying message-update/modal mechanisms.

The final build checked 67 JavaScript modules; the full suite passed all 101 tests without skips. The expanded Edge smoke and JavaScript/C# notification-client smoke passed, with no browser page errors or live Discord sends.

Offline tests cover catalogs/order/revisions, snapshots, restart persistence, carry-forward, corrections, confirmed destructive actions, planned/free work, previous lookup, weighted/chain progression, decisions, uncertainty, recovery journaling, user isolation, Discord interactions/sync and authenticated APIs/routes. The Edge smoke test uses real browser forms with temporary data and stub Discord delivery and checks all Workout subpages at 390px width. Run `npm run check` with Node 22.12+; run `scripts/ui-smoke.js` with `PLAYWRIGHT_MODULE` configured. No real credentials or live messages are needed for these tests.

## Phone live checklist

Use a disposable test program/session before relying on this during training.

1. Sync commands and open the chosen configured server channel on your phone. Confirm an unlisted account cannot use Workout and that CustomCommand still requires its separate owner/TOTP flow.
2. Run `/workout today`; review the plan and previous performance. Start the planned workout.
3. Log several sets by entering only reps. Confirm the same message updates and the resistance carries forward.
4. Change resistance, including a pair/stack example, and verify later sets use the exact representation.
5. Edit the last set and an earlier set; add a note/uncertainty flag. Delete a test set only after confirmation, and verify Keep Training cancels safely.
6. Navigate exercises and add an unplanned exercise. Confirm Previous/Next cannot discard the session and Skip requires confirmation.
7. Finish with confirmation; verify duration, sets and recommendation reasons in the summary. No Dismiss button should exist.
8. Accept a progression for a mastered exercise, Keep Current on another, and test manual load selection. Verify only future prescriptions change.
9. Start a new test workout, log a set, restart the bot, then resume. Confirm the load, sets and current exercise survived and the source message is recovered.
10. Inspect history on phone/desktop afterward; verify archived variations and old prescriptions remain intact.
11. Start a free workout, log mixed loads and finish. Confirm unplanned work is not judged against a fixed prescription. Review a historical correction and its explicit decision-invalidation behavior.

Live Discord command propagation, phone modal ergonomics and reconnect/message recovery still require this credentialed checklist; offline tests do not claim those live steps happened.
