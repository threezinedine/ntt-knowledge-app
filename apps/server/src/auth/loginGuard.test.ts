import { describe, expect, it } from 'vitest';
import { DAILY_BUDGET, DAY_MS, LoginGuard, MAX_CONSECUTIVE, PAUSE_MS } from './loginGuard.js';
import { hotp, stepAt } from './totp.js';

const SECRET = Buffer.from('12345678901234567890');

function setup() {
  let clock = 1_700_000_000_000;
  const guard = new LoginGuard(SECRET, () => clock);
  const right = () => hotp(SECRET, stepAt(clock));
  const wrong = () => (right() === '000000' ? '111111' : '000000');
  return {
    guard,
    right,
    wrong,
    tick: (ms: number) => {
      clock += ms;
    },
  };
}

describe('LoginGuard', () => {
  it('lets the right code in, once', () => {
    const { guard, right } = setup();
    const code = right();
    expect(guard.check(code)).toEqual({ ok: true });
    expect(guard.check(code)).toEqual({ ok: false, reason: 'reused' });
  });

  it('a reused right code is not counted as a guess', () => {
    const { guard, right, tick } = setup();
    const code = right();
    guard.check(code);
    for (let i = 0; i < DAILY_BUDGET * 2; i++) expect(guard.check(code).ok).toBe(false);
    tick(30_000);
    expect(guard.check(right())).toEqual({ ok: true }); // never locked
  });

  it(`pauses a minute after ${String(MAX_CONSECUTIVE)} wrong codes in a row, refusing even the right one`, () => {
    const { guard, right, wrong, tick } = setup();
    for (let i = 1; i < MAX_CONSECUTIVE; i++) {
      expect(guard.check(wrong())).toEqual({ ok: false, reason: 'invalid' });
    }
    expect(guard.check(wrong())).toEqual({ ok: false, reason: 'locked', retryAfterMs: PAUSE_MS });
    expect(guard.check(right())).toMatchObject({ reason: 'locked' });
    tick(PAUSE_MS);
    expect(guard.check(right())).toEqual({ ok: true });
  });

  it(`allows ${String(DAILY_BUDGET)} wrong codes per 24 h, and signing in doesn't reset that`, () => {
    const { guard, right, wrong, tick } = setup();
    const burn = (n: number) => {
      for (let i = 0; i < n; i++) {
        guard.check(wrong());
        tick(PAUSE_MS); // past any short pause
      }
    };
    burn(DAILY_BUDGET - 1);
    expect(guard.check(right())).toEqual({ ok: true }); // the owner signs in meanwhile
    tick(30_000);
    expect(guard.check(wrong())).toMatchObject({ ok: false, reason: 'locked' }); // budget spent

    const locked = guard.check(right());
    expect(locked).toMatchObject({ ok: false, reason: 'locked' });
    // Until the first of those failures is 24 h old.
    const wait = locked.ok || locked.reason !== 'locked' ? 0 : locked.retryAfterMs;
    expect(wait).toBeGreaterThan(DAY_MS - DAILY_BUDGET * PAUSE_MS - 60_000);
    tick(wait);
    expect(guard.check(right())).toEqual({ ok: true });
  });

  it('a guesser hammering all week gets DAILY_BUDGET codes checked a day (~1% a year)', () => {
    let clock = 1_700_000_000_000;
    let checked = 0; // codes the guard actually compared against the secret
    const guard = new LoginGuard(
      SECRET,
      () => clock,
      () => {
        checked++;
        return null; // every guess wrong
      },
    );
    for (let i = 0; i < 24 * 7 * 100; i++) {
      guard.check('000000');
      clock += 36_000; // 100 tries an hour
    }
    expect(checked).toBeLessThanOrEqual(DAILY_BUDGET * 7);
    expect(checked).toBeGreaterThanOrEqual(DAILY_BUDGET * 6);
    // 10 a day for a year at 3-in-a-million: about 1%.
    expect(1 - (1 - 3e-6) ** (DAILY_BUDGET * 365)).toBeLessThan(0.012);
  });
});
