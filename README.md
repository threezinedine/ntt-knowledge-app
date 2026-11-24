# Knowledge Manager

A personal knowledge base where notes are nodes in a graph. Each note has markdown
content, a type and a set of tags, and notes are joined by **named, directed links**
("CPU _contains_ Cache", "Cache _speeds up_ Memory access"). You edit notes in a
markdown editor and arrange them on a graph canvas. Tags form a tree of fields of
knowledge, and each field gains EXP and levels as you write about it.

It runs as a small server on your own machine and stores everything in one SQLite
file. You use it in the browser (installable as an app). Several machines can share
the same graph through a sync hub, and a read-only Android app keeps a copy on your
phone to browse offline.

Setup, configuration and backups: **[INSTALL.md](INSTALL.md)**.

## Contents

- [Notes](#notes)
- [Links](#links)
- [Graph view](#graph-view)
- [Tags and fields](#tags-and-fields)
- [5 Whys](#5-whys)
- [Link check](#link-check)
- [Finding things](#finding-things)
- [Keyboard and commands](#keyboard-and-commands)
- [Settings](#settings)
- [Sync between devices](#sync-between-devices)
- [Phone](#phone)
- [Sign-in](#sign-in)
- [Backups and export](#backups-and-export)
- [Languages](#languages)
- [How data is stored](#how-data-is-stored)

## Notes

A note (node) has a **title**, a **type** (`note` by default; any short word, such as
`concept` or `person`), **markdown content**, **tags**, **links** and optional
**properties**.

- **Markdown editor** with three modes: _Edit_, _Split_ (editor and preview side by
  side) and _Preview_. The preview supports GitHub-flavoured markdown (tables, task
  lists, strikethrough).
- **Autosave.** Changes save as you type; the header shows _Saved_, _Unsaved_,
  _Saving…_ or _Save failed_. Edits are never lost when a sign-in expires: a code box
  appears over the page and the edits save after you sign in.
- **Properties**: a JSON object for anything structured you want to keep on a note.
- **Vim mode** (optional, per device) for the title and the content. A small indicator
  shows whether the keyboard is typing Latin letters, which matters with Vietnamese
  input methods (Telex/VNI) that turn vim commands into letters.
- **Quick focus**: `Alt+K` jumps to the title and `Alt+J` to the content; `Enter` in the
  title moves to the content.
- Deleting a note asks first and also removes its links.

## Links

Links are directed and named: _from_ → **relation** → _to_. The relation is free text
(`contains`, `depends on`, `thuộc về`, ...), so you use your own vocabulary.

- Create a link on the note page (pick the direction, the relation and the other note),
  or on the graph by dragging from one dot to another.
- A note page lists **outgoing** and **incoming** links; click one to go to the other
  note.
- Rename a link in place (double-click it on the graph, or use its menu), or delete it.
- Two notes can have several links between them, in either direction, and a note can
  link to itself. Each one is drawn separately.

## Graph view

The home screen shows all notes as dots on a 2D canvas.

- **Your layout is kept.** Drag dots where you want them; positions are saved. Dragging
  a dot gently pushes nearby dots aside, and they settle back once you move on.
- **Size shows connections.** The best-linked note gets the biggest dot and the
  least-linked the smallest, so hubs stand out even in a small graph.
- **Colour shows type.** Plain notes are grey; each other type gets its own colour.
- **Hover a dot** to highlight it, its links and its neighbours, and to dim the rest.
- **Names hide when zoomed out** to keep the picture readable.
- Double-click a dot to open the note. Right-click a dot for _Open, Rename, Tags,
  Reveal in Graph, Copy Title, Copy Link, Delete_. Right-click a link for _Rename,
  Open either end, Delete_.
- A minimap, zoom controls and _Fit to screen_ (`Shift+1`).
- **Graph settings** (gear button): dot sizes, text size and strength of node and link
  names, line thickness, arrows on/off, link names on/off, and how strongly dragging
  pushes other dots. Changes apply immediately and are saved on that device.
- A **3D view** (`Shift+3`) is available as an experiment: you can look around, but it
  doesn't create links or save a layout.

## Tags and fields

One tag tree is shared by all notes, and a note can have any number of tags.

- **Tags page**: create tags, nest them by drag and drop, rename them, give them a
  colour, and move them to the top level.
- On a note, add tags by dragging them from the tag palette, from the _+ tag_ picker, or
  with `Alt+G`.

Every tag is also a **field of knowledge** with EXP and a level. The sidebar lists your
fields with a progress bar; parents include everything under them.

- A note adds EXP to each of its tags and their parent tags: a base amount, plus a
  bonus for longer content (capped, so padding doesn't pay), plus a bonus for its
  answered 5 Whys questions.
- Deeper 5 Whys answers are worth more: each level down earns twice the one above.
- Reaching a new level shows a short celebration.
- The numbers (EXP per note, bonuses, level thresholds) are set by whoever runs the
  server; see [INSTALL.md](INSTALL.md#fields-and-levels-table).

## 5 Whys

A way to test your own understanding of a note. An AI asks "why?" about what you wrote,
then "why?" about your answer, and so on until you reach the root. You can use any AI
chat; the app doesn't call an AI itself.

1. On a note, open **5 Whys** (`Alt+W`) and copy the prompt (English or Vietnamese). It
   contains the note's title, content, links and earlier sessions.
2. Paste it into a new chat (ChatGPT, Claude, Gemini, ...). The AI asks one question at a
   time and you answer in your own words. You can ask it to dig deeper into your last
   answer, or to move to another point of the note.
3. Type `end`. The AI replies with the session as JSON. Paste the whole reply into the
   app; it finds the JSON, shows a preview, and saves it.

Each note keeps all its sessions. A session is shown as a tree (deeper whys under the
why they dig into) with a summary and a conclusion. You can edit every question, answer
and takeaway, add or remove whys, or edit the session as JSON. Answered whys add EXP to
the note's fields.

## Link check

Copies a prompt (`Alt+Shift+L`) that asks an AI chat to fact-check the links around a
note: whether each relation is true, points the right way and uses the right word. You
pick how far out to look (the note's direct neighbours, or more levels). The prompt
includes the titles, tags and content of those notes. The AI gives every link a verdict
(correct, needs a fix, wrong, or unsure) and suggests the concrete change.

## Finding things

- **Sidebar**: all notes, most recently edited first, with a title search
  (`Ctrl+Shift+F`).
- **Go to Note** (`Ctrl+P`): type part of a title and press Enter.
- **Command palette** (`F1` or `Ctrl+Shift+P`): every action, with recently used
  commands first.
- **Reveal in Graph** (from a note's menu): opens the graph centred on that note.

## Keyboard and commands

Most actions are commands, with shortcuts in the style of VS Code. The **Keyboard
Shortcuts** page (`Ctrl+K Ctrl+S`) lists them all; you can search, add, change, remove
or reset any binding, including two-step chords such as `Ctrl+K V`. Conflicts are shown.

| Action                       | Shortcut                     |
| ---------------------------- | ---------------------------- |
| Command palette              | `F1`, `Ctrl+Shift+P`         |
| Go to note                   | `Ctrl+P`                     |
| New note                     | `Alt+N`                      |
| Rename note                  | `F2`                         |
| Add link / add tag           | `Alt+L` / `Alt+G`            |
| 5 Whys / copy its prompt     | `Alt+W` / `Alt+Shift+W`      |
| Copy link check prompt       | `Alt+Shift+L`                |
| Toggle preview / to the side | `Ctrl+K Ctrl+V` / `Ctrl+K V` |
| Graph / Tags page            | `Alt+1` / `Alt+2`            |
| Fit graph, zoom in, zoom out | `Shift+1`, `=`, `-`          |
| Toggle sidebar               | `Ctrl+B`                     |

On macOS, `Ctrl` is `Cmd`, and the `Alt+` shortcuts are `Ctrl+Alt+` (or `Ctrl+` for the
page switches), because `Option+letter` types characters there.

## Settings

Personal settings are stored per device (in the browser), not on the server: graph
settings, keyboard shortcuts, display language, vim mode, and the prompt languages and
depth of 5 Whys and Link check.

To use the same settings on another device, **Export Settings…** saves them as a JSON
file and **Import Settings…** loads one (command palette, or the buttons at the bottom
of the graph settings). Importing replaces only the settings in the file and leaves the
rest. Shortcuts carry over between Windows and macOS (`Ctrl` becomes `Cmd` and back).
Invalid entries are skipped and listed.

## Sync between devices

Each machine keeps its own copy of the graph. To use the same graph on several
machines, one server acts as the **hub** (on your network or on the internet), and
every device syncs with it by hand.

- The hub keeps **numbered versions** of the whole graph. Each version records which
  device pushed it and when, and has a hash that identifies its content exactly.
- **Push** sends this device's copy to the hub as the newest version. **Pull** replaces
  this device's copy with the newest version.
- Nothing is merged. Whoever pushes last makes the newest version; older versions stay
  in the hub's history.
- Nothing is overwritten without asking:
  - Pushing when the hub has a version this device hasn't pulled asks first.
  - Pulling over changes that were never pushed asks first, and saves a backup of this
    device before replacing them.
- The **title bar** shows where this device stands: up to date, changes not pushed, a
  newer version on the hub, or offline. It checks the hub every minute and when the
  network comes back.
- If the hub has a newer version and you start editing anyway, you are warned once for
  that version, then left to work.
- Offline, everything works as usual; the title bar just says _Offline_.

A device connects once with the hub's address and the code from the hub's
authenticator app (command palette: _Sync…_). Setting up a hub:
[INSTALL.md](INSTALL.md#sync-hub).

## Phone

- **Browser**: open the server's address and add it to the home screen. It's the full
  app with a touch-friendly layout.
- **Android app**: keeps a **read-only copy** of the graph on the phone, pulled from
  the hub, so you can read notes and follow links without a network or the PC. Pull
  again (title bar, _Sync_) for a newer version; the title bar says when the hub has
  one, and when the phone is offline. Nothing can be created, changed or deleted on
  the phone. Editing tools such as 5 Whys and Link check are left out to keep it
  simple. Display settings for the graph have their own tab, and you can import a
  settings file there.

See [INSTALL.md](INSTALL.md#android-app).

## Sign-in

Single user. You sign in with the 6-digit code from an authenticator app (Google
Authenticator or any TOTP app). Each code works once, wrong codes are rate-limited, and
a sign-in lasts a week by default. Sign-in can be turned off for a machine only you can
reach. Details: [INSTALL.md](INSTALL.md#sign-in-setup).

## Backups and export

From the command palette:

- **Backup Now** saves a copy of the whole database.
- **Export Markdown** writes one `.md` file per note, with front matter (type, tags,
  properties, links as `[[wiki links]]`) and its 5 Whys sessions. Readable in Obsidian
  or any editor, without this app.

Restoring a backup is a terminal command that keeps a copy of the current database
first. See [INSTALL.md](INSTALL.md#backups-restore-and-markdown-export).

## Languages

The interface is in **English** and **Vietnamese** (command palette: _Change Display
Language_). It follows the browser's language until you pick one. The 5 Whys and Link
check prompts can be in either language, independently of the interface.

## How data is stored

- One SQLite file on the machine running the server (default
  `~/.knowledge-manager/km.sqlite`).
- Nothing is sent to outside services. The AI features only copy text to your clipboard
  for you to paste, and sync talks only to the hub you set up.
- Records are never physically deleted: deletes are marked, and every change is
  timestamped.
- A sync hub stores its versions in its own database, next to its own graph.
