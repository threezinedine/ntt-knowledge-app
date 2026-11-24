import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../database.js';
import { memoryDb } from '../testing/memoryDb.js';
import { backfillContentWords } from './expRepository.js';
import { createRepositories } from './index.js';

let db: Database;
beforeEach(() => {
  db = memoryDb();
});
afterEach(() => {
  db.close();
});

const words = (id: string) =>
  db.prepare('SELECT content_words, updated_at FROM nodes WHERE id = ?').get(id) as {
    content_words: number | null;
    updated_at: number;
  };

describe('5 Whys inputs', () => {
  // (Not-JSON can't happen: the column has CHECK json_valid.)
  it('skips a session whose tree has the wrong shape instead of failing', () => {
    const repos = createRepositories({ db, now: () => 10, newId: () => crypto.randomUUID() });
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: '',
      props: {},
      position: null,
      tagIds: [],
    });
    const insert = db.prepare(
      `INSERT INTO why_sessions (id, node_id, summary, conclusion, whys, created_at, updated_at)
       VALUES (?, ?, '', '', ?, 1, 1)`,
    );
    insert.run(crypto.randomUUID(), n.id, '[{"question": 1}]');
    insert.run(
      crypto.randomUUID(),
      n.id,
      JSON.stringify([
        { id: crypto.randomUUID(), question: 'Q', answer: 'A', takeaway: '', children: [] },
      ]),
    );
    expect(repos.exp.inputs().nodes).toEqual([{ words: 0, tagIds: [], whyDepths: [1] }]);
  });
});

describe('content_words cache', () => {
  it('is backfilled once for rows written before it existed, without bumping updated_at', () => {
    db.exec(`INSERT INTO nodes (id, type, title, content, created_at, updated_at)
             VALUES ('old', 'note', 'Old', 'một hai ba four', 1, 5)`);
    expect(words('old')).toEqual({ content_words: null, updated_at: 5 });

    createRepositories({ db, now: () => 10, newId: () => crypto.randomUUID() });
    expect(words('old')).toEqual({ content_words: 4, updated_at: 5 });
    expect(backfillContentWords(db)).toBe(0); // nothing left to do
  });

  it('follows content on create and update, and survives renames', () => {
    const repos = createRepositories({ db, now: () => 10, newId: () => crypto.randomUUID() });
    const n = repos.nodes.create({
      type: 'note',
      title: 'N',
      content: 'a b',
      props: {},
      position: null,
      tagIds: [],
    });
    expect(words(n.id).content_words).toBe(2);
    repos.nodes.update(n.id, { content: 'a b c d e' });
    expect(words(n.id).content_words).toBe(5);
    repos.nodes.update(n.id, { title: 'Renamed' });
    expect(words(n.id).content_words).toBe(5);
  });
});
