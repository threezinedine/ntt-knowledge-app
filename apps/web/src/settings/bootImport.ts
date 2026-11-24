/**
 * Applies a settings import at start-up, before any settings store reads
 * localStorage: main.tsx imports this module first, and it imports nothing,
 * so it runs before them.
 *
 * Importing (SettingsTransfer.tsx) only stages the checked writes in
 * sessionStorage and reloads. If the reload is cancelled (a "leave site?"
 * prompt over unsaved edits), nothing has changed; a stale stage is dropped.
 */
export const PENDING_IMPORT_KEY = 'km.settings.pendingImport';
export const IMPORT_NOTE_KEY = 'km.settings.importNote';
/**
 * A stage older than this was from a reload that never happened. It is
 * stamped right before reloading, so this only has to cover the reload itself.
 */
const MAX_AGE_MS = 10_000;

export interface PendingImport {
  at: number;
  writes: [string, string][];
  note: { applied: number; skipped: string };
}

function applyPendingImport(): void {
  try {
    const raw = sessionStorage.getItem(PENDING_IMPORT_KEY);
    if (raw === null) return;
    sessionStorage.removeItem(PENDING_IMPORT_KEY);
    const pending = JSON.parse(raw) as PendingImport;
    if (Date.now() - pending.at > MAX_AGE_MS) return;
    for (const [key, value] of pending.writes) localStorage.setItem(key, value);
    sessionStorage.setItem(IMPORT_NOTE_KEY, JSON.stringify(pending.note));
  } catch {
    // Storage blocked or a broken stage: nothing to apply.
  }
}

applyPendingImport();
