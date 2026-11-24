/**
 * Ordered, append-only schema migrations. NEVER edit a migration once it has
 * shipped; add a new one instead. `PRAGMA user_version` tracks the applied count.
 *
 * Conventions (keep these when adding tables — they make future sync possible):
 *  - `id TEXT PRIMARY KEY` holding a UUIDv7
 *  - `created_at` / `updated_at` as INTEGER epoch ms
 *  - `deleted_at` tombstone instead of hard deletes
 *  - JSON columns guarded by `CHECK (json_valid(...))`
 */
export const migrations: readonly string[] = [
  /* 1: initial graph + tasks schema */ `
  CREATE TABLE nodes (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL DEFAULT '',
    props       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  CREATE INDEX nodes_live_title ON nodes (title COLLATE NOCASE) WHERE deleted_at IS NULL;
  CREATE INDEX nodes_live_type ON nodes (type) WHERE deleted_at IS NULL;
  CREATE INDEX nodes_live_updated ON nodes (updated_at DESC) WHERE deleted_at IS NULL;

  -- Canvas layout is kept apart from content: dragging a node must not look like
  -- an edit (list ordering, future last-writer-wins sync). Clearing = NULL coords.
  CREATE TABLE node_layouts (
    node_id     TEXT PRIMARY KEY REFERENCES nodes (id),
    pos_x       REAL,
    pos_y       REAL,
    updated_at  INTEGER NOT NULL,
    CHECK ((pos_x IS NULL) = (pos_y IS NULL))
  ) STRICT;

  CREATE TABLE edges (
    id          TEXT PRIMARY KEY,
    from_id     TEXT NOT NULL REFERENCES nodes (id),
    to_id       TEXT NOT NULL REFERENCES nodes (id),
    name        TEXT NOT NULL,
    props       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(props)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  -- One live edge per (from, to, relation); parallel edges must differ by name.
  CREATE UNIQUE INDEX edges_live_unique ON edges (from_id, to_id, name) WHERE deleted_at IS NULL;
  CREATE INDEX edges_live_from ON edges (from_id) WHERE deleted_at IS NULL;
  CREATE INDEX edges_live_to ON edges (to_id) WHERE deleted_at IS NULL;

  CREATE TABLE task_categories (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    parent_id   TEXT REFERENCES task_categories (id),
    color       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  CREATE INDEX task_categories_live_parent ON task_categories (parent_id) WHERE deleted_at IS NULL;
  -- Sibling names are unique (case-insensitive) so pickers never show twins.
  CREATE UNIQUE INDEX task_categories_live_sibling_name
    ON task_categories (COALESCE(parent_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;

  CREATE TABLE tasks (
    id            TEXT PRIMARY KEY,
    node_id       TEXT NOT NULL REFERENCES nodes (id),
    category_id   TEXT REFERENCES task_categories (id),
    title         TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
    completed_at  INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER
  ) STRICT;
  CREATE INDEX tasks_live_node ON tasks (node_id) WHERE deleted_at IS NULL;
  CREATE INDEX tasks_live_category ON tasks (category_id) WHERE deleted_at IS NULL;
  `,

  /* 2: categories become a shared tag tree; nodes and tasks get many tags */ `
  ALTER TABLE task_categories RENAME TO tags;
  DROP INDEX task_categories_live_parent;
  DROP INDEX task_categories_live_sibling_name;
  CREATE INDEX tags_live_parent ON tags (parent_id) WHERE deleted_at IS NULL;
  CREATE UNIQUE INDEX tags_live_sibling_name
    ON tags (COALESCE(parent_id, ''), name COLLATE NOCASE) WHERE deleted_at IS NULL;

  -- Rebuild tasks without the single category_id (SQLite can't drop an FK column).
  CREATE TABLE tasks_v2 (
    id            TEXT PRIMARY KEY,
    node_id       TEXT NOT NULL REFERENCES nodes (id),
    title         TEXT NOT NULL,
    status        TEXT NOT NULL CHECK (status IN ('todo', 'doing', 'done')),
    completed_at  INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    deleted_at    INTEGER
  ) STRICT;
  INSERT INTO tasks_v2 (id, node_id, title, status, completed_at, created_at, updated_at, deleted_at)
    SELECT id, node_id, title, status, completed_at, created_at, updated_at, deleted_at FROM tasks;

  -- Link tables: one row per (owner, tag); detaching tombstones the row,
  -- re-attaching revives it. Own updated_at so links sync independently.
  CREATE TABLE task_tags (
    task_id     TEXT NOT NULL REFERENCES tasks_v2 (id),
    tag_id      TEXT NOT NULL REFERENCES tags (id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    PRIMARY KEY (task_id, tag_id)
  ) STRICT, WITHOUT ROWID;
  INSERT INTO task_tags (task_id, tag_id, created_at, updated_at)
    SELECT id, category_id, updated_at, updated_at FROM tasks
     WHERE category_id IS NOT NULL AND deleted_at IS NULL;

  DROP TABLE tasks;
  ALTER TABLE tasks_v2 RENAME TO tasks; -- also rewrites task_tags' FK to "tasks"
  CREATE INDEX tasks_live_node ON tasks (node_id) WHERE deleted_at IS NULL;
  CREATE INDEX task_tags_live_tag ON task_tags (tag_id) WHERE deleted_at IS NULL;

  CREATE TABLE node_tags (
    node_id     TEXT NOT NULL REFERENCES nodes (id),
    tag_id      TEXT NOT NULL REFERENCES tags (id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER,
    PRIMARY KEY (node_id, tag_id)
  ) STRICT, WITHOUT ROWID;
  CREATE INDEX node_tags_live_tag ON node_tags (tag_id) WHERE deleted_at IS NULL;
  `,

  /* 3: tombstone links that point at deleted tags (e.g. copied by migration 2
        from a task whose category had been soft-deleted) */ `
  UPDATE task_tags
     SET deleted_at = (SELECT deleted_at FROM tags WHERE tags.id = task_tags.tag_id),
         updated_at = MAX(updated_at + 1, (SELECT deleted_at FROM tags WHERE tags.id = task_tags.tag_id))
   WHERE deleted_at IS NULL
     AND tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL);
  UPDATE node_tags
     SET deleted_at = (SELECT deleted_at FROM tags WHERE tags.id = node_tags.tag_id),
         updated_at = MAX(updated_at + 1, (SELECT deleted_at FROM tags WHERE tags.id = node_tags.tag_id))
   WHERE deleted_at IS NULL
     AND tag_id IN (SELECT id FROM tags WHERE deleted_at IS NOT NULL);
  `,

  /* 4: tasks are gone (nodes are knowledge; EXP comes from them): tombstone
        every live task and task tag link. Tables stay (append-only history). */ `
  UPDATE task_tags
     SET deleted_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
         updated_at = MAX(updated_at + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER))
   WHERE deleted_at IS NULL;
  UPDATE tasks
     SET deleted_at = CAST(unixepoch('subsec') * 1000 AS INTEGER),
         updated_at = MAX(updated_at + 1, CAST(unixepoch('subsec') * 1000 AS INTEGER))
   WHERE deleted_at IS NULL;
  `,

  /* 5: cached word count of `content` for EXP, so /api/exp needn't read every
        note. NULL = not counted yet; the app fills it in at startup. Derived
        data: writing it never bumps updated_at. */ `
  ALTER TABLE nodes ADD COLUMN content_words INTEGER;
  `,

  /* 6: sign-in sessions (authenticator-app code). Only a SHA-256 of the
        cookie token is stored, so a copy of the database can't be used to
        sign in. Signing out tombstones the row; expired rows stop matching.
        Device-local secret state: NEVER include this table in any sync. */ `
  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  `,

  /* 7: sessions again. An unreleased draft of 6 created this table with
        sign-in identity columns (email NOT NULL, …) on some dev databases,
        and 6 can't change once applied. Sessions are disposable (worst case:
        sign in again), so rebuild the table in its final shape everywhere. */ `
  DROP TABLE IF EXISTS sessions;
  CREATE TABLE sessions (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  `,

  /* 8: read-only sessions (the phone app): every write is refused. */ `
  ALTER TABLE sessions ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1));
  `,

  /* 9: "5 Whys" critique sessions per node. The tree of whys is one JSON
        column (validated by @km/core on the way in); each why carries its own
        id inside it. Deleting the node tombstones its sessions. */ `
  CREATE TABLE why_sessions (
    id          TEXT PRIMARY KEY,
    node_id     TEXT NOT NULL REFERENCES nodes (id),
    summary     TEXT NOT NULL DEFAULT '',
    conclusion  TEXT NOT NULL DEFAULT '',
    whys        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(whys)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  CREATE INDEX why_sessions_live_node ON why_sessions (node_id) WHERE deleted_at IS NULL;
  `,

  /* 10: sync through a hub (see @km/core sync.ts).
        sync_state: this device's link to a hub (one row at most). The token is
        a secret the device sends to the hub: device-local, never synced, and
        left out of backups.
        hub_devices / hub_versions: only used on a hub (KM_HUB=on). Devices
        store a SHA-256 of their token, like sessions. A version is a whole
        snapshot (gzipped canonical JSON); numbers only grow. */ `
  CREATE TABLE sync_state (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    hub_url             TEXT NOT NULL,
    device_name         TEXT NOT NULL,
    token               TEXT NOT NULL,
    version             INTEGER,
    hash                TEXT,
    version_created_at  INTEGER,
    version_device      TEXT,
    updated_at          INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE hub_devices (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    token_hash  TEXT NOT NULL UNIQUE,
    read_only   INTEGER NOT NULL CHECK (read_only IN (0, 1)),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted_at  INTEGER
  ) STRICT;
  CREATE TABLE hub_versions (
    version       INTEGER PRIMARY KEY,
    hash          TEXT NOT NULL,
    base_version  INTEGER,
    device_id     TEXT NOT NULL,
    device_name   TEXT NOT NULL,
    format        TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    snapshot      BLOB NOT NULL,
    created_at    INTEGER NOT NULL
  ) STRICT;
  `,

  /* 11: device-local settings of the engine (the hub's level table, saved at
        connect and pull). Never synced: each device keeps its own. */ `
  CREATE TABLE device_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
  ) STRICT;
  `,
];
