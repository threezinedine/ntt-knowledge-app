import type { GraphNode } from '@km/core';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const title = (page: Page) => page.getByRole('textbox', { name: 'Title' });
const content = (page: Page) => page.getByRole('textbox', { name: 'Content' });

async function saved(page: Page, id: string): Promise<GraphNode> {
  return (await (await page.request.get(`/api/nodes/${id}`)).json()) as GraphNode;
}

test.describe('jumping between title and content', () => {
  test('the page shows how, with the current keys', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Hidden on touch screens (no Alt keys there).');
    const node = await api.createNode({ title: 'Hinted' });
    await page.goto(`/nodes/${node.id}`);
    const hint = page.getByTestId('jump-hint');
    await expect(hint).toContainText('Alt+K title');
    await expect(hint).toContainText('Alt+J content');
    await expect(hint).not.toContainText('Vim');
    await enableVim(page);
    await expect(page.getByTestId('jump-hint')).toContainText('Ctrl+[ = Esc');
  });

  test('Enter in the title, Alt+J and Alt+K', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Jump' });
    await page.goto(`/nodes/${node.id}`);
    await title(page).click();
    await page.keyboard.press('Enter');
    await expect(content(page)).toBeFocused();
    await page.keyboard.press('Alt+K');
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('Alt+J');
    await expect(content(page)).toBeFocused();
  });

  test('Alt+J from Preview opens the editor and focuses it', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Previewed' });
    await page.goto(`/nodes/${node.id}`);
    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(content(page)).toHaveCount(0);
    await page.keyboard.press('Alt+J');
    await expect(content(page)).toBeFocused();
  });
});

async function enableVim(page: Page) {
  await page.evaluate(() => {
    localStorage.setItem('km.vimMode', 'true');
  });
  await page.reload();
  // Shortcuts need the page's handlers, which come with the loaded node.
  if (page.url().includes('/nodes/')) await expect(title(page)).toBeVisible();
}

test.describe('vim mode', () => {
  test.beforeEach(({ isMobile }) => {
    test.skip(isMobile, 'Vim needs a hardware keyboard; the toggle is hidden on touch.');
  });

  test('is off by default, toggles from the button and stays on after reload', async ({
    page,
    api,
  }) => {
    const node = await api.createNode({ title: 'Toggle' });
    await page.goto(`/nodes/${node.id}`);
    const toggle = page.getByRole('button', { name: 'Vim' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Vim' })).toHaveAttribute('aria-pressed', 'true');

    // And from the palette.
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.type('toggle vim');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Vim' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('edits title and content with vim keys; j / k move between them', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Draft', content: 'line one\nline two' });
    await page.goto(`/nodes/${node.id}`);
    await page.getByRole('button', { name: 'Vim' }).click();

    await page.keyboard.press('Alt+K'); // title, Normal mode
    await expect(title(page)).toBeFocused();
    await page.keyboard.type('A notes'); // A = append at end of line
    await page.keyboard.press('Control+BracketLeft'); // Ctrl+[ = Esc
    await expect(title(page)).toHaveText('Draft notes');
    await page.keyboard.press('Enter'); // refused as a newline: goes to content
    await expect(content(page)).toBeFocused();

    await page.keyboard.type('ggdd'); // delete the first line
    await expect(content(page)).toHaveText('line two');
    // "k" on the first line leaves for the title; "j" comes back.
    await page.keyboard.press('k');
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('j');
    await expect(content(page)).toBeFocused();

    // An operator waiting for its motion keeps "k" for itself, even on line 1.
    await page.keyboard.type('Oabove'); // O = open a line above
    await page.keyboard.press('Control+BracketLeft');
    await page.keyboard.type('dk');
    await expect(content(page)).toBeFocused();
    await page.keyboard.type('ggdG'); // clear everything (the placeholder shows)
    await expect(content(page)).not.toContainText('line two');

    await expect
      .poll(async () => {
        const n = await saved(page, node.id);
        return [n.title, n.content];
      })
      .toEqual(['Draft notes', '']);
  });

  test('a new node opens with its title selected (Visual): c replaces it', async ({ page }) => {
    await page.goto('/');
    await enableVim(page);
    await page.keyboard.press('Alt+N');
    await expect(title(page)).toBeFocused();
    await page.keyboard.type('cNamed in vim');
    await page.keyboard.press('Escape');
    await expect(title(page)).toHaveText('Named in vim');
  });

  test('the title has undo, and its : and / prompts work', async ({ page, api }) => {
    const node = await api.createNode({ title: 'aaa' });
    await page.goto(`/nodes/${node.id}`);
    await enableVim(page);
    await page.keyboard.press('Alt+K');
    await page.keyboard.type('x');
    await expect(title(page)).toHaveText('aa');
    await page.keyboard.type('u');
    await expect(title(page)).toHaveText('aaa');

    await page.keyboard.type(':s/a/b/g');
    await page.keyboard.press('Enter'); // runs the command, doesn't jump
    await expect(title(page)).toHaveText('bbb');
    await expect(title(page)).toBeFocused();
    await page.keyboard.type('0/bj'); // a "j" typed in the prompt stays there
    await expect(title(page)).not.toBeFocused(); // focus is in the prompt
    await page.keyboard.press('Escape');
    await expect(title(page)).toBeFocused();
  });

  test('vim Ctrl keys win over app shortcuts inside the editor', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Scroll' });
    await page.goto(`/nodes/${node.id}`);
    await enableVim(page);
    await page.keyboard.press('Alt+J');
    await page.keyboard.press('Control+B'); // vim: page up, not "toggle sidebar"
    await expect(page.getByRole('searchbox', { name: 'Search nodes' })).toBeVisible();
    await expect(content(page)).toBeFocused();
    // Outside the editor, Ctrl+B is the app's again.
    await page.getByRole('textbox', { name: 'Type' }).focus();
    await page.keyboard.press('Control+B');
    await expect(page.getByRole('searchbox', { name: 'Search nodes' })).toBeHidden();
  });

  test('line numbers are relative to the cursor', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Numbers', content: 'a\nb\nc\nd' });
    await page.goto(`/nodes/${node.id}`);
    await enableVim(page);
    await page.keyboard.press('Alt+J');
    const numbers = page
      .locator('.markdown-source .cm-lineNumbers .cm-gutterElement')
      .filter({ visible: true }); // not the hidden width spacer
    await expect(numbers).toHaveText(['1', '1', '2', '3']);
    await page.keyboard.type('2j'); // to line 3
    await expect(numbers).toHaveText(['2', '1', '3', '1']);
    // The mode line stays on screen even though the pane is taller than the window.
    await expect(page.getByText('--NORMAL--')).toBeInViewport();
  });

  test('toggling vim keeps the caret in the title', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Stay' });
    await page.goto(`/nodes/${node.id}`);
    await title(page).click();
    await page.getByRole('button', { name: 'Vim' }).click();
    await expect(title(page)).toBeFocused();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.type('toggle vim');
    await page.keyboard.press('Enter');
    await expect(title(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Vim' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
