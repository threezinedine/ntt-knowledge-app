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
];
