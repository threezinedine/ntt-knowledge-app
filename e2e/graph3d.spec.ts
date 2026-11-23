import { expect, test } from './fixtures';

test.describe('3D graph', () => {
  test('switches to 3D, remembers it, and Shift+3 switches back', async ({ page, api }) => {
    const a = await api.createNode({ title: 'Sun', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Earth', position: { x: 300, y: 0 } });
    await api.createEdge(b.id, a.id, 'ORBITS');

    await page.goto('/');
    const modes = page.getByRole('group', { name: 'Graph view' });
    await expect(modes.getByRole('button', { name: '2D' })).toHaveAttribute('aria-pressed', 'true');
    await modes.getByRole('button', { name: '3D' }).click();
    await expect(modes.getByRole('button', { name: '3D' })).toHaveAttribute('aria-pressed', 'true');

    const view = page.getByRole('img', { name: '3D graph: 2 nodes, 1 links' });
    await expect(view).toBeVisible();
    await expect(view.locator('canvas')).toBeVisible(); // WebGL is up
    await expect(page.getByTestId('graph-canvas')).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('img', { name: /^3D graph/ })).toBeVisible();

    await page.keyboard.press('Shift+3');
    await expect(page.getByTestId('graph-canvas')).toBeVisible();
    await expect(page.getByRole('img', { name: /^3D graph/ })).toHaveCount(0);
  });

  test('without WebGL it says so instead of a blank page', async ({ page }) => {
    // Every WebGL context request fails, as on a machine without GPU support.
    await page.addInitScript({
      content: `
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
          return String(kind).startsWith('webgl') ? null : original.call(this, kind, ...rest);
        };
      `,
    });
    await page.goto('/');
    await page
      .getByRole('group', { name: 'Graph view' })
      .getByRole('button', { name: '3D' })
      .click();
    await expect(
      page.getByText("The 3D view needs WebGL, which this browser can't provide."),
    ).toBeVisible();
    // 2D still works from here.
    await page.getByRole('button', { name: '2D' }).click();
    await expect(page.getByTestId('graph-canvas')).toBeVisible();
  });
});
