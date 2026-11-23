import type { AuthStatus } from '@km/core';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The e2e server runs with KM_AUTH=off (no authenticator in tests). These specs
// stand in for a server with sign-in on by answering /api/auth/* themselves;
// the server side (codes, lockout, sessions) is covered by
// apps/server/src/http/auth.test.ts.

const IN: AuthStatus = { enabled: true, signedIn: true, expiresAt: Date.now() + 3_600_000 };
const OUT: AuthStatus = { enabled: true, signedIn: false, expiresAt: null };

/** A fake sign-in server: `GOOD` is the only right code. */
async function fakeAuth(page: Page, start: AuthStatus) {
  const state = { status: start, codes: [] as string[] };
  await page.route('/api/auth/status', (r) => r.fulfill({ json: state.status }));
  await page.route('/api/auth/login', async (r) => {
    const { code } = r.request().postDataJSON() as { code: string };
    state.codes.push(code);
    if (code === GOOD) {
      state.status = IN;
      return r.fulfill({ json: IN });
    }
    if (code === LOCKED) {
      return r.fulfill({
        status: 429,
        json: {
          error: {
            code: 'TOO_MANY_REQUESTS',
            reason: 'LOCKED_OUT',
            message: 'locked',
            details: { retryAfterMs: 120_000 },
          },
        },
      });
    }
    return r.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHORIZED', reason: 'CODE_INVALID', message: 'wrong' } },
    });
  });
  await page.route('/api/auth/logout', (r) => {
    state.status = OUT;
    return r.fulfill({ status: 204 });
  });
  return state;
}
const GOOD = '246810';
const LOCKED = '999999';
const codeBox = (page: Page) => page.getByRole('textbox', { name: '6-digit code' });

test.describe('sign-in with an authenticator code', () => {
  test('signed out: the code page; six digits sign in without pressing Enter', async ({ page }) => {
    const auth = await fakeAuth(page, OUT);
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toHaveCount(0);
    await codeBox(page).fill(GOOD);
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toBeVisible();
    expect(auth.codes).toEqual([GOOD]);
  });

  test('a wrong code says so and clears the box; a lockout says how long', async ({ page }) => {
    await fakeAuth(page, OUT);
    await page.goto('/');
    await codeBox(page).fill('123456');
    await expect(page.getByRole('alert')).toHaveText(
      'Wrong or expired code. Use the one the app shows now.',
    );
    await expect(codeBox(page)).toHaveValue('');
    await codeBox(page).fill(LOCKED);
    await expect(page.getByRole('alert')).toHaveText('Too many wrong codes. Try again in 2 min.');
  });

  test('when the session ends mid-edit, a box asks for a code and the edit survives', async ({
    page,
    api,
  }) => {
    const node = await api.createNode({ title: 'Draft' });
    const auth = await fakeAuth(page, IN);
    await page.goto(`/nodes/${node.id}`);
    const title = page.getByRole('textbox', { name: 'Title' });
    await expect(title).toHaveValue('Draft');

    // The session runs out: saves get 401 until a new code is entered.
    auth.status = OUT;
    let refused = 0;
    await page.route(`/api/nodes/${node.id}`, (r) => {
      if (r.request().method() !== 'PATCH' || auth.status.signedIn) return r.fallback();
      refused++;
      return r.fulfill({
        status: 401,
        json: { error: { code: 'UNAUTHORIZED', message: 'Sign in required' } },
      });
    });
    await title.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' kept');

    const box = page.getByRole('dialog', { name: 'Signed out' });
    await expect(box).toBeVisible();
    expect(refused).toBeGreaterThan(0);
    await expect(title).toHaveValue('Draft kept'); // still on the page, behind the box

    await box.getByRole('textbox', { name: '6-digit code' }).fill(GOOD);
    await expect(box).toBeHidden();
    // Autosave's retry goes through now that the session is back.
    await expect
      .poll(async () => (await api.getNode(node.id)).title, { timeout: 40_000 })
      .toBe('Draft kept');
  });

  test('Sign Out in the activity bar ends the session and reloads', async ({ page }) => {
    await fakeAuth(page, IN);
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign Out' }).click();
    await expect(codeBox(page)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toHaveCount(0);
  });

  test('with sign-in off there is no Sign Out button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toHaveCount(0);
  });
});
