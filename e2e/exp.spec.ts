import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

// Default level table (no level-config.json for the test server): a node is
// worth 10 EXP plus 1 per 20 words (max +50); level 2 at 50, level 3 at 150.
const fields = (page: Page) => page.getByRole('region', { name: 'Fields' });

test.describe('fields and levels', () => {
  test('each tag shows its level; EXP rolls up to the parent', async ({ page, api }) => {
    const computer = await api.createTag('Computer');
    const cpu = await api.createTag('CPU', computer.id);
    await api.createTag('GPU', computer.id);
    for (let i = 0; i < 4; i++) await api.createNode({ title: `Note ${i}`, tagIds: [cpu.id] });
    // 10 + 2 (40 words): CPU reaches 52 EXP.
    await api.createNode({ title: 'Long', tagIds: [cpu.id], content: 'word '.repeat(40) });

    await page.goto('/');
    const cpuRow = fields(page).getByTestId('field-CPU');
    await expect(cpuRow).toContainText('Lv 2');
    await expect(fields(page).getByTestId('field-Computer')).toContainText('Lv 2');
    await expect(fields(page).getByTestId('field-GPU')).toContainText('Lv 1');
    await expect(cpuRow.getByRole('progressbar', { name: 'CPU: level 2' })).toHaveAttribute(
      'aria-valuetext',
      '52 / 150 EXP · 5 nodes',
    );
  });

  test('tagging a node in the editor levels the field up', async ({ page, api }) => {
    const tag = await api.createTag('Embedded');
    for (let i = 0; i < 4; i++) await api.createNode({ title: `N${i}`, tagIds: [tag.id] });
    const node = await api.createNode({ title: 'GPIO' });
    await page.goto(`/nodes/${node.id}`);
    const row = fields(page).getByTestId('field-Embedded');
    await expect(row).toContainText('Lv 1');

    await page
      .getByRole('combobox', { name: 'Add tag to GPIO' })
      .selectOption({ label: 'Embedded' });
    await expect(row).toContainText('Lv 2');
  });

  test('there is no control to change levels', async ({ page, api }) => {
    await api.createTag('Solo');
    await page.goto('/');
    await expect(fields(page).getByTestId('field-Solo')).toBeVisible();
    await expect(fields(page).getByRole('button')).toHaveCount(0);
    await expect(fields(page).getByRole('textbox')).toHaveCount(0);
    expect((await page.request.post('/api/exp', { data: {} })).status()).toBe(404);
  });
});
