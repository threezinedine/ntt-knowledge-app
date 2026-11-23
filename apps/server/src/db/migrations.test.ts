import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { migrate } from './database.js';
import { migrations } from './migrations.js';

/** A database exactly as a v1 build left it. */
function v1Database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(migrations[0] ?? '');
  db.exec('PRAGMA user_version = 1;');
  return db;
}

describe('migration 2: categories → shared tags', () => {
  it('keeps categories as tags and turns task.category_id into task_tags links', () => {
    const db = v1Database();
    db.exec(`
      INSERT INTO nodes (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'N', 1, 1);
      INSERT INTO task_categories (id, name, created_at, updated_at) VALUES ('c1', 'Work', 1, 1);
      INSERT INTO task_categories (id, name, parent_id, created_at, updated_at)
        VALUES ('c2', 'Backend', 'c1', 1, 1);
      INSERT INTO tasks (id, node_id, category_id, title, status, created_at, updated_at)
        VALUES ('t1', 'n1', 'c2', 'with cat', 'todo', 1, 7),
               ('t2', 'n1', NULL, 'no cat', 'done', 1, 1);
      INSERT INTO tasks (id, node_id, category_id, title, status, created_at, updated_at, deleted_at)
        VALUES ('t3', 'n1', 'c1', 'deleted', 'todo', 1, 1, 5);
    `);

    migrate(db);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: migrations.length });
    expect(db.prepare('SELECT id, name, parent_id FROM tags ORDER BY id').all()).toEqual([
      { id: 'c1', name: 'Work', parent_id: null },
      { id: 'c2', name: 'Backend', parent_id: 'c1' },
    ]);
    expect(db.prepare('SELECT id, title, status FROM tasks ORDER BY id').all()).toHaveLength(3);
    // Copied by migration 2 (then tombstoned by 4, which keeps the row).
    expect(db.prepare('SELECT task_id, tag_id FROM task_tags').all()).toEqual([
      { task_id: 't1', tag_id: 'c2' },
    ]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const taskColumns = (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(taskColumns).not.toContain('category_id');
    db.close();
  });

  it('still enforces sibling-name uniqueness on tags', () => {
    const db = v1Database();
    migrate(db);
    db.exec("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('a', 'Work', 1, 1)");
    expect(() => {
      db.exec("INSERT INTO tags (id, name, created_at, updated_at) VALUES ('b', 'work', 1, 1)");
    }).toThrow(/UNIQUE/);
    db.close();
  });
});

describe('migration 3: no live links to deleted tags', () => {
  it('tombstones a link copied from a task whose category was soft-deleted', () => {
    const db = v1Database();
    db.exec(`
      INSERT INTO nodes (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'N', 1, 1);
      INSERT INTO task_categories (id, name, created_at, updated_at, deleted_at)
        VALUES ('dead', 'Gone', 1, 9, 9);
      INSERT INTO tasks (id, node_id, category_id, title, status, created_at, updated_at)
        VALUES ('t1', 'n1', 'dead', 'orphaned', 'todo', 1, 3);
    `);

    migrate(db);

    expect(db.prepare('SELECT deleted_at, updated_at FROM task_tags').get()).toEqual({
      deleted_at: 9,
      updated_at: 9,
    });
    db.close();
  });
});

describe('migration 4: tasks are gone', () => {
  it('tombstones live tasks and task links, keeping the rows and older tombstones', () => {
    const db = v1Database();
    db.exec(`
      INSERT INTO nodes (id, type, title, created_at, updated_at) VALUES ('n1', 'note', 'N', 1, 1);
      INSERT INTO task_categories (id, name, created_at, updated_at) VALUES ('c1', 'Work', 1, 1);
      INSERT INTO tasks (id, node_id, category_id, title, status, created_at, updated_at)
        VALUES ('live', 'n1', 'c1', 'live', 'todo', 1, 3);
      INSERT INTO tasks (id, node_id, category_id, title, status, created_at, updated_at, deleted_at)
        VALUES ('old', 'n1', NULL, 'old', 'todo', 1, 5, 5);
    `);
    const before = Date.now();

    migrate(db);

    const rows = db.prepare('SELECT id, deleted_at, updated_at FROM tasks ORDER BY id').all() as {
      id: string;
      deleted_at: number;
      updated_at: number;
    }[];
    expect(rows.find((r) => r.id === 'old')).toEqual({ id: 'old', deleted_at: 5, updated_at: 5 });
    const live = rows.find((r) => r.id === 'live');
    expect(live?.deleted_at).toBeGreaterThanOrEqual(before - 1000);
    expect(live?.updated_at).toBe(live?.deleted_at);
    const link = db.prepare('SELECT deleted_at FROM task_tags').get() as { deleted_at: number };
    expect(link.deleted_at).toBeGreaterThanOrEqual(before - 1000);
    db.close();
  });
});

describe('migration 7: sessions rebuilt', () => {
  it('fixes a database where a draft migration 6 made sessions with identity columns', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON;');
    for (const sql of migrations.slice(0, 5)) db.exec(sql);
    // What the unreleased Google sign-in draft of 6 created on dev machines.
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL, deleted_at INTEGER
      ) STRICT;
      PRAGMA user_version = 6;
    `);

    migrate(db);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: migrations.length });
    // The insert that failed with "NOT NULL constraint failed: sessions.email".
    db.prepare(
      `INSERT INTO sessions (id, token_hash, expires_at, created_at, updated_at)
       VALUES ('s1', 'h', 2, 1, 1)`,
    ).run();
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual([
      'id',
      'token_hash',
      'expires_at',
      'created_at',
      'updated_at',
      'deleted_at',
    ]);
  });
});
