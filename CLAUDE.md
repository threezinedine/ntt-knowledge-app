# Knowledge Manager: working agreement

Local-first personal knowledge graph. Property-graph model: **nodes** (type/label,
title, markdown content, JSON props, canvas position) connected by **named, directed
edges** (also with JSON props). Nodes carry **tasks**. One shared **tag tree** attaches
many-to-many to both nodes and tasks (`node_tags` / `task_tags` link tables, tombstoned
like everything else). An EXP system built on task completion is planned
(`tasks.completed_at` exists for it).

## Layout

- `packages/core`: zod schemas, shared types, pure domain logic (tag tree, cycle
  check). No I/O. Both server and web import it as TS source.
- `apps/server`: Fastify + `node:sqlite` (Node ≥ 24, no native deps).
  `db/` (migrations, transaction helper) → `repositories/` (all SQL lives here) →
  `http/routes/` (parse with zod, call repo, return). Errors: throw `AppError`
  subclasses; `http/errorHandler.ts` maps them to `ApiErrorBody`.
- `apps/web`: React + TanStack Query + React Flow + CodeMirror, installable PWA.
  `api/client.ts` (fetch) → `api/queries.ts` (hooks + query keys) → `features/*`.
- `e2e/`: Playwright, desktop Chrome + Pixel 7 profile. Server runs against an
  in-memory DB; the `resetDatabase` auto-fixture empties it before every test.

## Commands

```sh
npm run dev         # server :4317 + vite :5173 (proxy /api)
npm run check       # typecheck + lint + prettier + unit/API tests (must pass before "done")
npm run test:e2e    # builds web, starts server, runs Playwright
npm run build && npm start   # production: server serves apps/web/dist on :4317
npm run docker:up   # same production setup in one container (compose.yaml), data in a named volume
```

Docker image: multi-stage `Dockerfile` (build web → runtime with server prod deps only,
runs as `node`, healthcheck on `/api/health`). Any runtime import in `apps/server` must be
a `dependencies` entry of `@km/server` or `@km/core`, or the image breaks.

## Rules

- **Validate at the boundary** with schemas from `@km/core` (`strictObject`, so unknown
  keys are 400s). Never redeclare an API type in web or server.
- **Data is sync-ready**: UUIDv7 ids, every write bumps `updated_at`, deletes are
  tombstones (`deleted_at`), and every read filters `deleted_at IS NULL`.
- **Migrations are append-only.** Never edit a shipped entry in `migrations.ts`.
- PATCH semantics: `undefined` = leave as is, `null` = clear.
- Multi-statement writes go through `transaction(db, fn)`.
- Web: no `fetch` outside `api/client.ts`; mutations invalidate via the `keys` factory.
- Web i18n: no user-visible literal strings in components (text, `aria-label`, `placeholder`,
  `title`). Add the key to `i18n/locales/en.json` **and** `vi.json`, use `useI18n().t`/`tx`.
  Show errors with `errorText(err)`, never the raw server message. API errors that need a
  specific message get an `ApiErrorReason` (`@km/core`) instead of client-side string matching.
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
