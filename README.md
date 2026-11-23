# Knowledge Manager

A personal, local-first knowledge graph: nodes and **named, directed links**
(graph-database style), a markdown editor, a visual graph editor, and a tag tree
whose tags are fields of knowledge that level up as you write nodes about them. Runs as a local server + installable PWA (desktop and Android).

## Quick start (Docker, one command)

```sh
docker compose up -d --build     # or: npm run docker:up
```

Open http://localhost:4317. That one container is the API server and the web UI.
Data persists in the `knowledge-manager-data` volume across restarts and rebuilds.

```sh
npm run docker:logs     # follow logs
npm run docker:down     # stop (data is kept)
docker compose down -v  # stop AND delete all data
```

Phone on the same Wi-Fi: create a `.env` next to `compose.yaml` with

```sh
KM_PUBLISH_ADDR=0.0.0.0
KM_ALLOWED_HOSTS=192.168.1.20   # your PC's LAN IP
```

Backup: `docker run --rm -v knowledge-manager-data:/data -v "$PWD":/backup busybox cp /data/km.sqlite /backup/`

## Sign-in (authenticator code)

The app asks for the 6-digit code from **Google Authenticator** (or any TOTP
app). Set it up once:

```sh
npm run auth:setup      # makes the secret, shows a QR code, checks one code
```

Scan the QR with the app (or type the setup key it prints), enter the code it
shows, and the secret is saved to the repo-root `.env` (gitignored) with
`KM_AUTH=totp`. Restart the server. The secret never appears on the web.

- A sign-in lasts `KM_SESSION_HOURS` (168 = a week). When it ends, a box asks
  for a new code over the page; unsaved edits are kept and saved after.
- Wrong codes are rationed: 5 in a row pause sign-in for a minute, and at most
  10 per rolling 24 hours (a successful sign-in doesn't reset that). Each code
  works once. With one 6-digit code as the only factor, that limits someone
  who can reach the server to about a **1% chance a year** of guessing in.
  Keep the server unreachable from the internet unless you accept that.
- While locked, every code is refused, yours too (your open sessions keep
  working). So anyone who can reach the server can keep you from signing in by
  spending the budget; restarting the server clears the lock. Another reason
  to keep it off the open internet.
- Served over HTTPS (reverse proxy)? Set `KM_COOKIE_SECURE=true`.
- `npm run auth:setup -- --show` shows the QR again (new phone);
  `-- --new` replaces the secret.
- `KM_AUTH=off` turns sign-in off, for a machine only you can reach.
- The server won't start with sign-in on but no valid `KM_TOTP_SECRET`
  (also after upgrading a Docker setup: run `auth:setup` or set `KM_AUTH=off`).

## Local development

Requires **Node.js ≥ 24**.

```sh
npm install
npm run auth:setup   # sign-in code (or KM_AUTH=off in .env), see above
npm run dev          # http://localhost:5173 (UI) → API on :4317
```

Production-style (one process, one port):

```sh
npm run build
npm start            # http://127.0.0.1:4317
```

Data lives in `~/.knowledge-manager/km.sqlite` by default.

| Env var            | Default                            | Purpose                                                                                                                           |
| ------------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `KM_HOST`          | `127.0.0.1`                        | Bind address (`0.0.0.0` to reach it on LAN)                                                                                       |
| `KM_PORT`          | `4317`                             | HTTP port                                                                                                                         |
| `KM_DB_PATH`       | `~/.knowledge-manager/km.sqlite`   | SQLite file (`:memory:` for throwaway)                                                                                            |
| `KM_STATIC_DIR`    | `apps/web/dist`                    | Built UI to serve                                                                                                                 |
| `KM_LOG_LEVEL`     | `info`                             | Pino log level                                                                                                                    |
| `KM_ALLOWED_HOSTS` | _(empty)_                          | Extra hostnames accepted in `Host` (comma-separated). Loopback is always allowed; everything else gets 403 (DNS-rebinding guard). |
| `KM_LEVEL_CONFIG`  | `level-config.json` next to the DB | EXP / level table (see below)                                                                                                     |
| `KM_AUTH`          | `totp`                             | `totp` = sign in with an authenticator code; `off` = no sign-in (local only). See above.                                          |

### Fields, EXP and levels

Every tag is a field. A field's EXP is the sum over the distinct nodes tagged with it
or with any tag below it: each node is worth `expPerNode` plus one per `wordsPerExp`
words of content (at most `maxContentExpPerNode`). `levelThresholds` lists the total
EXP for level 2, 3, ... The sidebar shows each field's level under the node list.

The table is set by whoever runs the server, not from the app: copy
[`level-config.example.json`](level-config.example.json) to `level-config.json` next to
the database (`/data/level-config.json` in Docker), edit, restart. Missing keys use the
defaults; a broken file stops the server with a message saying what is wrong.

### Using it on Android

Run the server with `KM_HOST=0.0.0.0 KM_ALLOWED_HOSTS=<pc-ip>`, open `http://<pc-ip>:4317` on the phone and
use "Add to home screen". Note: browsers only enable the service worker (offline
shell, true install) on `https` or `localhost`. Over plain LAN http it works as a
bookmarked web app. Proper install needs HTTPS (e.g. a reverse proxy or Tailscale).

## Quality gates

```sh
npm run check      # typecheck + eslint (strict, type-aware) + prettier + vitest
npm run test:e2e   # Playwright: desktop Chrome + Pixel 7
```

See `CLAUDE.md` for architecture and conventions, and `.claude/agents/critic.md`
for the review agent.
