import type { CreateNodeData } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../database.js';
import { memoryDb } from '../testing/memoryDb.js';
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
  db = memoryDb();
  clock = 1_000;
  repos = createRepositories({ db, now: () => clock, newId: () => crypto.randomUUID() });
});
afterEach(() => {
  db.close();
});

const nodeData = (title: string, extra: Partial<CreateNodeData> = {}): CreateNodeData => ({
  type: 'note',
  title,
  content: '',
  props: {},
  position: null,
  tagIds: [],
  ...extra,
});

const raw = (table: string, id: string) =>
  db.prepare(`SELECT deleted_at, updated_at FROM ${table} WHERE id = ?`).get(id) as
    { deleted_at: number | null; updated_at: number } | undefined;

const rawLink = (table: 'node_tags', ownerId: string, tagId: string) =>
  db
    .prepare(`SELECT deleted_at, updated_at FROM ${table} WHERE node_id = ? AND tag_id = ?`)
    .get(ownerId, tagId) as { deleted_at: number | null; updated_at: number } | undefined;

describe('tombstones', () => {
  it('node delete cascades one shared ts to edges and tag links', () => {
    const tag = repos.tags.create({ name: 'T', parentId: null, color: null });
    const a = repos.nodes.create(nodeData('A', { tagIds: [tag.id] }));
    const b = repos.nodes.create(nodeData('B'));
    const edge = repos.edges.create({ fromId: b.id, toId: a.id, name: 'R', props: {} });

    clock = 5_000;
    repos.nodes.remove(a.id);

    const tomb = { deleted_at: 5_000, updated_at: 5_000 };
    expect(raw('nodes', a.id)).toEqual(tomb);
    expect(raw('edges', edge.id)).toEqual(tomb);
    expect(rawLink('node_tags', a.id, tag.id)).toEqual(tomb);
    expect(raw('nodes', b.id)?.deleted_at).toBeNull();
  });

  it('edge and tag deletes are soft; tag delete tombstones its links', () => {
    const n = repos.nodes.create(nodeData('N'));
    const edge = repos.edges.create({ fromId: n.id, toId: n.id, name: 'SELF', props: {} });
    const tag = repos.tags.create({ name: 'C', parentId: null, color: null });
    repos.nodes.attachTag(n.id, tag.id);

    clock = 9_000;
    repos.edges.remove(edge.id);
    repos.tags.remove(tag.id);

    expect(raw('edges', edge.id)?.deleted_at).toBe(9_000);
    expect(raw('tags', tag.id)?.deleted_at).toBe(9_000);
    expect(rawLink('node_tags', n.id, tag.id)?.deleted_at).toBe(9_000);
    expect(repos.nodes.get(n.id)?.tagIds).toEqual([]);
  });

  it('detach tombstones the link and re-attach revives the same row', () => {
    const n = repos.nodes.create(nodeData('N'));
    const tag = repos.tags.create({ name: 'T', parentId: null, color: null });

    repos.nodes.attachTag(n.id, tag.id);
    clock = 2_000;
    repos.nodes.detachTag(n.id, tag.id);
    expect(rawLink('node_tags', n.id, tag.id)).toEqual({ deleted_at: 2_000, updated_at: 2_000 });

    clock = 1_500; // clock went backwards
    expect(repos.nodes.attachTag(n.id, tag.id).tagIds).toEqual([tag.id]);
    expect(rawLink('node_tags', n.id, tag.id)).toEqual({ deleted_at: null, updated_at: 2_001 });
  });
});

describe('timestamps', () => {
  it('a detach is never older than the attach it undoes, even if the clock steps back', () => {
    const n = repos.nodes.create(nodeData('N'));
    const tag = repos.tags.create({ name: 'T', parentId: null, color: null });
    clock = 2_000;
    repos.nodes.attachTag(n.id, tag.id);
    clock = 1_500;
    repos.nodes.detachTag(n.id, tag.id);
    expect(rawLink('node_tags', n.id, tag.id)?.updated_at).toBe(2_001);
  });

  it('never exposes a deleted tag through a stale live link', () => {
    const n = repos.nodes.create(nodeData('N'));
    const tag = repos.tags.create({ name: 'T', parentId: null, color: null });
    repos.nodes.attachTag(n.id, tag.id);
    // Simulate a writer that tombstoned the tag but forgot the link.
    db.prepare('UPDATE tags SET deleted_at = 5 WHERE id = ?').run(tag.id);
    expect(repos.nodes.get(n.id)?.tagIds).toEqual([]);
  });

  it('never go backwards when the clock does', () => {
    const n = repos.nodes.create(nodeData('N'));
    clock = 500;
    const updated = repos.nodes.update(n.id, { title: 'N2' });
    expect(updated.updatedAt).toBe(n.updatedAt + 1);
  });

  it('a no-op patch writes nothing', () => {
    const n = repos.nodes.create(nodeData('N', { content: 'c', props: { a: 1 } }));
    clock = 2_000;
    expect(repos.nodes.update(n.id, { title: 'N', props: { a: 1 } }).updatedAt).toBe(n.updatedAt);
    expect(raw('nodes', n.id)?.updated_at).toBe(n.updatedAt);
  });

  it('moving a node only touches its layout row', () => {
    const n = repos.nodes.create(nodeData('N'));
    clock = 3_000;
    const moved = repos.nodes.update(n.id, { position: { x: 5, y: 6 } });
    expect(moved.position).toEqual({ x: 5, y: 6 });
    expect(moved.updatedAt).toBe(n.updatedAt);
    expect(db.prepare('SELECT updated_at FROM node_layouts WHERE node_id = ?').get(n.id)).toEqual({
      updated_at: 3_000,
    });
  });

  it('attaching a tag does not bump the owner (links have their own timestamps)', () => {
    const n = repos.nodes.create(nodeData('N'));
    const tag = repos.tags.create({ name: 'T', parentId: null, color: null });
    clock = 4_000;
    expect(repos.nodes.attachTag(n.id, tag.id).updatedAt).toBe(n.updatedAt);
  });
});
