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
    // The only button folds the section away; nothing edits a level.
    await expect(fields(page).getByRole('button')).toHaveCount(1);
    await expect(fields(page).getByRole('button', { name: 'Fields' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(fields(page).getByRole('textbox')).toHaveCount(0);
    expect((await page.request.post('/api/exp', { data: {} })).status()).toBe(404);
  });

  test('the field tree folds by click and keyboard, and remembers it', async ({ page, api }) => {
    const computer = await api.createTag('Computer');
    const cpu = await api.createTag('CPU', computer.id);
    await api.createTag('Cache', cpu.id);
    await api.createTag('Math');

    await page.goto('/');
    const tree = fields(page).getByRole('tree');
    const item = (name: string) => tree.getByRole('treeitem', { name, exact: true });
    await expect(item('Cache')).toBeVisible();
    await expect(item('Computer')).toHaveAttribute('aria-expanded', 'true');
    await expect(item('Math')).not.toHaveAttribute('aria-expanded');
    // The level is read after the name, not only shown.
    await expect(item('Math')).toHaveAccessibleDescription(/Lv 1 · 0 \/ 50 EXP · 0 nodes/);

    // Clicking a parent hides its whole subtree.
    await item('Computer').click();
    await expect(item('Computer')).toHaveAttribute('aria-expanded', 'false');
    await expect(item('CPU')).toHaveCount(0);
    await expect(item('Cache')).toHaveCount(0);

    // Keyboard: Right opens, Right again enters, Left on a leaf goes up.
    await item('Computer').focus();
    await page.keyboard.press('ArrowRight');
    await expect(item('CPU')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(item('CPU')).toBeFocused();
    await page.keyboard.press('ArrowLeft'); // CPU is open: collapse it
    await expect(item('Cache')).toHaveCount(0);
    await page.keyboard.press('ArrowLeft'); // closed: go to the parent
    await expect(item('Computer')).toBeFocused();

    // The fold state survives a reload; the section header folds everything.
    await page.reload();
    await expect(item('CPU')).toBeVisible();
    await expect(item('Cache')).toHaveCount(0);
    const header = fields(page).getByRole('button', { name: 'Fields' });
    await header.click();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
    await expect(fields(page).getByRole('tree')).toHaveCount(0);
    await page.reload();
    await expect(header).toHaveAttribute('aria-expanded', 'false');
  });
});
