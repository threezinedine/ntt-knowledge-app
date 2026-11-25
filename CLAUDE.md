# Knowledge Manager: working agreement

Local-first personal knowledge graph. Property-graph model: **nodes** (type/label,
title, markdown content, JSON props, canvas position) connected by **named, directed
edges** (also with JSON props). One shared **tag tree** attaches many-to-many to nodes
(`node_tags`, tombstoned like everything else). Each tag is a **field** of knowledge
with EXP and a level, derived on read from the nodes tagged with it or a descendant
(`packages/core/src/exp.ts`, `GET /api/exp`). A node's EXP = base + capped word bonus +
capped 5 Whys bonus (answered whys only, doubling per depth level: the user's choice).
The level table is a JSON file on the hub (`KM_LEVEL_CONFIG`, default
`level-config.json` next to the DB): the operator edits it and restarts; devices fetch
it (`GET /api/hub/config`) at connect and pull. No UI to change it. Tasks were
removed (migration 4 tombstones them; the `tasks` / `task_tags` tables stay, as
migrations are append-only).

## Starting on another machine / a fresh session

This file is the **only** context that travels between machines: Claude's auto-memory
lives in `~/.claude/` on each PC and is not in git. Anything a later session must know
(user preferences, scope decisions, "don't do X") goes **here**, not only in memory.

Repo: `git@github.com:threezinedine/ntt-knowlege-app.git`, single branch `master`.
Before working: `git pull --rebase`. When done (and `npm run check` is green): commit
on `master` and push; the user asks for this. Commit style: `[feature] …` / `[fix] …`,
lower-case summary, e.g. `[fix] sync review fixes: …`.

Setup on a new PC:

1. Node ≥ 24, then `npm install` (and `npx playwright install chromium` for e2e).
2. `.env` is gitignored. Only the hub needs it (the TOTP secret for pairing). Run
   `npm run auth:setup` for a dev hub, or `KM_AUTH=off` in `.env`. Never commit it.
3. Optional: `level-config.json` (gitignored) from `level-config.example.json`, placed
   next to the DB; without it the built-in defaults apply.
4. Data is **per device** (in the browser's OPFS, per origin and profile). To get the
   user's graph on a new PC: open their hub in the browser, Sync → connect → Pull.
5. Not in git and not needed: `.vscode/` (the user's own), `node_modules`,
   `playwright-report/`, `test-results/`.

Windows-only notes below (Git Bash vitest quirk, Android `JAVA_HOME` paths) don't apply
on Linux/macOS; there `npm run check` works from any shell.

Product decisions already made (don't re-ask): the phone app only views graph and nodes
(see Pairing, secrets and read-only); the 3D graph is parked; tasks are gone. Spaced repetition
exists (`@km/core` review.ts, its own activity-bar tab `/review`, `features/review/`), the user's design: shallow
nodes (answered whys < 3 or depth < 3) get a "dig deeper" card, lowest node EXP first;
two random well-dug, unlinked nodes get a "link these?" card; at most 6 dig + 2 link cards a day (answers use the quota up,
no refill until tomorrow; unanswered ones carry over first, kept in device_settings
`reviewDeck`, not synced); Done / Again buttons, fixed
steps 1, 3, 7, 14, 30, 60, 120 days; progress synced; desktop only (not on the phone).
The graph's tag colours (graph settings) are experimental: only top-level tags pick a
colour, nested tags get paler shades, big dots stand out.

Architecture and sync (the user's design, don't re-ask): like git + GitHub. **One
server, the hub** (LAN or WAN) hosts the web app and keeps numbered **versions of the
whole graph** (SHA-256 hash, device, time; `KM_HUB_KEEP_VERSIONS`). **Each device
(browser, phone app) keeps its own copy and does all processing locally**; the hub
never edits data. **Manual** Push / Pull, **no merging**: whoever pushes last wins,
older versions stay in the history. Others only see changes after a push, and only get
them by pulling. Overwriting either side always asks first (push over a hub version not
pulled; pull over unpushed changes). When the hub has a newer version and the user
edits, warn **once** per version, then let them edit. Offline: say so in the title bar
(especially on the phone), never block. Durability: the copy lives in OPFS (persistent
storage requested), optionally mirrored to a file the user picks on disk (Chrome/Edge),
and closing with unpushed changes asks first. Dropped by the user: QR codes /
device-to-device copy, **Backup Now** and restore (the hub's versions are the shared
history). No browser sign-in any more: only pairing a device takes the TOTP code.

Docs (English): `README.md` describes the product's features for a reader (no install
steps, plain wording, no hype); `INSTALL.md` holds setup, configuration, the hub and the
Android build. A user-visible feature change updates the README; a new env var, command
or setup step updates INSTALL.md.

## Layout

- `packages/core`: zod schemas, shared types, pure domain logic (tag tree, cycle
  check, EXP, sync types). No I/O. Everything imports it as TS source.
- `packages/engine`: the graph's storage and logic over **any SQLite** with
  node:sqlite's shape (`database.ts` `Database` interface): migrations, transaction
  helper, `repositories/` (all graph SQL lives here), snapshots (canonical JSON +
  pure-JS `sha256.ts`), the device side of sync (`sync/`: `HubClient` maps hub errors to
  502 + reason, never 401), markdown export, and `localApi.ts`: the app's whole API
  (`/nodes`, `/edges`, `/tags`, `/whys`, `/exp`, `/graph`, `/sync/*`, ...) answered
  in-process. Errors: throw `AppError` subclasses; `toErrorResponse` maps them to
  `ApiErrorBody`. No `node:` imports outside tests (`testing/` uses node:sqlite).
- `apps/server`: the **hub** only. Fastify + `node:sqlite` (Node ≥ 24, no native deps).
  `http/routes/hubRoutes.ts` (pair, head, latest, versions, devices/self, config;
  bearer device tokens, its own deny-by-default hook on the matched route),
  `repositories/hubRepository.ts` (devices, versions), `seed.ts` (an old server's
  graph tables become version 1 once), static web app. The graph tables still exist in
  the hub's DB (shared migrations) but nothing writes them after seeding.
- `apps/web`: React + TanStack Query + React Flow + CodeMirror, installable PWA.
  `api/client.ts` → `local/engine.ts` (page side) → `local/worker.ts` (a Worker running
  `@km/engine` over SQLite WebAssembly, `@sqlite.org/sqlite-wasm`, OPFS SAH pool, one
  tab at a time; `wasmDatabase.ts` adapts it to node:sqlite's shape; hub requests go
  out through the page so the phone's native HTTP is used) → `api/queries.ts` (hooks +
  query keys) → `features/*`. `features/local/` = start-up gate (busy / memory-only
  states), file on disk, markdown export; `features/sync/` = dialog, title-bar
  indicator, edit warning. VS Code-style shell (`App.tsx`, icons in
  `components/icons.tsx`). The 3D graph (`features/graph/Graph3D.tsx`) is
  **experimental**: parked, not feature-complete.
- `apps/mobile`: Capacitor 8 Android app. Ships the built web app (`webDir:
../web/dist`; `mobile:sync` builds it first); the same engine runs **read-only**
  (pull-only device, own OPFS pool `km-phone`). `CapacitorHttp` is on, so hub requests
  skip CORS and mixed-content blocking. `android/` is generated by `cap add android`;
  the only hand edit is `AndroidManifest.xml` (`usesCleartextTraffic`,
  `allowBackup=false`). Lint and Prettier ignore `apps/mobile/android`. Not in Docker.
  Gradle wrapper is pinned to **9.1.0** (Capacitor's 8.14.3 can't run on Android
  Studio's bundled JDK 25); re-check it after `cap` upgrades. CLI build (PowerShell):
  `$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`,
  `$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"`, then in `apps/mobile/android`:
  `.\gradlew.bat assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
- `e2e/`: Playwright, desktop Chrome + Pixel 7 profile, against a hub on an in-memory
  DB. Every test gets a fresh browser context, so its local data starts empty. Test
  data goes through the page's own engine (`window.__kmEngine`, `Api` in fixtures.ts);
  the `page` fixture swaps `page.request` so `/api/...` reaches the engine and
  `/api/hub/*` the server. Hub versions accumulate across tests: never assume version
  numbers. Phone specs use `phoneWithCopy`.
- A new synced table must join `snapshotRowSchemas` (`@km/core` sync.ts). A purely
  additive table goes in `OPTIONAL_TABLES` (left out of the JSON while empty, so older
  versions keep their hash; the user chose this over bumping); changing an existing
  table's columns still bumps `SNAPSHOT_FORMAT`. An old phone APK can't read a snapshot
  with a new table's rows: rebuild it.

## Commands

```sh
npm run dev         # hub :4317 + vite :5173 (proxy /api)
npm run auth:setup  # TOTP secret → .env + QR in the terminal (--show / --new)
npm run mobile:sync # builds the web app and copies it into the Android project
npm run mobile:open # Android Studio (Run ▶); mobile:run deploys with the SDK on PATH
npm run check       # typecheck + lint + prettier + unit/API tests (must pass before "done")
npm run test:e2e    # builds web, starts a hub, runs Playwright
npm run hub:devices # list / revoke (-- --revoke <n>) devices paired with the hub
npm run build && npm start   # production: the hub serves apps/web/dist on :4317
npm run docker:up   # same production setup in one container (compose.yaml), data in a named volume
```

CI: `.github/workflows/test.yml` (GitHub Actions) runs `npm run check` and `npm run test:e2e`
on push to `master` and on PRs. A deploy workflow is not set up yet (the user parked it).

Shell quirk on this Windows machine: vitest fails under Git Bash ("failed to find the
runner"); run `npm run check` / tests from PowerShell. Prettier flags the user's own
untracked `.vscode/settings.json`: leave it alone (don't format or commit it).

Docker image: multi-stage `Dockerfile` (build web → runtime with server prod deps only,
runs as `node`, healthcheck on `/api/health`). Any runtime import in `apps/server` must be
a `dependencies` entry of `@km/server`, `@km/core` or `@km/engine`, or the image breaks.

## Pairing, secrets and read-only

- Pairing a device with the hub takes a 6-digit **TOTP** code (Google Authenticator),
  the only factor, single owner; then the device holds a bearer token (the hub keeps
  its SHA-256 in `hub_devices`; `devices/self` DELETE and `hub:devices --revoke`
  tombstone it). `KM_AUTH=totp|off` (default `totp`): the server refuses to start with
  `totp` but no valid `KM_TOTP_SECRET`. Secrets live in the repo-root `.env`
  (gitignored; `.env.example` is the template). `apps/server/src/envFile.ts` loads it
  and **never overrides** variables already set (the e2e config pins `KM_AUTH=off`).
- Hub auth is **deny-by-default on the matched route** (`request.routeOptions.url`),
  never a string check on `request.url` (the router percent-decodes, so `/%61pi/...`
  dodged that once). Only `/api/hub/pair` and `/api/hub/config` are public.
- `auth/loginGuard.ts`: codes work once (`CODE_USED`); wrong codes are rationed
  (5 in a row → 1 min pause, 10 per rolling 24 h, not reset by a success; in memory,
  a restart clears it); an empty code never counts. Keep the ~1%/year guess odds
  documented in INSTALL.md if this changes.
- Device-local, never synced: `sync_state` (the device's hub link and token),
  `device_settings` (the hub's level table), and on the hub `hub_devices`. The old
  `sessions` table (browser sign-in) is unused.
- Read-only = the phone app (`isNativeApp()`): its engine refuses writes except sync's
  own (connect, pull, disconnect) and pairs pull-only. `features/readOnly.ts`
  (`useReadOnly()`) hides every editing control, and `NodeView` replaces the editor. A
  new editing control must check `useReadOnly()`. The phone only **views** the graph
  and nodes: feature panels (5 Whys, Link check, anything new) mount only in
  `NodePage`'s editable branch, never in `NodeView`, unless the user asks for one
  there. Asked for so far: the graph's **display**
  settings, on their own activity-bar tab (`/graph-settings`), never over the phone's
  graph view; and **Sync** (pull only), from the title bar.
- Graph settings (`features/graph/graphSettings.ts`): per-device look of the 2D graph,
  the forces and the push-on-drag, in localStorage, clamped on read; never synced.
- Auto layout (`features/graph/forceLayout.ts`, d3-force; the user wanted Obsidian's
  self-arranging graph): on by default; positions come from the simulation and are
  **not saved** (a moving layout would always look like an unpushed change). With it
  off, the old hand layout applies (saved positions, push-on-drag). e2e specs turn it
  off by default in the `page` fixture; `forces.spec.ts` turns it on.

## Rules

- **Validate at the boundary** with schemas from `@km/core` (`strictObject`, so unknown
  keys are 400s). Never redeclare an API type in web or server.
- **Data is sync-ready**: UUIDv7 ids, every write bumps `updated_at`, deletes are
  tombstones (`deleted_at`), and every read filters `deleted_at IS NULL`.
- **Migrations are append-only.** Never edit an entry in `migrations.ts` once _any_
  database has run it, the user's dev DB (`~/.knowledge-manager/km.sqlite`) included,
  even if it was never committed. Rewriting migration 6 broke sign-in; 7 repairs it.
- PATCH semantics: `undefined` = leave as is, `null` = clear.
- Multi-statement writes go through `transaction(db, fn)`.
- Web: no `fetch` outside `api/client.ts` and `local/engine.ts` (the engine's hub
  requests); mutations invalidate via the `keys` factory.
- Web i18n: no user-visible literal strings in components (text, `aria-label`, `placeholder`,
  `title`). Add the key to `i18n/locales/en.json` **and** `vi.json`, use `useI18n().t`/`tx`.
  Show errors with `errorText(err)`, never the raw server message. API errors that need a
  specific message get an `ApiErrorReason` (`@km/core`) instead of client-side string matching.
  Add new codes/reasons to `API_ERROR_CODES` / `API_ERROR_REASONS` plus `error.code.*` /
  `error.reason.*` keys (a unit test checks every one has a message).
  E2E runs with `locale: en-US`; English labels in specs are intentional.
- Web commands (VS Code style, `src/commands/`): every user action worth a shortcut is a
  `CommandSpec` in `catalog.ts` (id, i18n title/category, default `keys` with `Mod`), and
  the component that can perform it registers it with `useCommandHandler`. The palette only
  lists commands that currently have a handler. Defaults must not conflict (unit-tested).
- Tests: every new local API route gets tests via the engine's `createTestApp`
  (`@km/engine/testing`); hub routes via the server's `createTestApp` (`app.inject`);
  every user-facing flow gets an e2e spec using role/label locators, not CSS, where
  possible.

## Implementer ↔ Critic loop

There is a dedicated reviewer agent: `.claude/agents/critic.md`. After any
non-trivial change:

1. Implement and get `npm run check` (and e2e if UI changed) green.
2. Ask the **critic** subagent to review the change.
3. For each finding: fix it, or rebut it with evidence. "I disagree" is not a rebuttal.
4. Repeat until the critic returns `APPROVE WITH NITS` or only contested items remain;
   report contested items to the user so they can decide.
