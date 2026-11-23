import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IN_MEMORY, openDatabase, type Database } from '../db/database.js';
import { createRepositories, type Repositories } from './index.js';

/**
 * Guards the sync contract from CLAUDE.md at the storage level: deletes are
 * tombstones (rows stay, `deleted_at = updated_at = ts`), cascades share one
 * ts, and timestamps never go backwards.
 */
let db: Database;
let repos: Repositories;
let clock: number;

beforeEach(() => {
  db = openDatabase(IN_MEMORY);
  clock = 1_000;
  repos = createRepositories({ db, now: () => clock, newId: () => crypto.randomUUID() });
});
afterEach(() => {
  db.close();
});

const raw = (table: string, id: string) =>
  db.prepare(`SELECT deleted_at, updated_at FROM ${table} WHERE id = ?`).get(id) as
    { deleted_at: number | null; updated_at: number } | undefined;

describe('tombstones', () => {
  it('node delete keeps rows and cascades one shared ts to edges and tasks', () => {
    const a = repos.nodes.create({
      type: 'note',
      title: 'A',
      content: '',
      props: {},
      position: null,
    });
    const b = repos.nodes.create({
      type: 'note',
      title: 'B',
      content: '',
      props: {},
      position: null,
    });
    const edge = repos.edges.create({ fromId: b.id, toId: a.id, name: 'R', props: {} });
    const task = repos.tasks.create({ nodeId: a.id, categoryId: null, title: 't', status: 'todo' });

    clock = 5_000;
    repos.nodes.remove(a.id);

    expect(raw('nodes', a.id)).toEqual({ deleted_at: 5_000, updated_at: 5_000 });
    expect(raw('edges', edge.id)).toEqual({ deleted_at: 5_000, updated_at: 5_000 });
    expect(raw('tasks', task.id)).toEqual({ deleted_at: 5_000, updated_at: 5_000 });
    expect(raw('nodes', b.id)?.deleted_at).toBeNull();
  });

  it('edge, task and category deletes are soft', () => {
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: '',
      props: {},
      position: null,
    });
    const edge = repos.edges.create({ fromId: n.id, toId: n.id, name: 'SELF', props: {} });
    const cat = repos.categories.create({ name: 'C', parentId: null, color: null });
    const task = repos.tasks.create({
      nodeId: n.id,
      categoryId: cat.id,
      title: 't',
      status: 'todo',
    });

    clock = 9_000;
    repos.edges.remove(edge.id);
    repos.categories.remove(cat.id);
    repos.tasks.remove(task.id);

    expect(raw('edges', edge.id)?.deleted_at).toBe(9_000);
    expect(raw('task_categories', cat.id)?.deleted_at).toBe(9_000);
    expect(raw('tasks', task.id)?.deleted_at).toBe(9_000);
  });

  it('category delete bumps updated_at on the tasks it detaches', () => {
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: '',
      props: {},
      position: null,
    });
    const cat = repos.categories.create({ name: 'C', parentId: null, color: null });
    const task = repos.tasks.create({
      nodeId: n.id,
      categoryId: cat.id,
      title: 't',
      status: 'todo',
    });

    clock = 7_000;
    repos.categories.remove(cat.id);
    expect(repos.tasks.get(task.id)).toMatchObject({ categoryId: null, updatedAt: 7_000 });
  });
});

describe('timestamps', () => {
  it('never go backwards when the clock does', () => {
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: '',
      props: {},
      position: null,
    });
    clock = 500; // clock stepped back
    const updated = repos.nodes.update(n.id, { title: 'N2' });
    expect(updated.updatedAt).toBe(n.updatedAt + 1);
  });

  it('a no-op patch writes nothing', () => {
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: 'c',
      props: { a: 1 },
      position: null,
    });
    clock = 2_000;
    expect(repos.nodes.update(n.id, { title: 'N', props: { a: 1 } }).updatedAt).toBe(n.updatedAt);
    expect(raw('nodes', n.id)?.updated_at).toBe(n.updatedAt);
  });

  it('moving a node only touches its layout row', () => {
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: '',
      props: {},
      position: null,
    });
    clock = 3_000;
    const moved = repos.nodes.update(n.id, { position: { x: 5, y: 6 } });
    expect(moved.position).toEqual({ x: 5, y: 6 });
    expect(moved.updatedAt).toBe(n.updatedAt);
    expect(db.prepare('SELECT updated_at FROM node_layouts WHERE node_id = ?').get(n.id)).toEqual({
      updated_at: 3_000,
    });
  });
});
