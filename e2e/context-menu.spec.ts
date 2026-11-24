import type { GraphNode } from '@km/core';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const sidebarItem = (page: Page, title: string) =>
  page.getByRole('navigation', { name: 'Nodes' }).getByRole('link', { name: title });
const menu = (page: Page, title: string) =>
  page.getByRole('menu', { name: `Actions for ${title}` });

test.describe('node context menu', () => {
  test('right-click lists the actions; keyboard moves and Escape closes', async ({ page, api }) => {
    await api.createNode({ title: 'Alpha' });
    await page.goto('/');
    await sidebarItem(page, 'Alpha').click({ button: 'right' });
    const m = menu(page, 'Alpha');
    await expect(m.getByRole('menuitem')).toHaveText([
      'Open',
      /^Rename/,
      'Tags…',
      'Reveal in Graph',
      'Copy Title',
      'Copy Link',
      'Delete…',
    ]);
    await expect(m.getByRole('menuitem', { name: 'Open' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(m.getByRole('menuitem', { name: /^Rename/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(m.getByRole('menuitem', { name: 'Delete…' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(m).toBeHidden();
  });

  test('opens from the keyboard and gives focus back', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Keyboard menu key.');
    await api.createNode({ title: 'Keys' });
    await page.goto('/');
    await sidebarItem(page, 'Keys').focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu(page, 'Keys')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebarItem(page, 'Keys')).toBeFocused();
  });

  test('Rename opens the node with the title selected', async ({ page, api }) => {
    await api.createNode({ title: 'Old name' });
    await page.goto('/');
    await sidebarItem(page, 'Old name').click({ button: 'right' });
    await menu(page, 'Old name')
      .getByRole('menuitem', { name: /^Rename/ })
      .click();
    const title = page.getByRole('textbox', { name: 'Title' });
    await expect(title).toBeFocused();
    await page.keyboard.type('New name');
    await expect(title).toHaveValue('New name');
  });

  test('Tags… toggles tags from the quick pick', async ({ page, api }) => {
    await api.createTag('Physics');
    const node = await api.createNode({ title: 'Optics' });
    await page.goto('/');
    await sidebarItem(page, 'Optics').click({ button: 'right' });
    await menu(page, 'Optics').getByRole('menuitem', { name: 'Tags…' }).click();
    const box = page.getByRole('dialog', { name: 'Quick input' });
    await box.getByRole('option', { name: /Physics/ }).click();
    await expect
      .poll(
        async () =>
          ((await (await page.request.get(`/api/nodes/${node.id}`)).json()) as GraphNode).tagIds
            .length,
      )
      .toBe(1);
    await expect(
      page.getByRole('region', { name: 'Fields' }).getByTestId('field-Physics'),
    ).toContainText('Lv 1');
  });

  test('Delete… asks first, then removes the node', async ({ page, api }) => {
    await api.createNode({ title: 'Doomed' });
    await api.createNode({ title: 'Keeper' });
    await page.goto('/');
    await sidebarItem(page, 'Doomed').click({ button: 'right' });
    await menu(page, 'Doomed').getByRole('menuitem', { name: 'Delete…' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete node' });
    await expect(confirm).toContainText('Delete “Doomed” and its links?');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(sidebarItem(page, 'Doomed')).toBeVisible();

    await sidebarItem(page, 'Doomed').click({ button: 'right' });
    await menu(page, 'Doomed').getByRole('menuitem', { name: 'Delete…' }).click();
    await page
      .getByRole('dialog', { name: 'Delete node' })
      .getByRole('button', { name: 'Delete…' })
      .click();
    await expect(sidebarItem(page, 'Doomed')).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: 'Deleted “Doomed”' })).toBeVisible();
    await expect(sidebarItem(page, 'Keeper')).toBeVisible();
  });

  test('Copy Title puts it on the clipboard', async ({ page, api, context, isMobile }) => {
    test.skip(isMobile, 'Clipboard permissions are desktop-only in the emulator.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await api.createNode({ title: 'Clip me' });
    await page.goto('/');
    await sidebarItem(page, 'Clip me').click({ button: 'right' });
    await menu(page, 'Clip me').getByRole('menuitem', { name: 'Copy Title' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Title copied' })).toBeVisible();
    expect(await page.evaluate<string>('navigator.clipboard.readText()')).toBe('Clip me');
  });

  test('the graph has the same menu; Reveal in Graph centres a node', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Right-click on the canvas.');
    const near = await api.createNode({ title: 'Near', position: { x: 0, y: 0 } });
    const far = await api.createNode({ title: 'Far', position: { x: 600, y: 300 } });
    await page.goto('/');
    await page.locator(`.react-flow__node[data-id="${near.id}"]`).click({ button: 'right' });
    await expect(menu(page, 'Near')).toBeVisible();
    await page.keyboard.press('Escape');

    // Pan away so the reveal has something to do.
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await page.getByRole('button', { name: 'Zoom In' }).click();
    await sidebarItem(page, 'Far').click({ button: 'right' });
    await menu(page, 'Far').getByRole('menuitem', { name: 'Reveal in Graph' }).click();
    const farNode = page.locator(`.react-flow__node[data-id="${far.id}"]`);
    await expect(farNode).toHaveClass(/selected/);
    await expect(farNode).toBeInViewport();
  });

  test('right-clicking a link offers rename, both ends and delete', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Right-click on the canvas.');
    const a = await api.createNode({ title: 'Cause', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Effect', position: { x: 400, y: 0 } });
    const edge = await api.createEdge(a.id, b.id, 'LEADS_TO');
    await page.goto('/');
    const line = page.getByTestId(`rf__edge-${edge.id}`);
    const linkMenu = page.getByRole('menu', { name: 'Actions for link LEADS_TO (Cause → Effect)' });

    await line.click({ button: 'right', force: true });
    await expect(linkMenu.getByRole('menuitem')).toHaveText([
      /^Rename/,
      'Open “Cause”',
      'Open “Effect”',
      'Delete Link',
    ]);
    await linkMenu.getByRole('menuitem', { name: /^Rename/ }).click();
    const editor = page.getByRole('textbox', { name: 'Link name' });
    await editor.fill('CAUSES');
    await editor.press('Enter');
    await expect(page.locator('.react-flow__edge-text', { hasText: 'CAUSES' })).toBeVisible();

    await line.click({ button: 'right', force: true });
    await page
      .getByRole('menu', { name: /^Actions for link CAUSES/ })
      .getByRole('menuitem', { name: 'Delete Link' })
      .click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Deleted link “CAUSES”' }),
    ).toBeVisible();
    await expect(line).toHaveCount(0);
    const graph = (await (await page.request.get('/api/graph')).json()) as { edges: unknown[] };
    expect(graph.edges).toHaveLength(0);
  });

  test('a link’s menu opens either end', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Right-click on the canvas.');
    const a = await api.createNode({ title: 'Start', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'End', position: { x: 400, y: 0 } });
    const edge = await api.createEdge(a.id, b.id, 'GOES');
    await page.goto('/');
    await page.getByTestId(`rf__edge-${edge.id}`).click({ button: 'right', force: true });
    await page.getByRole('menuitem', { name: 'Open “End”' }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${b.id}$`));
  });

  test('keys typed in the menu never reach the graph (Backspace keeps a selected link)', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Edge selection is a pointer interaction.');
    const a = await api.createNode({ title: 'From', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'To', position: { x: 400, y: 0 } });
    const edge = await api.createEdge(a.id, b.id, 'KEEP');
    await page.goto('/');
    const line = page.getByTestId(`rf__edge-${edge.id}`);
    await line.click({ force: true });
    await expect(line).toHaveClass(/selected/);

    await page.locator(`.react-flow__node[data-id="${a.id}"]`).click({ button: 'right' });
    await expect(menu(page, 'From')).toBeVisible();
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await page.keyboard.press('Escape');
    const graph = (await (await page.request.get('/api/graph')).json()) as { edges: unknown[] };
    expect(graph.edges).toHaveLength(1);
  });

  test('Reveal in Graph from a node page opens the graph on that node', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Checks the canvas viewport.');
    for (let i = 0; i < 12; i++) {
      await api.createNode({
        title: `Filler ${String(i)}`,
        position: { x: (i % 4) * 500, y: Math.floor(i / 4) * 400 },
      });
    }
    const target = await api.createNode({ title: 'Target', position: { x: 2600, y: 1400 } });
    await page.goto(`/nodes/${target.id}`);
    await sidebarItem(page, 'Target').click({ button: 'right' });
    await menu(page, 'Target').getByRole('menuitem', { name: 'Reveal in Graph' }).click();
    await expect(page).toHaveURL(/\/$/);
    const node = page.locator(`.react-flow__node[data-id="${target.id}"]`);
    await expect(node).toHaveClass(/selected/);
    await expect(node).toBeInViewport();
    await expect(node.locator('.km-node-label')).toBeVisible(); // zoomed in, not the overview
  });
});
