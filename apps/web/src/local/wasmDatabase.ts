import type { Database, SqlParams, SqlStatement, SqlValue } from '@km/engine';
import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

type Oo1Db = InstanceType<Sqlite3Static['oo1']['DB']>;
type Stmt = ReturnType<Oo1Db['prepare']>;

interface Capi {
  sqlite3_get_autocommit(db: unknown): number;
  sqlite3_bind_parameter_count(stmt: unknown): number;
  sqlite3_bind_parameter_name(stmt: unknown, i: number): string | null;
}

const isNamed = (v: unknown): v is SqlParams =>
  v !== null && typeof v === 'object' && !(v instanceof Uint8Array);

/**
 * node:sqlite's surface (what @km/engine needs) over SQLite WebAssembly, so
 * the same repositories run in the browser. Named parameters are given
 * without their ':' as in node:sqlite; only the names a statement uses are
 * bound.
 */
export function wasmDatabase(sqlite3: Sqlite3Static, db: Oo1Db): Database {
  const capi = sqlite3.capi as unknown as Capi;
  // One compiled statement per SQL text: repositories prepare some SQL per
  // call (node:sqlite frees those itself; WebAssembly memory would not).
  const cache = new Map<string, SqlStatement>();
  const statements: Stmt[] = [];

  const prepare = (sql: string): SqlStatement => {
    const cached = cache.get(sql);
    if (cached) return cached;
    const stmt = db.prepare(sql);
    statements.push(stmt);
    const names: string[] = [];
    const count = capi.sqlite3_bind_parameter_count(stmt.pointer);
    for (let i = 1; i <= count; i++)
      names.push(capi.sqlite3_bind_parameter_name(stmt.pointer, i) ?? '');

    const bind = (params: (SqlValue | SqlParams)[]) => {
      stmt.reset(true);
      if (count === 0 || params.length === 0) return;
      const [first, ...rest] = params;
      if (isNamed(first)) {
        // Like node:sqlite: unknown names are an error, and no mixing with positional values.
        if (rest.length > 0) throw new Error('Named and positional parameters together');
        const named: Record<string, SqlValue> = {};
        for (const key of Object.keys(first)) {
          const name = names.find((n) => n.slice(1) === key);
          if (name === undefined) throw new Error(`Unknown named parameter '${key}'`);
          named[name] = first[key] ?? null;
        }
        stmt.bind(named);
      } else {
        stmt.bind(params as SqlValue[]);
      }
    };
    const row = (): Record<string, SqlValue> => stmt.get({}) as Record<string, SqlValue>;

    const statement = {
      run(...params: (SqlValue | SqlParams)[]) {
        bind(params);
        try {
          while (stmt.step()) {
            // Drain (a RETURNING clause, a PRAGMA): run() ignores rows.
          }
        } finally {
          stmt.reset();
        }
        return { changes: db.changes() };
      },
      get(...params: (SqlValue | SqlParams)[]) {
        bind(params);
        try {
          return stmt.step() ? row() : undefined;
        } finally {
          stmt.reset();
        }
      },
      all(...params: (SqlValue | SqlParams)[]) {
        bind(params);
        const out: Record<string, SqlValue>[] = [];
        try {
          while (stmt.step()) out.push(row());
        } finally {
          stmt.reset();
        }
        return out;
      },
    };
    cache.set(sql, statement);
    return statement;
  };

  return {
    prepare,
    exec(sql: string) {
      db.exec(sql);
    },
    get isTransaction() {
      return capi.sqlite3_get_autocommit(db.pointer) === 0;
    },
    close() {
      for (const s of statements) s.finalize();
      statements.length = 0;
      cache.clear();
      db.close();
    },
  };
}
