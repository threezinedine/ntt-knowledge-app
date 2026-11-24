# Knowledge Manager: working agreement

Local-first personal knowledge graph. Property-graph model: **nodes** (type/label,
title, markdown content, JSON props, canvas position) connected by **named, directed
edges** (also with JSON props). One shared **tag tree** attaches many-to-many to nodes
(`node_tags`, tombstoned like everything else). Each tag is a **field** of knowledge
with EXP and a level, derived on read from the nodes tagged with it or a descendant
(`packages/core/src/exp.ts`, `GET /api/exp`). A node's EXP = base + capped word bonus +
capped 5 Whys bonus (answered whys only, doubling per depth level: the user's choice). The level table is a server-side JSON
file (`KM_LEVEL_CONFIG`, default `level-config.json` next to the DB): the operator
edits it and restarts; there is deliberately no API or UI to change it. Tasks were
removed (migration 4 tombstones them; the `tasks` / `task_tags` tables stay, as
migrations are append-only).

## Starting on another machine / a fresh session

This file is the **only** context that travels between machines: Claude's auto-memory
lives in `~/.claude/` on each PC and is not in git. Anything a later session must know
(user preferences, scope decisions, "don't do X") goes **here**, not only in memory.

Repo: `git@github.com:threezinedine/ntt-knowlege-app.git`, single branch `master`.
Before working: `git pull --rebase`. When done (and `npm run check` is green): commit
on `master` and push; the user asks for this. Commit style: `[feature] …` / `[fix] …`,
lower-case summary, e.g. `[fix] backup review fixes: …`.

Setup on a new PC:

1. Node ≥ 24, then `npm install` (and `npx playwright install chromium` for e2e).
2. `.env` is gitignored. Either copy it from the main PC over a private channel (same
   TOTP secret, same authenticator entry), or run `npm run auth:setup` for a **new**
   secret (a separate authenticator entry for this machine's server). Never commit it.
   For throwaway dev, `KM_AUTH=off` in `.env` is fine.
3. Optional: `level-config.json` (gitignored) from `level-config.example.json`, placed
   next to the DB; without it the built-in defaults apply.
4. Data is **per machine** (`~/.knowledge-manager/km.sqlite`). To carry the graph
   over: **Sync** (connect to the user's hub, then Pull), or **Backup Now** on the old
   PC, copy the `km-*.sqlite` into the new PC's backup dir, `npm run backup:restore`.
5. Not in git and not needed: `.vscode/` (the user's own), `node_modules`,
   `playwright-report/`, `test-results/`.

Windows-only notes below (Git Bash vitest quirk, Android `JAVA_HOME` paths) don't apply
on Linux/macOS; there `npm run check` works from any shell.

Product decisions already made (don't re-ask): the phone app only views graph and nodes
(see Sign-in → Read-only); the 3D graph is parked; tasks are gone; spaced repetition
(maybe on the phone) is a later idea, not started.

Sync (the user's design, don't re-ask): a **hub** (any server with `KM_HUB=on`, LAN or
WAN) keeps numbered **versions of the whole graph**, each with a SHA-256 hash; every
device keeps only its current copy. **Manual** Push / Pull, **no merging**: whoever
pushes last wins, older versions stay in the hub's history (`KM_HUB_KEEP_VERSIONS`).
Overwriting the other side always asks first (push over a hub version not pulled;
pull over local changes, which backs up first). When the hub has a newer version
and the user edits, warn **once** per version, then let them edit. Offline: just
say so in the title bar (especially on the phone), never block editing. No QR code
or device-to-device copy (dropped by the user).

Docs (English): `README.md` describes the product's features for a reader (no install
steps, plain wording, no hype); `INSTALL.md` holds setup, configuration, backups and the
Android build. A user-visible feature change updates the README; a new env var, command
or setup step updates INSTALL.md.

## Layout

- `packages/core`: zod schemas, shared types, pure domain logic (tag tree, cycle
  check). No I/O. Both server and web import it as TS source.
- `apps/server`: Fastify + `node:sqlite` (Node ≥ 24, no native deps).
  `db/` (migrations, transaction helper) → `repositories/` (all SQL lives here) →
  `http/routes/` (parse with zod, call repo, return). Errors: throw `AppError`
  subclasses; `http/errorHandler.ts` maps them to `ApiErrorBody`.
- `apps/web`: React + TanStack Query + React Flow + CodeMirror, installable PWA.
  `api/client.ts` (fetch) → `api/queries.ts` (hooks + query keys) → `features/*`.
  VS Code-style shell: title bar + activity bar (`App.tsx`, icons in
  `components/icons.tsx`). The 3D graph (`features/graph/Graph3D.tsx`, three.js,
  lazy chunk, excluded from the PWA precache) is **experimental**: parked, not
  feature-complete (no link create/rename, layout not saved).
- `apps/mobile`: Capacitor 8 Android app. It ships the built web app
  (`webDir: ../web/dist`; `mobile:sync` builds it first) and runs it **read-only**
  from its own copy: pairs with the hub as a read-only device, pulls
  `GET /api/hub/latest/view` (a `PhoneView`, already in API shapes) into IndexedDB,
  and `api/phoneData.ts` answers the web app's GETs from it (offline too).
  `CapacitorHttp` is on, so hub requests skip CORS and mixed-content blocking.
  `android/` is generated by `cap add android`; the only hand edit
  is `AndroidManifest.xml` (`usesCleartextTraffic`, `allowBackup=false`). Lint and
  Prettier ignore `apps/mobile/android`. Not in the Docker image.
  Gradle wrapper is pinned to **9.1.0** (Capacitor's 8.14.3 can't run on Android
  Studio's bundled JDK 25); re-check it after `cap` upgrades. CLI build (PowerShell):
  `$env:JAVA_HOME="C:\Program Files\Android\Android Studio\jbr"`,
  `$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"`, then in `apps/mobile/android`:
  `.\gradlew.bat assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.
- `e2e/`: Playwright, desktop Chrome + Pixel 7 profile. Server runs against an
  in-memory DB with `KM_HUB=on` (it is its own hub); the `resetDatabase` auto-fixture
  empties it and disconnects sync before every test (hub versions accumulate; specs
  never assume version numbers). Phone specs use `phoneWithCopy` (fixtures.ts).
- Sync code: `@km/core` `sync.ts` (snapshot format, `SyncStatus`, `syncState`);
  server `repositories/snapshotRepository.ts` (canonical JSON + hash, read/replace),
  `sync/` (device side, `HubClient` maps hub errors to 502 + reason, never 401),
  `http/routes/hubRoutes.ts` (hub, bearer device tokens, own deny-by-default hook),
  `syncRoutes.ts`; web `features/sync/`. A new synced table must join
  `snapshotRowSchemas` (and bump `SNAPSHOT_FORMAT` if the shape changes).

## Commands

```sh
npm run dev         # server :4317 + vite :5173 (proxy /api)
npm run auth:setup  # TOTP secret → .env + QR in the terminal (--show / --new)
npm run mobile:sync # builds the web app and copies it into the Android project
npm run mobile:open # Android Studio (Run ▶); mobile:run deploys with the SDK on PATH
npm run check       # typecheck + lint + prettier + unit/API tests (must pass before "done")
npm run test:e2e    # builds web, starts server, runs Playwright
npm run build && npm start   # production: server serves apps/web/dist on :4317
npm run docker:up   # same production setup in one container (compose.yaml), data in a named volume
```

Shell quirk on this Windows machine: vitest fails under Git Bash ("failed to find the
runner"); run `npm run check` / tests from PowerShell. Prettier flags the user's own
untracked `.vscode/settings.json`: leave it alone (don't format or commit it).

Docker image: multi-stage `Dockerfile` (build web → runtime with server prod deps only,
runs as `node`, healthcheck on `/api/health`). Any runtime import in `apps/server` must be
a `dependencies` entry of `@km/server` or `@km/core`, or the image breaks.

## Sign-in and secrets

- Sign-in is a 6-digit **TOTP** code (Google Authenticator), the only factor, single
  owner. `KM_AUTH=totp|off` (default `totp`): the server refuses to start with sign-in
  on but no valid `KM_TOTP_SECRET`. Secrets live in the repo-root `.env` (gitignored;
  `.env.example` is the committed template). `apps/server/src/envFile.ts` loads it at
  startup and **never overrides** variables already set (the e2e config pins
  `KM_AUTH=off`).
- `http/auth.ts`: the lock is **deny-by-default on the matched route**
  (`request.routeOptions.url`), never a string check on `request.url` (the router
  percent-decodes, so `/%61pi/nodes` dodged that once). New public routes go in
  `PUBLIC_API`.
- Sessions: hashed tokens in `sessions`, httpOnly SameSite=Strict cookie
  `km_session`, fixed expiry `KM_SESSION_HOURS`; `KM_COOKIE_SECURE=true` behind HTTPS.
  The `sessions` and `sync_state` tables are device-local secret state: never sync
  them, and backups empty them.
- `auth/loginGuard.ts`: codes work once (`CODE_USED`); wrong codes are rationed
  (5 in a row → 1 min pause, 10 per rolling 24 h, not reset by a success; in memory,
  a restart clears it). Keep the ~1%/year guess odds documented in INSTALL.md if this
  changes.
- Read-only: a session made with `readOnly: true` gets 403 `READ_ONLY` on anything
  but GET/HEAD (the phone app has no session: it reads its own copy). In the web app, `features/readOnly.ts`
  (`isNativeApp()` / `useReadOnly()`) hides every editing control, and `NodeView`
  replaces the editor. A new editing control must check `useReadOnly()`.
  The phone only **views** the graph and nodes: feature panels (5 Whys, Link check,
  anything new) mount only in `NodePage`'s editable branch, never in `NodeView`,
  unless the user asks for one there (e.g. spaced repetition later). Asked for so far:
  the graph's **display** settings, on their own activity-bar tab (`/graph-settings`),
  never over the phone's graph view; and **Sync** (pull only), from the title bar.
- Graph settings (`features/graph/graphSettings.ts`): per-device look of the 2D graph
  and the push-on-drag, in localStorage, clamped on read; never sent to the server.
- Web: when a session ends mid-work, `AuthGate` shows a code dialog **over** the app
  (it stays mounted, so unsaved edits survive); `flushAllAutosaves()` saves them after
  sign-in and before sign-out.

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
- Web: no `fetch` outside `api/client.ts`; mutations invalidate via the `keys` factory.
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
- Tests: every new endpoint gets API tests (`app.inject` via `createTestApp`); every
  user-facing flow gets an e2e spec using role/label locators, not CSS, where possible.

## Implementer ↔ Critic loop

There is a dedicated reviewer agent: `.claude/agents/critic.md`. After any
non-trivial change:

1. Implement and get `npm run check` (and e2e if UI changed) green.
2. Ask the **critic** subagent to review the change.
3. For each finding: fix it, or rebut it with evidence. "I disagree" is not a rebuttal.
4. Repeat until the critic returns `APPROVE WITH NITS` or only contested items remain;
   report contested items to the user so they can decide.
