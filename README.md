# Knowledge Manager

A personal knowledge base where notes are nodes in a graph. Each note has markdown
content, a type and a set of tags, and notes are joined by **named, directed links**
("CPU _contains_ Cache", "Cache _speeds up_ Memory access"). You edit notes in a
markdown editor and arrange them on a graph canvas. Tags form a tree of fields of
knowledge, and each field gains EXP and levels as you write about it.

Each device keeps **its own copy** of the graph and works on it right there, also
offline: the browser holds it in a database file of its own, and the Android app on
the phone. One small server, **the hub**, keeps the versions you push to it, like a
remote repository, and serves the web app. Others see your changes only after you push
and they pull.

Setup and configuration: **[INSTALL.md](INSTALL.md)**.

## Contents

- [Notes](#notes)
- [Links](#links)
- [Wikilinks](#wikilinks)
- [Graph view](#graph-view)
- [Tags and fields](#tags-and-fields)
- [5 Whys](#5-whys)
- [Review today](#review-today)
- [Link check](#link-check)
- [Finding things](#finding-things)
- [Keyboard and commands](#keyboard-and-commands)
- [Settings](#settings)
- [Sync between devices](#sync-between-devices)
- [Phone](#phone)
- [Files and export](#files-and-export)
- [Languages](#languages)
- [How data is stored](#how-data-is-stored)

## Notes

A note (node) has a **title**, a **type** (`note` by default; any short word, such as
`concept` or `person`), **markdown content**, **tags**, **links** and optional
**properties**.

- **Markdown editor** with three modes: _Edit_, _Split_ (editor and preview side by
  side) and _Preview_. The preview supports GitHub-flavoured markdown (tables, task
  lists, strikethrough).
- **Autosave.** Changes save as you type, into this device's copy; the header shows
  _Saved_, _Unsaved_, _Saving…_ or _Save failed_.
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
- **Local graph**: the note page also shows a small graph of the note and the notes up
  to 1, 2 or 3 links away (its own depth setting, remembered on the device). It arranges
  itself; click a dot to open that note. The panel folds away.
- Rename a link in place (double-click it on the graph, or use its menu), or delete it.
- Two notes can have several links between them, in either direction, and a note can
  link to itself. Each one is drawn separately.

## Wikilinks

Write `[[Title]]` in a note's content to point to another note, or `[[Title|other text]]`
to show different words. In the preview (and on the phone) it is a link to that note. A
wikilink is only a link in the text: it doesn't add a link to the graph.

- **Typing `[[`** suggests note titles; pick one to complete it.
- **Mentions are linked for you.** When you leave a note you edited, words in it that
  are another note's title become wikilinks (any case: `redis` becomes
  `[[Redis|redis]]`, so the text reads the same). Adding a note on the graph, or
  renaming one and leaving it, does the same in every other note that mentions it.
  Titles shorter than 3 letters, and titles with `[`, `]` or `|`, are never linked
  this way.
- **Renaming a note** rewrites `[[Old title]]` to `[[New title]]` in every other note,
  once you leave it (or the next time the app starts, if you closed it first). Not when
  another note has the old or the new title: those links may mean that one.
- Code, existing links, web and e-mail addresses and HTML are left alone, and so are
  words joined to others by `-` or `.` (`redis-cli`). Inside a table only an exact match
  is linked (`|` would split the cell). A `[[Title]]` that matches no
  note stays plain text.
- With two notes of the same title, a wikilink goes to the older one.

## Graph view

The home screen shows all notes as dots on a 2D canvas.

- **Dots arrange themselves.** Links pull the notes they join together, every dot pushes
  the others away, a light pull keeps the graph centred, and dots never overlap. Drag a
  dot and its neighbours follow; let go and the graph settles again. Nothing is saved
  as the graph moves, so it never counts as a change to push.
- **Or arrange them by hand**: turn _Arrange automatically_ off in the graph settings.
  Then dots stay where you put them and positions are saved; dragging a dot gently
  pushes nearby dots aside, and they settle back once you move on.
- **Size shows connections.** The best-linked note gets the biggest dot and the
  least-linked the smallest, so hubs stand out even in a small graph.
- **Colour shows type.** Plain notes are grey; each other type gets its own colour.
- **Or colour by tags** (an experiment, off by default, in the graph settings): the
  biggest dots (most links, or most EXP; you choose how many) take the mix of their
  tags' colours, and that colour spreads to the linked notes, fading with each step.
  Where two colours meet they blend, the nearer one counting more.
- **Hover a dot** to highlight it, its links and its neighbours, and to dim the rest.
- **Names hide when zoomed out** to keep the picture readable.
- Double-click a dot to open the note. Right-click a dot for _Open, Rename, Tags,
  Reveal in Graph, Copy Title, Copy Link, Delete_. Right-click a link for _Rename,
  Open either end, Delete_.
- A minimap, zoom controls and _Fit to screen_ (`Shift+1`).
- **Graph settings** (gear button): dot sizes, text size and strength of node and link
  names, line thickness, arrows on/off, wikilinks on/off (drawn as faint dashed lines:
  they don't pull dots together or change dot sizes, and none is drawn where a real link
  already joins the two notes), link names on/off, the forces (pull to the
  centre, push apart, link pull, link length), and, when arranging by hand, how strongly
  dragging pushes other dots. Changes apply immediately and are saved on that device.
- A **3D view** (`Shift+3`) is available as an experiment: you can look around, but it
  doesn't create links or save a layout.

## Tags and fields

One tag tree is shared by all notes, and a note can have any number of tags.

- **Tags page**: create tags, nest them by drag and drop, rename them, give a top-level
  tag a colour (the tags below it get shades of it), and move them to the top level.
- On a note, add tags by dragging them from the tag palette, from the _+ tag_ picker, or
  with `Alt+G`.

Every tag is also a **field of knowledge** with EXP and a level. The sidebar lists your
fields with a progress bar; parents include everything under them.

- A note adds EXP to each of its tags and their parent tags: a base amount, plus a
  bonus for longer content (capped, so padding doesn't pay), plus a bonus for its
  answered 5 Whys questions.
- Deeper 5 Whys answers are worth more: each level down earns twice the one above.
- Reaching a new level shows a short celebration.
- The numbers (EXP per note, bonuses, level thresholds) are set on the hub and handed to
  every device; see [INSTALL.md](INSTALL.md#fields-and-levels-table).

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

## Review today

Spaced repetition on its own tab (the stacked-cards icon, `Alt+3`), built around how
deeply you have dug into each note. The icon shows how many cards are due.

- **Dig deeper**: a note with few answered whys (fewer than 3, or none 3 levels deep)
  asks for another 5 Whys round. Notes with the least EXP come first.
- **Link these?**: two well-dug notes that aren't linked yet are suggested as a pair, to
  see whether they relate. The pairs change each day.
- Each day has at most 6 dig-deeper and 2 link cards. Cards you didn't get to stay
  first the next day; new ones only fill the free places. Once you have answered the
  day's cards, the tab says you're done for today.
- Answer a card with **Done** or **Again**. Done brings it back after 1, 3, 7, 14, 30, 60
  and then 120 days; Again starts it over (tomorrow). Linking a suggested pair, or
  digging a note deep enough, ends its card.

Review progress is part of your data, so it travels with push and pull. The phone app
only views, so it has no review tab.

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

| Action                                          | Shortcut                                               |
| ----------------------------------------------- | ------------------------------------------------------ |
| Command palette                                 | `F1`, `Ctrl+Shift+P`                                   |
| Go to note                                      | `Ctrl+P`                                               |
| New note                                        | `Alt+N`                                                |
| Rename note                                     | `F2`                                                   |
| Add link / add tag                              | `Alt+L` / `Alt+G`                                      |
| 5 Whys / copy its prompt                        | `Alt+W` / `Alt+Shift+W`                                |
| Copy link check prompt                          | `Alt+Shift+L`                                          |
| Next mode: edit, split, preview                 | `Alt+V` (or `Ctrl+K E` / `Ctrl+K V` / `Ctrl+K Ctrl+V`) |
| Save now (also stops the browser's _Save page_) | `Ctrl+S`                                               |
| Graph / Tags / Review                           | `Alt+1` / `Alt+2` / `Alt+3`                            |
| Fit graph, zoom in, zoom out                    | `Shift+1`, `=`, `-`                                    |
| Toggle sidebar                                  | `Ctrl+B`                                               |

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

There is one hub (a server on your network or on the internet), and every device
syncs with it **by hand**, like pushing to and pulling from a git remote.

- The hub keeps **numbered versions** of the whole graph. Each version records which
  device pushed it and when, and has a hash that identifies its content exactly.
- **Push** sends this device's copy to the hub as the newest version. **Pull** replaces
  this device's copy with the newest version.
- Editing changes only this device's copy. Nobody else sees it until you push, and
  nothing reaches you until you pull.
- Nothing is merged. Whoever pushes last makes the newest version; older versions stay
  in the hub's history.
- Nothing is overwritten without asking:
  - Pushing when the hub has a version this device hasn't pulled asks first.
  - Pulling over changes that were never pushed asks first.
- The **title bar** shows where this device stands: up to date, changes not pushed, a
  newer version on the hub, or offline. It checks the hub every minute and when the
  network comes back.
- When someone pushes and you start editing an older copy, you are warned once for
  that version, then left to work.
- Offline, everything works as usual; the title bar just says _Offline_.
- Closing the page with changes that were never pushed asks first.

A device connects once (_Sync…_ in the command palette, or _Sync_ in the title bar)
with the hub's address and a code from the hub's authenticator app. The level table
for fields comes from the hub, so EXP counts the same everywhere. Setting up the hub:
[INSTALL.md](INSTALL.md#the-hub).

## Phone

- **Browser**: open the hub's address and add it to the home screen. It's the full app
  with a touch-friendly layout, with its own copy like any other device.
- **Android app**: keeps a **read-only copy** of the graph on the phone, pulled from the
  hub, so you can read notes and follow links without a network or the PC. Pull again
  (title bar, _Sync_) for a newer version; the title bar says when the hub has one, and
  when the phone is offline. Nothing can be created, changed or deleted on the phone,
  and the hub never accepts a push from it. Editing tools such as 5 Whys and Link
  check are left out to keep it simple. Display settings for the graph have their own
  tab, and you can import a settings file there.

See [INSTALL.md](INSTALL.md#android-app).

## Files and export

In Chrome and Edge, from the command palette:

- **Save This Device's Copy to a File…** keeps the copy in a database file you pick
  (for example on another disk), written again after every change. Clearing the
  browser's data then loses nothing. After a restart, the browser asks once before it
  writes to the file again.
- **Open a Copy from a File…** makes such a file this device's copy.
- **Export Markdown…** writes one `.md` file per note into a folder you pick, with front
  matter (type, tags, properties, links as `[[wiki links]]`) and its 5 Whys sessions.
  Readable in Obsidian or any editor, without this app.

The app is open in one tab at a time: a second tab says so.

## Languages

The interface is in **English** and **Vietnamese** (command palette: _Change Display
Language_). It follows the browser's language until you pick one. The 5 Whys and Link
check prompts can be in either language, independently of the interface.

## How data is stored

- On each device: a SQLite database in the browser's private storage for this site (or
  in the Android app), plus the file on disk if you chose one. The app asks the browser
  to keep it rather than clear it when space runs low.
- On the hub: the versions devices pushed, in one SQLite file.
- Nothing is sent to outside services. The AI features only copy text to your clipboard
  for you to paste, and sync talks only to your hub.
- Records are never physically deleted: deletes are marked, and every change is
  timestamped.
