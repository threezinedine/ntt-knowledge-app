import { expect, test } from './fixtures';

// Chrome runs these on Windows/Linux, where Mod is Ctrl.
test.describe('shortcut tooltips', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'Hover tooltips are for mouse and keyboard.');
  });

  test('hovering a button shows its command and shortcut', async ({ page }) => {
    await page.goto('/');
    const button = page.getByRole('button', { name: 'Show All Commands' });
    await expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+P F1');
    await button.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toHaveText(/Show All Commands\s*Ctrl\+Shift\+P/);

    // A neighbour shows its own at once; leaving hides it.
    await page.getByRole('link', { name: 'Tags' }).hover();
    await expect(tip).toHaveText(/Go to Tags\s*Alt\+2/);
    await page.getByRole('main').hover({ position: { x: 300, y: 300 } });
    await expect(tip).toBeHidden();
  });

  test('clicking dismisses it; graph controls have them too', async ({ page }) => {
    await page.goto('/');
    const zoomIn = page.getByRole('button', { name: 'Zoom In' });
    await zoomIn.hover();
    await expect(page.getByRole('tooltip')).toHaveText(/Zoom In\s*=/);
    await zoomIn.click();
    await expect(page.getByRole('tooltip')).toBeHidden();
    await page.getByRole('button', { name: 'Fit Graph to Screen' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText(/Fit Graph to Screen\s*Shift\+1/);
  });

  test('keyboard focus shows it; Escape hides it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Tags' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show All Commands' })).toBeFocused();
    await expect(page.getByRole('tooltip')).toHaveText(/Show All Commands/);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('tooltip')).toBeHidden();
  });

  test('follows rebinding, and shows on a disabled button', async ({ page, api }) => {
    await page.goto('/shortcuts');
    const row = page.getByTestId('shortcut-km.node.addTask');
    await row.getByRole('button', { name: 'Change keybinding of Add Task' }).click();
    await page.keyboard.press('Alt+9');
    await page.keyboard.press('Enter');
    await expect(row).toContainText('Alt+9');

    const node = await api.createNode({ title: 'Tipped' });
    await page.goto(`/nodes/${node.id}`);
    const add = page.getByRole('form', { name: 'Add task' }).getByRole('button', { name: 'Add' });
    await expect(add).toBeDisabled(); // nothing typed yet
    await add.hover();
    await expect(page.getByRole('tooltip')).toHaveText(/Add Task\s*Alt\+9/);
  });

  test('an unbound command adds no tooltip to a labelled button', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Plain' });
    await page.goto(`/nodes/${node.id}`);
    await page.getByRole('button', { name: 'Delete node' }).hover();
    await page.waitForTimeout(800); // past the show delay
    await expect(page.getByRole('tooltip')).toBeHidden();
  });
});

test('touch never shows tooltips', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Touch profile only.');
  await page.goto('/');
  await page.getByRole('button', { name: 'Show All Commands' }).tap();
  await expect(page.getByRole('dialog', { name: 'Quick input' })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByRole('tooltip')).toBeHidden();
});
