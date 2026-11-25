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

  test('on a narrow screen the new-node form stays clear of the top-right controls', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/');
    const form = await page.getByRole('form', { name: 'New node' }).boundingBox();
    const mode = await page.getByRole('group', { name: 'Graph view' }).boundingBox();
    if (!form || !mode) throw new Error('form or 2D | 3D switch not rendered');
    expect(form.x + form.width).toBeLessThanOrEqual(mode.x);
  });

  test('connects two nodes by dragging and names the relation', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Handle dragging is a pointer interaction; covered on desktop.');
    await api.createNode({ title: 'Source', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Target', position: { x: 300, y: 250 } });
    await page.goto('/');

    const source = page.locator('.react-flow__node', { hasText: 'Source' });
    const target = page.locator('.react-flow__node', { hasText: 'Target' });
    await source.hover(); // reveals the grip
    const from = await source.locator('.react-flow__handle-bottom').boundingBox();
    // Drop on the target's *label*, i.e. where a user aims, not on a hidden handle.
    const to = await target.locator('.km-node-label').boundingBox();
    if (!from || !to) throw new Error('grip or label not rendered');

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

  test('a short drag from the grip does not create a self-loop', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Pointer drag; covered on desktop.');
    await api.createNode({ title: 'Lonely', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Far away', position: { x: -500, y: -400 } });
    await page.goto('/');

    const node = page.locator('.react-flow__node', { hasText: 'Lonely' });
    await node.hover();
    const grip = await node.locator('.react-flow__handle-bottom').boundingBox();
    if (!grip) throw new Error('grip not rendered');
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 15, grip.y + 10, { steps: 5 });
    await page.mouse.up();

    await expect(page.getByRole('dialog', { name: 'New relation' })).toHaveCount(0);
  });

  test('draws parallel links between the same pair separately', async ({ page, api }) => {
    const a = await api.createNode({ title: 'Alice', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Bob', position: { x: 400, y: 0 } });
    await api.createEdge(a.id, b.id, 'KNOWS');
    await api.createEdge(a.id, b.id, 'WORKS_WITH');
    await api.createEdge(b.id, a.id, 'MENTORS');
    await page.goto('/');

    const labels = page.locator('.react-flow__edge-text');
    await expect(labels).toHaveCount(3);
    const ys = await Promise.all(
      (await labels.all()).map(async (l) => (await l.boundingBox())?.y ?? 0),
    );
    expect(new Set(ys.map(Math.round)).size).toBe(3);
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

  test('dragging a dot onto another pushes it aside, and keeps it there', async ({
    page,
    api,
    isMobile,
  }, testInfo) => {
    test.skip(isMobile, 'Pointer drag; covered on desktop.');
    const mover = await api.createNode({ title: 'Mover', position: { x: 0, y: 0 } });
    const sitter = await api.createNode({ title: 'Sitter', position: { x: 300, y: 0 } });
    await api.createNode({ title: 'Bystander', position: { x: 300, y: 400 } });
    await page.goto('/');

    const from = await page.locator(`.react-flow__node[data-id="${mover.id}"]`).boundingBox();
    const onto = await page.locator(`.react-flow__node[data-id="${sitter.id}"]`).boundingBox();
    if (!from || !onto) throw new Error('nodes not rendered');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Right onto the sitter's centre.
    await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 20 });
    await page.waitForTimeout(200); // let the nudge glide finish for the screenshot
    await testInfo.attach('mid-drag', { body: await page.screenshot(), contentType: 'image/png' });
    const sitterNow = await page.locator(`.react-flow__node[data-id="${sitter.id}"]`).boundingBox();
    expect(
      sitterNow && Math.abs(sitterNow.x - onto.x) + Math.abs(sitterNow.y - onto.y),
    ).toBeGreaterThan(10);
    // A slow save must not flash the pushed dot back to where it was.
    await page.route('**/api/nodes/positions', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 800));
      await route.continue();
    });
    await page.mouse.up();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(150);
      const box = await page.locator(`.react-flow__node[data-id="${sitter.id}"]`).boundingBox();
      expect(Math.abs((box?.x ?? 0) - (sitterNow?.x ?? 0))).toBeLessThan(2);
    }

    // Saved: the two dots no longer overlap on the server either.
    await expect(async () => {
      const get = async (id: string) =>
        ((await (await page.request.get(`/api/nodes/${id}`)).json()) as GraphNode).position;
      const a = await get(mover.id);
      const b = await get(sitter.id);
      if (!a || !b) throw new Error('no positions');
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
      expect(b).not.toEqual({ x: 300, y: 0 });
    }).toPass();
  });

  test('opens the node page on double-click', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Open me', position: { x: 0, y: 0 } });
    await page.goto('/');
    await page.locator('.react-flow__node', { hasText: 'Open me' }).dblclick();
    await expect(page).toHaveURL(new RegExp(`/nodes/${node.id}$`));
  });
});
