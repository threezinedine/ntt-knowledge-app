import type { GraphNode, GraphSnapshot } from '@km/core';
import { expect, test } from './fixtures';

test.describe('graph editor', () => {
  test('adds a node from the canvas toolbar', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'New node title' }).fill('Fresh idea');
    await page.getByRole('button', { name: 'Add node' }).click();

    await expect(page.locator('.react-flow__node', { hasText: 'Fresh idea' })).toBeVisible();
    const graph = (await (await page.request.get('/api/graph')).json()) as GraphSnapshot;
    expect(graph.nodes.find((n) => n.title === 'Fresh idea')?.position).not.toBeNull();
  });

  test('connects two nodes by dragging and names the relation', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Handle dragging is a pointer interaction; covered on desktop.');
    await api.createNode({ title: 'Source', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Target', position: { x: 300, y: 250 } });
    await page.goto('/');

    const source = page.locator('.react-flow__node', { hasText: 'Source' });
    const target = page.locator('.react-flow__node', { hasText: 'Target' });
    const from = await source.locator('.react-flow__handle-bottom').boundingBox();
    const to = await target.locator('.react-flow__handle-top').boundingBox();
    if (!from || !to) throw new Error('handles not rendered');

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 15 });
    await page.mouse.up();

    const dialog = page.getByRole('dialog', { name: 'New relation' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Relation name' }).fill('LEADS_TO');
    await dialog.getByRole('button', { name: 'Create link' }).click();

    await expect(dialog).toBeHidden();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'LEADS_TO' })).toBeVisible();
  });

  test('persists node position after dragging', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Pointer drag; covered on desktop.');
    const node = await api.createNode({ title: 'Movable', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Anchor', position: { x: 400, y: 300 } });
    await page.goto('/');

    const box = await page.locator('.react-flow__node', { hasText: 'Movable' }).boundingBox();
    if (!box) throw new Error('node not rendered');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 });
    await page.mouse.up();

    await expect(async () => {
      const res = await page.request.get(`/api/nodes/${node.id}`);
      const { position } = (await res.json()) as GraphNode;
      expect(position?.x).toBeGreaterThan(0);
      expect(position?.y).toBeGreaterThan(0);
    }).toPass();
  });

  test('opens the node page on double-click', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Open me', position: { x: 0, y: 0 } });
    await page.goto('/');
    await page.locator('.react-flow__node', { hasText: 'Open me' }).dblclick();
    await expect(page).toHaveURL(new RegExp(`/nodes/${node.id}$`));
  });
});
