import type { Page } from '@playwright/test';
import { expect, phoneWithCopy, test } from './fixtures';

const q = (question: string, answer: string, children: unknown[] = []) => ({
  question,
  answer,
  children,
});

/** 3 answered whys, 3 levels deep: a well-dug node. */
async function digDeep(page: Page, nodeId: string) {
  const res = await page.request.post(`/api/nodes/${nodeId}/whys`, {
    data: { whys: [q('a', 'yes', [q('b', 'yes', [q('c', 'yes')])])] },
  });
  expect(res.ok()).toBe(true);
}

test.describe('review today (spaced repetition)', () => {
  test('a shallow node asks to be dug deeper; Done puts it away for a day', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'The sidebar panel; the phone app only views.');
    const shallow = await api.createNode({ title: 'Shallow note' });
    const deep = await api.createNode({ title: 'Deep note' });
    await digDeep(page, deep.id);
    await page.goto('/');

    // Its own tab in the activity bar, with the number of cards due.
    const tab = page
      .getByRole('navigation', { name: 'Views' })
      .getByRole('link', { name: 'Review' });
    await expect(tab).toContainText('1');
    await tab.click();
    await expect(page).toHaveURL(/\/review$/);
    const panel = page.getByRole('list', { name: 'Review today' });
    const card = panel.getByRole('listitem', { name: 'Shallow note' });
    await expect(card).toContainText('Dig deeper');
    await expect(card).toContainText('0 answered whys');
    await expect(panel.getByRole('listitem', { name: 'Deep note' })).toHaveCount(0);

    await card.getByRole('link', { name: 'Shallow note' }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${shallow.id}$`));
    await page.keyboard.press('Alt+3'); // Go to Review
    await expect(page).toHaveURL(/\/review$/);

    await panel.getByRole('button', { name: 'Done: Shallow note' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText('Nothing to review today.');
    await expect(tab).not.toContainText(/\d/);
  });

  test('two well-dug, unlinked nodes are suggested as a link', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'The sidebar panel; the phone app only views.');
    const a = await api.createNode({ title: 'Alpha' });
    const b = await api.createNode({ title: 'Beta' });
    await digDeep(page, a.id);
    await digDeep(page, b.id);
    await page.goto('/review');

    const panel = page.getByRole('list', { name: 'Review today' });
    const card = panel.getByRole('listitem', { name: /^(Alpha ↔ Beta|Beta ↔ Alpha)$/ });
    await expect(card).toContainText('Link these?');
    await expect(card.getByRole('link')).toHaveCount(2);

    // Linking them ends the suggestion.
    await api.createEdge(a.id, b.id, 'RELATES_TO');
    await page.reload();
    await expect(page.getByRole('main')).toContainText('Nothing to review today.');
  });

  test('the phone app has no review tab', async ({ page, api }) => {
    await api.createNode({ title: 'Shallow note' });
    await phoneWithCopy(page, api);
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review' })).toHaveCount(0);
    await page.goto('/review');
    await expect(page).toHaveURL(/\/$/);
  });
});
