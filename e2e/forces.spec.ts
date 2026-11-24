import type { Page } from '@playwright/test';
import { expect, phoneWithCopy, test } from './fixtures';

/** This spec's dots arrange themselves (the other specs turn that off). */
const withAutoLayout = (page: Page) =>
  page.addInitScript(() => {
    localStorage.setItem('km.graph.settings', JSON.stringify({ autoLayout: true }));
  });

const centre = async (page: Page, title: string) => {
  const b = await page.locator('.react-flow__node', { hasText: title }).boundingBox();
  if (!b) throw new Error(`${title} not drawn`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** The canvas's zoom, to turn screen distances back into graph units. */
const zoomOf = async (page: Page) => {
  const style = (await page.locator('.react-flow__viewport').getAttribute('style')) ?? '';
  return Number(/scale\(([\d.]+)\)/.exec(style)?.[1] ?? '1');
};

/** Waits until `title` stops moving (the dots have settled). */
async function settled(page: Page, title: string): Promise<void> {
  let last = await centre(page, title);
  await expect
    .poll(
      async () => {
        const now = await centre(page, title);
        const moved = distance(now, last);
        last = now;
        return moved;
      },
      { timeout: 15_000, intervals: [400] },
    )
    .toBeLessThan(0.5);
}

test.describe('auto layout (forces)', () => {
  test('dots arrange themselves: linked ones come together, stacked ones part', async ({
    page,
    api,
  }) => {
    await withAutoLayout(page);
    // Two linked dots far apart, two unlinked ones on top of each other.
    const a = await api.createNode({ title: 'Near A', position: { x: -2000, y: 0 } });
    const b = await api.createNode({ title: 'Near B', position: { x: 2000, y: 0 } });
    await api.createEdge(a.id, b.id, 'pulls');
    await api.createNode({ title: 'Stack 1', position: { x: 0, y: 300 } });
    await api.createNode({ title: 'Stack 2', position: { x: 0, y: 300 } });
    await page.goto('/');
    await expect(page.locator('.react-flow__node')).toHaveCount(4);

    // The view fits the graph once it settles; then the link is short and the stack apart.
    await expect
      .poll(
        async () => {
          const zoom = await zoomOf(page);
          return distance(await centre(page, 'Near A'), await centre(page, 'Near B')) / zoom;
        },
        { timeout: 10_000 },
      )
      .toBeLessThan(600);
    await settled(page, 'Stack 1');
    const apart =
      distance(await centre(page, 'Stack 1'), await centre(page, 'Stack 2')) / (await zoomOf(page));
    expect(apart).toBeGreaterThan(10);
  });

  test('dragging moves the others along, and saves no position', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Mouse drag; touch goes through the same React Flow events.');
    await withAutoLayout(page);
    const hub = await api.createNode({ title: 'Hub', position: { x: 0, y: 0 } });
    for (const title of ['One', 'Two']) {
      const n = await api.createNode({ title, position: { x: 40, y: 40 } });
      await api.createEdge(hub.id, n.id, 'has');
    }
    await page.goto('/');
    await settled(page, 'Hub');
    const before = { hub: await centre(page, 'Hub'), one: await centre(page, 'One') };
    await page.mouse.move(before.hub.x, before.hub.y);
    await page.mouse.down();
    await page.mouse.move(before.hub.x + 250, before.hub.y + 150, { steps: 20 });
    // While held, the others are pulled along.
    await expect
      .poll(async () => distance(await centre(page, 'One'), before.one))
      .toBeGreaterThan(20);
    const one = await centre(page, 'One');
    await page.mouse.up();
    expect(distance(one, before.one)).toBeGreaterThan(20);
    await settled(page, 'Hub');
    expect((await api.getNode(hub.id)).position).toEqual({ x: 0, y: 0 });
  });

  test('the forces are tuned in the graph settings, on the phone too', async ({ page, api }) => {
    await withAutoLayout(page);
    await api.createNode({ title: 'Solo' });
    await phoneWithCopy(page, api);
    await page.getByRole('link', { name: 'Graph settings' }).click();
    const forces = page.getByRole('region', { name: 'Forces' });
    await expect(forces.getByRole('checkbox', { name: 'Arrange automatically' })).toBeChecked();
    await expect(forces.getByRole('slider', { name: 'Push apart' })).toBeVisible();
  });

  test('Reveal in Graph stays on the node while the dots settle', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Right-click; checks the canvas viewport.');
    await withAutoLayout(page);
    const target = await api.createNode({ title: 'Target', position: { x: 2000, y: 2000 } });
    for (const title of ['Far 1', 'Far 2', 'Far 3']) {
      await api.createNode({ title, position: { x: -2000, y: -2000 } });
    }
    await page.goto(`/nodes/${target.id}`);
    await page
      .getByRole('navigation', { name: 'Nodes' })
      .getByRole('link', { name: /Target/ })
      .click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Reveal in Graph' }).click();
    await expect(page).toHaveURL(/\/$/);
    // Centred on it (not zoomed out to the whole graph), and kept there as it settles.
    const box = await page.getByTestId('graph-canvas').boundingBox();
    if (!box) throw new Error('no canvas');
    const offCentre = async () => {
      const c = await centre(page, 'Target');
      return distance(c, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    };
    await settled(page, 'Target');
    await expect.poll(offCentre).toBeLessThan(box.width / 4);
    await page.waitForTimeout(1_000); // past the first settle: no jump to the overview
    expect(await offCentre()).toBeLessThan(box.width / 4);
  });

  test('turned off: back to arranging by hand, with saved positions', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Mouse drag; covered on desktop.');
    await withAutoLayout(page);
    const n = await api.createNode({ title: 'Placed', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Other', position: { x: 300, y: 0 } });
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    const panel = page.getByRole('region', { name: 'Graph settings' });
    await panel.getByRole('checkbox', { name: 'Arrange automatically' }).uncheck();
    await expect(panel.getByRole('region', { name: 'Push when dragging' })).toBeVisible();
    await expect(panel.getByRole('slider', { name: 'Push apart' })).toBeDisabled();
    const start = await centre(page, 'Placed');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => (await api.getNode(n.id)).position?.x ?? 0).toBeGreaterThan(0);
  });
});
