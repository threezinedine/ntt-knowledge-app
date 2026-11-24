import { useSyncExternalStore } from 'react';
import { exportDatabase, onBeforeReload, onDataChanged } from '../../local/engine';

/**
 * Keeps a copy of this device's database in a file the user picked on disk
 * (File System Access API: Chrome and Edge), so clearing the browser's data
 * doesn't lose what wasn't pushed. Written a moment after every change.
 *
 * The file handle is remembered (IndexedDB); after a reload the browser asks
 * again before writing, which needs a click: until then saving is "paused".
 */

type Handle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export interface DiskFileState {
  /** The file's name, or null when none is chosen. */
  name: string | null;
  /** Chosen, but the browser wants a click before writing again. */
  paused: boolean;
  /** The last write failed. */
  error: boolean;
}

export const diskFileSupported = (): boolean =>
  typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';

let state: DiskFileState = { name: null, paused: false, error: false };
let handle: Handle | null = null;
const listeners = new Set<() => void>();
const set = (next: Partial<DiskFileState>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

export const useDiskFile = (): DiskFileState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

// --- the remembered handle (IndexedDB: handles can't go to localStorage) ---
const DB = 'km-local-file';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB'));
    };
  });
}
async function kv<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction('kv', mode).objectStore('kv'));
      req.onsuccess = () => {
        resolve(req.result as T);
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB'));
      };
    });
  } finally {
    db.close();
  }
}

// Writes run one after another, and a change during one queues one more:
// the file always ends with the newest data.
let writing: Promise<void> = Promise.resolve();
let dirty = false;
function write(): Promise<void> {
  dirty = true;
  writing = writing.then(async () => {
    if (!dirty) return;
    dirty = false;
    await writeNow();
  });
  return writing;
}

async function writeNow(): Promise<void> {
  if (!handle || state.paused) return;
  try {
    const bytes = await exportDatabase();
    const out = await handle.createWritable();
    await out.write(bytes as Uint8Array<ArrayBuffer>);
    await out.close();
    if (state.error) set({ error: false });
  } catch {
    set({ error: true });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

/** Restores the remembered file (once, at start) and saves after every change. */
export function startDiskFile(): void {
  if (started || !diskFileSupported()) return;
  started = true;
  onDataChanged(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void write(), 1_500);
  });
  // A reload (after a pull, an opened file) mustn't drop the write waiting above.
  onBeforeReload(async () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    await write();
  });
  void kv<Handle | undefined>('readonly', (s) => s.get('handle'))
    .then(async (saved) => {
      if (!saved) return;
      handle = saved;
      const permission = (await saved.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
      set({ name: saved.name, paused: permission !== 'granted' });
    })
    .catch(() => undefined);
}

/** Picks the file to save to (a click), then writes this device's copy into it. */
export async function chooseDiskFile(): Promise<string | null> {
  const pick = (
    window as unknown as {
      showSaveFilePicker: (o: object) => Promise<Handle>;
    }
  ).showSaveFilePicker;
  let picked: Handle;
  try {
    picked = await pick({
      suggestedName: 'knowledge-manager.sqlite',
      types: [{ description: 'SQLite database', accept: { 'application/x-sqlite3': ['.sqlite'] } }],
    });
  } catch {
    return null; // cancelled
  }
  handle = picked;
  await kv('readwrite', (s) => s.put(picked, 'handle')).catch(() => undefined);
  set({ name: picked.name, paused: false, error: false });
  await write();
  return picked.name;
}

/** After a reload: the click that lets the browser write to the file again. */
export async function resumeDiskFile(): Promise<void> {
  if (!handle) return;
  const permission = (await handle.requestPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (permission !== 'granted') return;
  set({ paused: false });
  await write();
}

export async function forgetDiskFile(): Promise<void> {
  handle = null;
  await kv('readwrite', (s) => s.delete('handle')).catch(() => undefined);
  set({ name: null, paused: false, error: false });
}

/** Reads a database file the user picks (to open it as this device's copy). */
export async function pickDatabaseFile(): Promise<Uint8Array | null> {
  const pick = (
    window as unknown as {
      showOpenFilePicker?: (o: object) => Promise<FileSystemFileHandle[]>;
    }
  ).showOpenFilePicker;
  if (!pick) return null;
  try {
    const [file] = await pick({
      types: [{ description: 'SQLite database', accept: { 'application/x-sqlite3': ['.sqlite'] } }],
    });
    if (!file) return null;
    return new Uint8Array(await (await file.getFile()).arrayBuffer());
  } catch {
    return null;
  }
}

/** Writes markdown files into a folder the user picks; false if cancelled or unsupported. */
export async function writeToFolder(
  files: { name: string; content: string }[],
): Promise<string | null> {
  const pick = (
    window as unknown as {
      showDirectoryPicker?: (o: object) => Promise<FileSystemDirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (!pick) return null;
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await pick({ mode: 'readwrite' });
  } catch {
    return null;
  }
  // A folder of its own each time: never over notes already in the picked folder
  // (an Obsidian vault, say), and no stale notes of deleted nodes mixed in.
  const name = `km-export-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const target = await dir.getDirectoryHandle(name, { create: true });
  for (const f of files) {
    const out = await (await target.getFileHandle(f.name, { create: true })).createWritable();
    await out.write(f.content);
    await out.close();
  }
  return `${dir.name}/${name}`;
}
