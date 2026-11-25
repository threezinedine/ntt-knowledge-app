# Installing and running Knowledge Manager

What the app does is in the [README](README.md). This file covers setting up the hub,
connecting devices, configuration, and building the Android app.

How it fits together: **one server, the hub**, hosts the web app and keeps the versions
devices push. Each device (a browser, the Android app) keeps its own copy of the graph
and does all the work on it; it only talks to the hub to push and pull.

- [Requirements](#requirements)
- [Option 1: Docker](#option-1-docker)
- [Option 2: from source](#option-2-from-source)
- [Pairing code setup](#pairing-code-setup)
- [Configuration](#configuration)
- [Fields and levels table](#fields-and-levels-table)
- [The hub](#the-hub)
- [Other devices and your phone](#other-devices-and-your-phone)
- [Android app](#android-app)
- [Security notes](#security-notes)
- [Development](#development)

## Requirements

- **Docker** (option 1), or **Node.js 24 or newer** (option 2). The server uses Node's
  built-in SQLite, so there are no native modules to compile.
- **Node.js 24+** on the host for the one-time code setup (`npm run auth:setup`), even
  when the server runs in Docker.
- An authenticator app on your phone (Google Authenticator or any TOTP app), unless you
  turn the pairing code off.
- On the devices: a current browser. Chrome or Edge for the file features (saving the
  copy to a file on disk, exporting markdown into a folder).

## Option 1: Docker

```sh
git clone git@github.com:threezinedine/ntt-knowlege-app.git
cd ntt-knowlege-app
npm install            # only needed for the code setup below
npm run auth:setup     # creates .env with the pairing secret
docker compose up -d --build     # or: npm run docker:up
```

Open http://localhost:4317. The hub's versions live in the Docker volume
`knowledge-manager-data` and survive restarts and rebuilds.

```sh
npm run docker:logs     # follow the logs
npm run docker:down     # stop (data is kept)
docker compose down -v  # stop AND delete the hub's versions
```

`compose.yaml` reads these from the shell or from `.env` next to it:

| Variable               | Default     | Purpose                                                        |
| ---------------------- | ----------- | -------------------------------------------------------------- |
| `KM_PORT`              | `4317`      | Port on the host                                               |
| `KM_PUBLISH_ADDR`      | `127.0.0.1` | `0.0.0.0` to reach it from other devices on your network       |
| `KM_ALLOWED_HOSTS`     | _(empty)_   | Required with `0.0.0.0`: the machine's LAN IP or hostname      |
| `KM_AUTH`              | `totp`      | `off`: pairing needs no code (only for a hub nobody can reach) |
| `KM_TOTP_SECRET`       | _(empty)_   | Written by `npm run auth:setup`                                |
| `KM_HUB_KEEP_VERSIONS` | `100`       | How many versions to keep                                      |

Inside the container the database is `/data/km.sqlite` and the level table, if you add
one, is `/data/level-config.json`.

## Option 2: from source

```sh
git clone git@github.com:threezinedine/ntt-knowlege-app.git
cd ntt-knowlege-app
npm install
npm run auth:setup     # or put KM_AUTH=off in .env for a hub nobody else can reach
npm run build
npm start              # http://127.0.0.1:4317
```

The hub's database is `~/.knowledge-manager/km.sqlite` by default. It is created on
first start, and schema migrations run automatically.

**Coming from an earlier version** (where the server held the graph and the browser
edited it there): on the first start, the server's graph becomes the hub's version 1.
Connect each device and pull it.

## Pairing code setup

Connecting a device to the hub takes the 6-digit code from an authenticator app (TOTP).
There is no other sign-in: the data lives on the devices.

```sh
npm run auth:setup             # new secret: shows a QR code, checks one code, writes .env
npm run auth:setup -- --show   # show the QR code again (e.g. for a new phone)
npm run auth:setup -- --new    # replace the secret (old authenticator entries stop working)
```

Scan the QR code (or type the setup key it prints), enter the code your app shows, then
restart the server. The secret is stored in `.env` at the repository root. That file is
gitignored; keep a copy, or the QR code, somewhere safe.

How it behaves:

- A device pairs once; it then has a token of its own and doesn't need a code again.
- Each code works once.
- Wrong codes are rationed: after 5 in a row, pairing pauses for a minute, and at most 10
  are allowed per rolling 24 hours (a correct code doesn't reset that count). With a
  6-digit code as the only factor, this keeps someone who can reach the hub to about a
  1% chance per year of guessing a code.
- While locked, every code is refused, including yours; paired devices keep syncing.
  Restarting the server clears the lock.
- The server refuses to start with `KM_AUTH=totp` and no valid `KM_TOTP_SECRET`.

## Configuration

The server reads the repository-root `.env` at start-up (see [`.env.example`](.env.example)).
Variables already set in the environment win over the file.

| Variable               | Default                            | Purpose                                                                                                                                  |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `KM_HOST`              | `127.0.0.1`                        | Bind address; `0.0.0.0` to reach it on your LAN                                                                                          |
| `KM_PORT`              | `4317`                             | HTTP port                                                                                                                                |
| `KM_DB_PATH`           | `~/.knowledge-manager/km.sqlite`   | The hub's SQLite file (`:memory:` for a throwaway one)                                                                                   |
| `KM_STATIC_DIR`        | `apps/web/dist`                    | Built web app to serve                                                                                                                   |
| `KM_ALLOWED_HOSTS`     | _(empty)_                          | Extra hostnames accepted in the `Host` header, comma-separated. Loopback is always allowed; anything else gets 403 (DNS-rebinding guard) |
| `KM_AUTH`              | `totp`                             | `totp`: pairing takes a code. `off`: no code                                                                                             |
| `KM_TOTP_SECRET`       | _(empty)_                          | Authenticator secret (base32), written by `npm run auth:setup`                                                                           |
| `KM_HUB_KEEP_VERSIONS` | `100`                              | How many versions the hub keeps; older ones are dropped                                                                                  |
| `KM_LEVEL_CONFIG`      | `level-config.json` next to the DB | The fields and levels table                                                                                                              |
| `KM_LOG_LEVEL`         | `info`                             | Server log level                                                                                                                         |

## Fields and levels table

How much EXP a note earns, and how much each level needs, is set on the hub; the app
has no screen for it. Devices fetch it when they connect and pull, so EXP counts the
same everywhere. To change it, copy
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

## The hub

The hub keeps **versions of the whole graph** (notes, links, tags, layout, 5 Whys),
compressed, each with its number, a SHA-256 hash, the device that pushed it and when.
Pushing over a version a device hasn't pulled is refused unless the user confirms; the
older version stays in the history.

**Connecting a device**: open the hub's address in the browser, then _Sync…_ in the
command palette (or _Sync_ in the title bar). The hub's address is filled in; enter a
current code and a name for the device, and connect. The first device pushes; the
others pull.

**Paired devices**: disconnecting (or connecting again) tells the hub to forget the old
token. For a lost phone or an old PC, list and remove devices on the hub machine:

```sh
npm run hub:devices                 # list them
npm run hub:devices -- --revoke 2   # remove number 2; its token stops working at once
```

**Backups**: the hub's database file is the history of every device's pushes. Copy
`km.sqlite` (with the server stopped, or with `sqlite3 km.sqlite ".backup copy.sqlite"`)
if you want a copy elsewhere. Each device can also keep its own copy in a file on disk
(_Save This Device's Copy to a File…_).

Devices on different app versions can only sync if the data format matches; the app
says so when it doesn't.

## Other devices and your phone

The hub has to be reachable from them:

```sh
# from source
KM_HOST=0.0.0.0 KM_ALLOWED_HOSTS=192.168.1.20 npm start     # the hub machine's LAN IP
```

With Docker, set `KM_PUBLISH_ADDR=0.0.0.0` and `KM_ALLOWED_HOSTS=<hub-ip>` in `.env`.
Windows may ask whether Node can use the network: allow **Private** networks.

Then open `http://<hub-ip>:4317` on the other device and connect it (Sync). On a phone's
browser, "Add to home screen" works too; browsers only allow a full install (offline
shell) over HTTPS or on `localhost`. For a copy that works offline on the phone, use
the Android app below.

## Android app

`apps/mobile` is a Capacitor app that carries the web app and a read-only copy of your
graph, pulled from the hub. It is meant for sideloading onto your own phone.

The app carries its own copy of the web app, so it doesn't update with the hub. After
updating the hub, rebuild and reinstall it: an older app may fail to pull data written
by newer features (for example review progress).

One-time setup: install [Android Studio](https://developer.android.com/studio); it
brings the Android SDK and a JDK. On the phone, enable developer options (tap _Build
number_ seven times) and turn on _USB debugging_.

Build and install:

```sh
npm run mobile:sync     # builds the web app and copies it into the Android project
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

The Gradle wrapper is pinned to 9.1.0 so it runs on Android Studio's bundled JDK.

In the app, tap _Sync_ in the title bar, enter the hub's address and a code from its
authenticator app, then **Pull**. The phone pairs as a read-only device: the hub never
accepts a push from it. Rebuild the app after updating the code; the copy on the phone
stays.

## Security notes

- Keep the hub off the public internet unless you put HTTPS in front of it and accept
  a single 6-digit code as the only factor for pairing.
- On plain LAN HTTP, pairing codes, device tokens and sync traffic (your whole graph)
  cross the Wi-Fi unencrypted. That is acceptable on your own home network. Elsewhere,
  put HTTPS in front (for example Caddy or Tailscale) and give devices the hub's
  `https://` address.
- The web app's files are public (they hold no data); the hub answers only paired
  devices. The hub keeps only a hash of each device token.
- Each device's copy is as safe as that device: anyone using its browser profile can
  open it. A file it is saved to carries the device's hub token too (it can push):
  keep that file private. Opening such a file on another device drops the token, so
  that device connects again.
- `.env` holds the pairing secret. It is gitignored.

## Development

```sh
npm run dev         # hub :4317 + Vite :5173 (proxy /api)
npm run check       # typecheck + ESLint + Prettier + unit tests
npm run test:e2e    # builds the web app, starts a hub on an in-memory DB, runs Playwright
```

End-to-end tests run twice: desktop Chrome and a Pixel 7 touch profile. Tests that need a
mouse, a hardware keyboard or the clipboard are skipped on the touch profile, with the
reason in the test.

On Windows, run the unit tests from PowerShell (Vitest fails to start under Git Bash).
Architecture and conventions are in [`CLAUDE.md`](CLAUDE.md).
