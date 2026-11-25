import type { GraphNode, GraphSnapshot } from '@km/core';
import type { Page } from '@playwright/test';
import { expect, isNarrow, test } from './fixtures';

/** The quick input (command palette / quick open) and its text box. */
const quickInput = (page: Page) => page.getByRole('dialog', { name: 'Quick input' });
const quickBox = (page: Page) => quickInput(page).getByRole('combobox');

test.describe('command palette', () => {
  test('Ctrl+Shift+P runs a command found by fuzzy search', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await expect(quickBox(page)).toHaveValue('>');
    await expect(quickBox(page)).toBeFocused();

    await page.keyboard.type('go tags');
    await expect(quickInput(page).getByRole('option').first()).toContainText('Go: Go to Tags');
    await expect(quickInput(page).getByRole('option').first()).toContainText('Alt+2');
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/tags$/);
    await expect(quickInput(page)).toBeHidden();
  });

  test('Ctrl+P opens a node, accent-insensitively; ">" switches to commands', async ({
    page,
    api,
  }) => {
    await api.createNode({ title: 'Graph databases' });
    const target = await api.createNode({ title: 'Đồ thị tri thức' });
    await page.goto('/');

    await page.keyboard.press('ControlOrMeta+P');
    await expect(quickBox(page)).toHaveAttribute('placeholder', /Search nodes by title/);
    await page.keyboard.type('do thi');
    await expect(quickInput(page).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/nodes/${target.id}$`));

    await page.keyboard.press('ControlOrMeta+P');
    await page.keyboard.type('>');
    await expect(quickBox(page)).toHaveAttribute('placeholder', 'Type a command name');
    await page.keyboard.press('Backspace');
    await expect(quickBox(page)).toHaveAttribute('placeholder', /Search nodes by title/);
    await page.keyboard.press('Escape');
    await expect(quickInput(page)).toBeHidden();
  });

  test('arrow keys pick a row; recently used commands come first', async ({ page }) => {
    await page.goto('/tags');
    await page.keyboard.press('F1');
    await page.keyboard.type('go to graph');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);

    await page.keyboard.press('F1');
    const first = quickInput(page).getByRole('option').first();
    await expect(first).toContainText('Go to Graph');
    await expect(first).toContainText('recently used');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(first).toHaveAttribute('aria-selected', 'false');
    await expect(quickInput(page).getByRole('option').nth(1)).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('only offers commands that work on the current page', async ({ page, api }) => {
    const node = await api.createNode({ title: 'N' });
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.type('toggle preview');
    await expect(quickInput(page).getByText('No matching commands')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.goto(`/nodes/${node.id}`);
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.type('toggle preview');
    await expect(quickInput(page).getByRole('option').first()).toContainText(
      'Markdown: Toggle Preview',
    );
  });

  test('the header button opens the palette (touch)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Show All Commands' }).click();
    await expect(quickBox(page)).toHaveValue('>');
    await quickInput(page)
      .getByRole('option', { name: /Change Display Language/ })
      .click();
    await quickInput(page)
      .getByRole('option', { name: /Tiếng Việt/ })
      .click();
    await expect(page.getByRole('link', { name: 'Đồ thị' })).toBeVisible();
  });
});

test.describe('keyboard shortcuts', () => {
  test('a chord (Ctrl+K Ctrl+S) opens the shortcuts page', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('ControlOrMeta+K');
    // (The toast region is a status too; pick the chord line by its text.)
    const chord = page.getByRole('status').filter({ hasText: 'Waiting for second key' });
    await expect(chord).toContainText('was pressed. Waiting for second key');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByRole('heading', { name: 'Keyboard Shortcuts' })).toBeVisible();
    await expect(chord).toHaveCount(0);
  });

  test('work while typing in the editor; plain keys still type', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Typing' });
    await page.goto(`/nodes/${node.id}`);

    await page.locator('.cm-content').click();
    await page.keyboard.type('a = b');
    await expect(page.locator('.cm-content')).toContainText('a = b'); // "=" is Zoom In on the graph only
    // Ctrl+K Ctrl+V (not Ctrl+Shift+V, which stays "paste as plain text").
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('ControlOrMeta+V');
    await expect(page.getByTestId('markdown-preview')).toContainText('a = b');
    await expect(page.locator('.cm-content')).toHaveCount(0);

    await page.keyboard.press('F2');
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeFocused();

    await page.keyboard.press('Alt+L');
    await expect(page.getByRole('combobox', { name: 'Relation' })).toBeFocused();
    await page.keyboard.type('FROM_KEYBOARD');
    await expect(page.getByRole('combobox', { name: 'Relation' })).toHaveValue('FROM_KEYBOARD');
  });

  test('keys switch edit / split / preview; a hint and the tabs show them', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Hardware keyboard shortcuts; the hint is hidden on touch screens.');
    const node = await api.createNode({ title: 'Modes', content: 'Hello' });
    await page.goto(`/nodes/${node.id}`);
    await expect(page.getByTestId('mode-hint')).toHaveText('Alt+V edit → split → preview');
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });
    await tab('Edit').hover();
    // (A chord's two steps are separate key caps: no space between them in the text.)
    await expect(page.getByRole('tooltip')).toHaveText(/Show Editor Only\s*Ctrl\+K\s*E/);

    // Alt+V goes round: edit → split → preview → edit (typing again).
    await page.locator('.cm-content').click();
    await page.keyboard.press('Alt+V');
    await expect(tab('Split')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Alt+V');
    await expect(tab('Preview')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Alt+V');
    await expect(tab('Edit')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toBeFocused();

    // The chords still go straight to a mode.
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('V'); // split
    await expect(tab('Split')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.press('E'); // edit only, editor focused again
    await expect(tab('Edit')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('markdown-preview')).toHaveCount(0);
    await expect(page.locator('.cm-content')).toBeFocused();
  });

  test("Ctrl+S saves now, never the browser's Save page", async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Hardware keyboard shortcut.');
    const node = await api.createNode({ title: 'Saving' });
    await page.goto(`/nodes/${node.id}`);
    await page.locator('.cm-content').click();
    await page.keyboard.type('typed just now');
    // The page takes the key (the browser's dialog would need it not handled).
    const handled = await page.evaluate(`(() => {
      const mac = navigator.platform.startsWith('Mac');
      const e = new KeyboardEvent('keydown', {
        key: 's', code: 'KeyS', ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true,
      });
      document.querySelector('.cm-content').dispatchEvent(e);
      return e.defaultPrevented;
    })()`);
    expect(handled).toBe(true);
    await expect(page.locator('.toast', { hasText: 'All changes saved.' })).toBeVisible();
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    expect((await api.getNode(node.id)).content).toBe('typed just now');
  });

  test('Ctrl+B hides and shows the sidebar; Alt+N creates a node', async ({ page }) => {
    await page.goto('/');
    if (!isNarrow(page)) {
      // (A phone has no sidebar: the node list is a tab.)
      const sidebar = page.getByRole('navigation', { name: 'Nodes' });
      await expect(sidebar).toBeVisible();
      await page.keyboard.press('ControlOrMeta+B');
      await expect(sidebar).toBeHidden();
      await page.keyboard.press('ControlOrMeta+B');
      await expect(sidebar).toBeVisible();
    }

    await page.keyboard.press('Alt+N');
    await expect(page).toHaveURL(/\/nodes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Untitled');
  });

  test('rebinds a command, keeps it after reload, warns on conflicts, resets', async ({ page }) => {
    await page.goto('/shortcuts');
    const row = page.getByTestId('shortcut-km.go.tags');
    await expect(row).toContainText('Alt+2');

    await row.getByRole('button', { name: 'Change keybinding of Go to Tags' }).click();
    const recorder = page.getByRole('dialog', { name: 'New keybinding for Go to Tags' });
    await expect(recorder).toBeVisible();
    await page.keyboard.press('Alt+9');
    await expect(page.getByTestId('recorded-keys')).toHaveText('Alt+9');
    await page.keyboard.press('Enter');
    await expect(recorder).toBeHidden();
    await expect(row).toContainText('Alt+9');
    await expect(row).toContainText('User');

    await page.goto('/');
    await page.reload();
    await page.keyboard.press('Alt+9');
    await expect(page).toHaveURL(/\/tags$/);
    await page.keyboard.press('Alt+2'); // the old key is free now
    await expect(page).toHaveURL(/\/tags$/);

    await page.goto('/shortcuts');
    await row.getByRole('button', { name: 'Change keybinding of Go to Tags' }).click();
    await page.keyboard.press('Alt+1');
    await expect(page.getByRole('dialog').getByText('Also used by: Go to Graph')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(row.getByRole('note')).toHaveText('Also used by: Go to Graph');

    await row.getByRole('button', { name: 'Reset keybinding of Go to Tags' }).click();
    await expect(row).toContainText('Alt+2');
    await expect(row).toContainText('Default');
  });

  test('holding a shortcut runs it once (no auto-repeat)', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.down('Alt');
    await page.keyboard.down('N');
    // Repeats that arrive *after* the first create finished: an in-flight
    // guard can't stop these, only ignoring auto-repeat can.
    await expect(page).toHaveURL(/\/nodes\//);
    for (let i = 0; i < 5; i++) await page.keyboard.down('N'); // auto-repeats
    await page.keyboard.up('N');
    await page.keyboard.up('Alt');
    await expect
      .poll(
        async () => ((await (await page.request.get('/api/nodes')).json()) as GraphNode[]).length,
      )
      .toBe(1);
  });

  test('shortcuts wait while a modal dialog is open', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Opening the relation dialog needs a pointer drag.');
    await api.createNode({ title: 'Source', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Target', position: { x: 300, y: 250 } });
    await page.goto('/');
    const source = page.locator('.react-flow__node', { hasText: 'Source' });
    await source.hover();
    const from = await source.locator('.react-flow__handle-bottom').boundingBox();
    const to = await page
      .locator('.react-flow__node', { hasText: 'Target' })
      .locator('.km-node-label')
      .boundingBox();
    if (!from || !to) throw new Error('grip or label not rendered');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();

    const dialog = page.getByRole('dialog', { name: 'New relation' });
    const name = dialog.getByRole('combobox', { name: 'Relation name' });
    await name.fill('KEEP_ME');
    await page.keyboard.press('ControlOrMeta+P');
    await page.keyboard.press('Alt+2');
    await expect(quickInput(page)).toBeHidden();
    await expect(page).toHaveURL(/\/$/);
    await expect(name).toHaveValue('KEEP_ME');

    await dialog.getByRole('button', { name: 'Create link' }).click();
    await expect
      .poll(
        async () =>
          ((await (await page.request.get('/api/graph')).json()) as GraphSnapshot).edges.length,
      )
      .toBe(1);
  });

  test('adds a second keybinding next to the defaults', async ({ page }) => {
    await page.goto('/shortcuts');
    const row = page.getByTestId('shortcut-workbench.action.showCommands');
    await row.getByRole('button', { name: 'Add keybinding to Show All Commands' }).click();
    await page.keyboard.press('Alt+9');
    await page.keyboard.press('Enter');
    await expect(row).toContainText('F1');
    await expect(row).toContainText('Alt+9');

    await page.keyboard.press('Alt+9');
    await expect(quickBox(page)).toHaveValue('>');
  });

  test('the recorder can be used with buttons (touch / screen readers)', async ({ page }) => {
    await page.goto('/shortcuts');
    const row = page.getByTestId('shortcut-km.go.tags');
    await row.getByRole('button', { name: 'Change keybinding of Go to Tags' }).click();
    const recorder = page.getByRole('dialog', { name: 'New keybinding for Go to Tags' });
    await expect(recorder.getByRole('button', { name: 'Save' })).toBeDisabled();
    await page.keyboard.press('Alt+8');
    await recorder.getByRole('button', { name: 'Clear' }).click();
    await expect(page.getByTestId('recorded-keys')).toHaveText('…');
    await page.keyboard.press('Alt+7');
    await recorder.getByRole('button', { name: 'Save' }).click();
    await expect(recorder).toBeHidden();
    await expect(row).toContainText('Alt+7');

    await row.getByRole('button', { name: 'Change keybinding of Go to Tags' }).click();
    await recorder.getByRole('button', { name: 'Cancel' }).click();
    await expect(recorder).toBeHidden();
    await expect(row).toContainText('Alt+7');
  });

  test('Escape cancels recording without changing anything', async ({ page }) => {
    await page.goto('/shortcuts');
    const row = page.getByTestId('shortcut-workbench.action.showCommands');
    await row.getByRole('button', { name: 'Change keybinding of Show All Commands' }).click();
    await page.keyboard.press('Alt+Q');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(row).toContainText('F1');
    await expect(row).toContainText('Default');
  });
});
