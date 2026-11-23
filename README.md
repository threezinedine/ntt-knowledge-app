# Knowledge Manager

A personal, local-first knowledge graph: nodes and **named, directed links**
(graph-database style), a markdown editor, a visual graph editor, and tasks filed
under nested categories. Runs as a local server + installable PWA (desktop and Android).

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

## Local development

Requires **Node.js ≥ 24**.

```sh
npm install
npm run dev          # http://localhost:5173 (UI) → API on :4317
```

Production-style (one process, one port):

```sh
npm run build
npm start            # http://127.0.0.1:4317
```

Data lives in `~/.knowledge-manager/km.sqlite` by default.

| Env var            | Default                          | Purpose                                                                                                                           |
| ------------------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `KM_HOST`          | `127.0.0.1`                      | Bind address (`0.0.0.0` to reach it on LAN)                                                                                       |
| `KM_PORT`          | `4317`                           | HTTP port                                                                                                                         |
| `KM_DB_PATH`       | `~/.knowledge-manager/km.sqlite` | SQLite file (`:memory:` for throwaway)                                                                                            |
| `KM_STATIC_DIR`    | `apps/web/dist`                  | Built UI to serve                                                                                                                 |
| `KM_LOG_LEVEL`     | `info`                           | Pino log level                                                                                                                    |
| `KM_ALLOWED_HOSTS` | _(empty)_                        | Extra hostnames accepted in `Host` (comma-separated). Loopback is always allowed; everything else gets 403 (DNS-rebinding guard). |

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
