# Installing and running Knowledge Manager

What the app does is in the [README](README.md). This file covers setting it up,
configuring it, backing it up, and building the Android app.

- [Requirements](#requirements)
- [Option 1: Docker](#option-1-docker)
- [Option 2: from source](#option-2-from-source)
- [Sign-in setup](#sign-in-setup)
- [Configuration](#configuration)
- [Fields and levels table](#fields-and-levels-table)
- [Backups, restore and markdown export](#backups-restore-and-markdown-export)
- [Using it from your phone](#using-it-from-your-phone)
- [Android app](#android-app)
- [Security notes](#security-notes)
- [Development](#development)

## Requirements

- **Docker** (option 1), or **Node.js 24 or newer** (option 2). The server uses Node's
  built-in SQLite, so there are no native modules to compile.
- **Node.js 24+** on the host for the one-time sign-in setup (`npm run auth:setup`),
  even when the app itself runs in Docker.
- An authenticator app on your phone (Google Authenticator or any TOTP app), unless you
  turn sign-in off.

## Option 1: Docker

One container serves both the API and the web UI.

```sh
git clone git@github.com:threezinedine/ntt-knowlege-app.git
cd ntt-knowlege-app
npm install            # only needed for the sign-in setup below
npm run auth:setup     # creates .env with your sign-in secret
docker compose up -d --build     # or: npm run docker:up
```

Open http://localhost:4317 and enter the code from your authenticator app.

Data lives in the Docker volume `knowledge-manager-data` and survives restarts and
rebuilds.

```sh
npm run docker:logs     # follow the logs
npm run docker:down     # stop (data is kept)
docker compose down -v  # stop AND delete all data, backups in the volume included
```

`compose.yaml` reads these from the shell or from `.env` next to it:

| Variable           | Default     | Purpose                                                           |
| ------------------ | ----------- | ----------------------------------------------------------------- |
| `KM_PORT`          | `4317`      | Port on the host                                                  |
| `KM_PUBLISH_ADDR`  | `127.0.0.1` | `0.0.0.0` to reach it from other devices on your network          |
| `KM_ALLOWED_HOSTS` | _(empty)_   | Required with `0.0.0.0`: the PC's LAN IP or hostname              |
| `KM_AUTH`          | `totp`      | `off` disables sign-in (only for a machine nobody else can reach) |
| `KM_TOTP_SECRET`   | _(empty)_   | Written by `npm run auth:setup`                                   |

Inside the container the database is `/data/km.sqlite` and the level table, if you add
one, is `/data/level-config.json`.

## Option 2: from source

```sh
git clone git@github.com:threezinedine/ntt-knowlege-app.git
cd ntt-knowlege-app
npm install
npm run auth:setup     # or put KM_AUTH=off in .env for a local-only machine
```

**Production-style** (one process, one port):

```sh
npm run build
npm start              # http://127.0.0.1:4317
```

**Development** (hot reload):

```sh
npm run dev            # UI on http://localhost:5173, API on :4317
```

The database is `~/.knowledge-manager/km.sqlite` by default. It is created on first
start, and schema migrations run automatically.

## Sign-in setup

The app has one owner and signs in with a 6-digit code from an authenticator app (TOTP).

```sh
npm run auth:setup             # new secret: shows a QR code, checks one code, writes .env
npm run auth:setup -- --show   # show the QR code again (e.g. for a new phone)
npm run auth:setup -- --new    # replace the secret (old authenticator entries stop working)
```

Scan the QR code (or type the setup key it prints), enter the code your app shows, then
restart the server. The secret is stored in `.env` at the repository root. That file is
gitignored; keep a copy, or the QR code, somewhere safe: backups don't include it.

How it behaves:

- A sign-in lasts `KM_SESSION_HOURS` (default 168 hours, one week). When it ends, a code
  box appears over the page; unsaved edits stay and are saved after you sign in.
- Each code works once.
- Wrong codes are rationed: after 5 in a row, sign-in pauses for a minute, and at most 10
  are allowed per rolling 24 hours (a correct code doesn't reset that count). With a
  6-digit code as the only factor, this keeps someone who can reach the server to about
  a 1% chance per year of guessing a code.
- While locked, every code is refused, including yours; open sessions keep working.
  Restarting the server clears the lock.
- The server refuses to start with sign-in on and no valid `KM_TOTP_SECRET`.

## Configuration

The server reads the repository-root `.env` at start-up (see [`.env.example`](.env.example)).
Variables already set in the environment win over the file.

| Variable               | Default                            | Purpose                                                                                                                                  |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `KM_HOST`              | `127.0.0.1`                        | Bind address; `0.0.0.0` to reach it on your LAN                                                                                          |
| `KM_PORT`              | `4317`                             | HTTP port                                                                                                                                |
| `KM_DB_PATH`           | `~/.knowledge-manager/km.sqlite`   | SQLite file (`:memory:` for a throwaway database)                                                                                        |
| `KM_STATIC_DIR`        | `apps/web/dist`                    | Built web UI to serve                                                                                                                    |
| `KM_ALLOWED_HOSTS`     | _(empty)_                          | Extra hostnames accepted in the `Host` header, comma-separated. Loopback is always allowed; anything else gets 403 (DNS-rebinding guard) |
| `KM_AUTH`              | `totp`                             | `totp`: sign in with a code. `off`: no sign-in                                                                                           |
| `KM_TOTP_SECRET`       | _(empty)_                          | Authenticator secret (base32), written by `npm run auth:setup`                                                                           |
| `KM_SESSION_HOURS`     | `168`                              | How long a sign-in lasts                                                                                                                 |
| `KM_COOKIE_SECURE`     | `false`                            | `true` when the app is served over HTTPS                                                                                                 |
| `KM_BACKUP_DIR`        | `backups/` next to the database    | Where Backup Now and Export Markdown write. Use an absolute path                                                                         |
| `KM_LEVEL_CONFIG`      | `level-config.json` next to the DB | The fields and levels table                                                                                                              |
| `KM_LOG_LEVEL`         | `info`                             | Server log level                                                                                                                         |
| `KM_MOBILE_SERVER_URL` | _(example in `.env.example`)_      | The server the Android app opens; read at build time                                                                                     |

## Fields and levels table

How much EXP a node earns, and how much each level needs, is set by whoever runs the
server; the app has no screen for it. To change it, copy
[`level-config.example.json`](level-config.example.json) to `level-config.json` next to
the database (`/data/level-config.json` in Docker), edit it and restart.

| Key                    | Default                | Meaning                                                                              |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------ |
| `expPerNode`           | 10                     | EXP every tagged node earns                                                          |
| `wordsPerExp`          | 20                     | One bonus EXP per this many words of content...                                      |
| `maxContentExpPerNode` | 50                     | ...up to this much per node                                                          |
| `expPerWhy`            | 5                      | EXP for an answered top-level 5 Whys question; each level deeper earns twice as much |
| `maxWhysExpPerNode`    | 200                    | Cap on 5 Whys EXP per node, all sessions together                                    |
| `levelThresholds`      | 50, 150, 300, 500, ... | Total EXP needed for level 2, 3, ... (strictly increasing)                           |

Missing keys use the defaults. A broken file stops the server with a message that says
what is wrong.

## Backups, restore and markdown export

Both exports run when you ask for them, from the command palette (`F1`) on the desktop
app:

- **Backup Now** writes `km-<time>.sqlite`, a consistent copy of the whole database. It
  is safe while the server runs. Sign-in sessions are left out, so you sign in again
  after a restore.
- **Export Markdown** writes `exports/<time>/` with one `.md` file per node: front matter
  (id, type, dates, tag paths, properties, links as `[[wiki links]]`), then the content
  and its 5 Whys sessions. It opens in Obsidian or any editor.

They go to `KM_BACKUP_DIR` (default `backups/` next to the database). Point it at another
disk or a cloud-synced folder; a backup on the same disk as the database is lost with
that disk. In Docker the default is inside the volume; `compose.yaml` has commented lines
for a host folder.

**Restore** from the terminal, with the server stopped:

```sh
npm run backup:restore            # list backups, newest first
npm run backup:restore -- 1       # restore the newest (or pass a file name); --yes skips the prompt
```

It refuses while the server is running, checks that the file is a healthy database this
version can open, asks for confirmation, and first saves the current database as
`km-before-restore-<time>.sqlite`, so a restore can itself be undone.

In Docker, stop the service first, then run the restore in a one-off container:

```sh
docker compose stop
docker compose run --rm km node --import tsx apps/server/src/cli/restore.ts 1 --yes
docker compose start
```

## Using it from your phone

The server has to be reachable on your network:

```sh
# from source
npm run build
KM_HOST=0.0.0.0 KM_ALLOWED_HOSTS=192.168.1.20 npm start     # your PC's LAN IP
```

With Docker, set `KM_PUBLISH_ADDR=0.0.0.0` and `KM_ALLOWED_HOSTS=<pc-ip>` in `.env`.
Windows may ask whether Node can use the network: allow **Private** networks.

Then either open `http://<pc-ip>:4317` in the phone's browser (and "Add to home screen"),
or install the read-only Android app below. Browsers only allow a full install (offline
shell) over HTTPS or on `localhost`; over plain LAN HTTP the web app works as a bookmark.

## Android app

`apps/mobile` is a Capacitor app that opens the web app from your server in read-only
mode. It is meant for sideloading onto your own phone.

One-time setup:

1. Install [Android Studio](https://developer.android.com/studio); it brings the Android
   SDK and a JDK. On the phone, enable developer options (tap _Build number_ seven times)
   and turn on _USB debugging_.
2. In `.env`, set `KM_MOBILE_SERVER_URL=http://<pc-wifi-ip>:4317`. A DHCP reservation in
   your router keeps that IP fixed.
3. Run the server so the phone can reach it (see above; use `npm start`, not the Vite dev
   server).

Build and install:

```sh
npm run mobile:sync     # after changing KM_MOBILE_SERVER_URL or capacitor.config.ts
npm run mobile:open     # opens Android Studio: press Run with the phone plugged in
npm run mobile:run      # or deploy directly, with the Android SDK on PATH
```

Or build the APK from PowerShell without opening Android Studio, then copy
`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` to the phone:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
cd apps/mobile/android; .\gradlew.bat assembleDebug
```

The Gradle wrapper is pinned to 9.1.0 so it runs on Android Studio's bundled JDK. The
app needs the PC on and on the same Wi-Fi; otherwise it shows a retry page.

## Security notes

- Keep the server off the public internet unless you put HTTPS in front of it and accept
  a single 6-digit code as the only factor.
- On plain LAN HTTP, the sign-in code and the session cookie cross the Wi-Fi unencrypted.
  That is acceptable on your own home network. Elsewhere, put HTTPS in front (for
  example Caddy or Tailscale), set `KM_COOKIE_SECURE=true`, and use an `https://`
  `KM_MOBILE_SERVER_URL`.
- `.env` holds the sign-in secret. It is gitignored and not part of backups.

## Development

```sh
npm run dev         # server :4317 + Vite :5173
npm run check       # typecheck + ESLint + Prettier + unit and API tests
npm run test:e2e    # builds the web app, starts a server on an in-memory DB, runs Playwright
```

End-to-end tests run twice: desktop Chrome and a Pixel 7 touch profile. Tests that need a
mouse, a hardware keyboard or the clipboard are skipped on the touch profile, with the
reason in the test.

On Windows, run the unit tests from PowerShell (Vitest fails to start under Git Bash).
Architecture and conventions are in [`CLAUDE.md`](CLAUDE.md).
