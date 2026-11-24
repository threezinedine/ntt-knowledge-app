/**
 * Messages between the page and the engine Worker (local/worker.ts), which
 * keeps this device's copy of the graph.
 */
export type Storage =
  /** A database file in this site's private file system (OPFS): it survives reloads. */
  | 'file'
  /** Only in memory: OPFS isn't available here (e.g. a private window). Gone on reload. */
  | 'memory'
  /** The file is held by another tab of this app. */
  | 'busy';

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  /** Set when there was no HTTP answer at all. */
  error?: string;
}

export type ToWorker =
  | { type: 'init'; readOnly: boolean; suggestedName: string }
  | { type: 'request'; id: number; method: string; path: string; body: unknown }
  | { type: 'export'; id: number }
  | { type: 'import'; id: number; bytes: Uint8Array }
  | { type: 'markdown'; id: number }
  | { type: 'fetchResult'; id: number; result: FetchResult };

export type FromWorker =
  | { type: 'ready'; storage: Storage }
  | { type: 'response'; id: number; status: number; body: unknown }
  | { type: 'exported'; id: number; bytes?: Uint8Array; error?: string }
  | { type: 'imported'; id: number; error?: string }
  | { type: 'markdownFiles'; id: number; files: { name: string; content: string }[] }
  /** The Worker asks the page to fetch (the phone app's native HTTP lives there). */
  | { type: 'fetch'; id: number; url: string; init: FetchInit }
  /** Data changed (a write went through): the page mirrors it to a file on disk. */
  | { type: 'changed' };
