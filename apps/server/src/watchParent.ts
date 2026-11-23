/** True while a process with this pid exists (signal 0 only checks). */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Calls `onGone` once `pid` has exited. Used by the e2e test server: on
 * Windows, killing Playwright (closing the UI-mode window or terminal) does
 * not kill its web server, which then blocks the port for the next run.
 */
export function watchParent(
  pid: number,
  onGone: () => void,
  intervalMs = 1000,
  alive: (pid: number) => boolean = isAlive,
): () => void {
  const timer = setInterval(() => {
    if (alive(pid)) return;
    clearInterval(timer);
    onGone();
  }, intervalMs);
  timer.unref(); // never keeps the server alive by itself
  return () => {
    clearInterval(timer);
  };
}
