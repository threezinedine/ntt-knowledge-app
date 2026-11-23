import { matchingStep } from './totp.js';

/** Wrong codes in a row before a short pause (typos, a fumbled phone). */
export const MAX_CONSECUTIVE = 5;
export const PAUSE_MS = 60_000;
/** Wrong codes allowed per rolling 24 hours, whatever happens in between. */
export const DAILY_BUDGET = 10;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type LoginCheck =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'reused' }
  | { ok: false; reason: 'locked'; retryAfterMs: number };

/**
 * Checks authenticator codes for the one account this server has.
 *
 * A 6-digit code is the only factor, and only a million wide with three valid
 * at a time (3 in 10^6 per guess). So wrong codes are budgeted:
 *  - DAILY_BUDGET per rolling 24 h, not reset by a successful sign-in. That
 *    caps an online guesser at 3,650 guesses a year: about a 1% chance a year
 *    of a hit, on a server reachable from outside.
 *  - MAX_CONSECUTIVE in a row also pause sign-in for a minute.
 * While locked, every code is refused, right or wrong (otherwise guessing
 * would simply go on). The lock is global, not per IP: one owner, and an
 * attacker can't dodge it by switching addresses. The price: someone who can
 * reach the server can keep the owner from signing in (an existing session
 * still works). The state is in memory, so restarting the server, which needs
 * access to the machine, clears it.
 *
 * Each code works once: a step at or before the last one used is refused
 * (as `reused`, which doesn't count as a guess: it is a right code, e.g. the
 * same one typed on a second device).
 */
export class LoginGuard {
  private consecutive = 0;
  private pausedUntil = 0;
  /** Times of wrong codes in the last 24 h (oldest first). */
  private failures: number[] = [];
  private lastStep = -Infinity;

  constructor(
    private readonly secret: Buffer,
    private readonly now: () => number,
    /** The code check itself (tests count calls through it). */
    private readonly match: typeof matchingStep = matchingStep,
  ) {}

  check(code: string): LoginCheck {
    const t = this.now();
    this.failures = this.failures.filter((at) => at > t - DAY_MS);
    const locked = this.lockedFor(t);
    if (locked > 0) return { ok: false, reason: 'locked', retryAfterMs: locked };

    const step = this.match(this.secret, code, t);
    if (step !== null && step > this.lastStep) {
      this.lastStep = step;
      this.consecutive = 0;
      return { ok: true };
    }
    if (step !== null) return { ok: false, reason: 'reused' };

    this.failures.push(t);
    this.consecutive++;
    if (this.consecutive >= MAX_CONSECUTIVE) {
      this.consecutive = 0;
      this.pausedUntil = t + PAUSE_MS;
    }
    const now = this.lockedFor(t);
    return now > 0
      ? { ok: false, reason: 'locked', retryAfterMs: now }
      : { ok: false, reason: 'invalid' };
  }

  /** How long sign-in stays locked from `t` (0 = open). */
  private lockedFor(t: number): number {
    const pause = Math.max(0, this.pausedUntil - t);
    const oldest = this.failures[0];
    const budget =
      this.failures.length >= DAILY_BUDGET && oldest !== undefined ? oldest + DAY_MS - t : 0;
    return Math.max(pause, budget);
  }
}
