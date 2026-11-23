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

### Android app (read-only, Capacitor)

`apps/mobile` is an Android app that opens the web app from your server and
shows it **read-only**: browse the graph, read nodes and follow links; nothing
can be created, edited or deleted. The server enforces it too: the app signs in
with a read-only session, and every write from it gets `403`.

One-time setup on the PC:

1. Install [Android Studio](https://developer.android.com/studio) (brings the
   Android SDK and the right JDK). On the phone: _Settings → About phone → tap
   Build number 7×_, then _Developer options → USB debugging_ on.
2. In `.env`: `KM_MOBILE_SERVER_URL=http://<pc-wifi-ip>:4317` (`ipconfig`
   shows the Wi-Fi IPv4). A DHCP reservation in the router keeps it fixed.
3. Run the server so the phone can reach it (production build, not Vite):

   ```sh
   npm run build
   KM_HOST=0.0.0.0 KM_ALLOWED_HOSTS=<pc-wifi-ip> npm start
   ```

   Windows may ask to allow Node through the firewall: allow **Private** networks.
   With sign-in on (`npm run auth:setup`), the app asks for the code like the web.

4. Build and install:

   ```sh
   npm run mobile:sync     # after changing KM_MOBILE_SERVER_URL or Capacitor config
   npm run mobile:open     # opens Android Studio: press ▶ Run with the phone plugged in
   # or, with the SDK on PATH:  npm run mobile:run
   ```

   Or build the APK without opening Android Studio (PowerShell), then copy
   `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` to the phone:

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   cd apps/mobile/android; .\gradlew.bat assembleDebug
   ```

The app needs the PC on and the same Wi-Fi (it shows a retry page otherwise).

- It is plain http on the LAN: the sign-in code and the session cookie cross
  the Wi-Fi unencrypted, so anyone on that network could listen in. Fine on
  your own home Wi-Fi; anywhere else, put HTTPS in front (e.g. Caddy or
  Tailscale), then use an `https://` `KM_MOBILE_SERVER_URL` and
  `KM_COOKIE_SECURE=true`.
- It is built for installing on your own phone (sideloading). An app that only
  opens a server URL is not what the Play Store accepts.

## Quality gates

```sh
npm run check      # typecheck + eslint (strict, type-aware) + prettier + vitest
npm run test:e2e   # Playwright: desktop Chrome + Pixel 7
```

See `CLAUDE.md` for architecture and conventions, and `.claude/agents/critic.md`
for the review agent.
