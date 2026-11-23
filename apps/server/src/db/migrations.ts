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
];
