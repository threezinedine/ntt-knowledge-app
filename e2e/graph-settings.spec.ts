import type { Page } from '@playwright/test';
import { expect, phoneWithCopy, test } from './fixtures';

const radiusOf = async (page: Page, title: string) =>
  (await page.locator('.react-flow__node', { hasText: title }).locator('.km-node').boundingBox())
    ?.width;

test.describe('graph settings', () => {
  test('the panel beside the graph changes the look at once and remembers it', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Sliders beside the canvas; the phone app has its own tab.');
    const a = await api.createNode({ title: 'Hub', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Leaf', position: { x: 300, y: 0 } });
    const c = await api.createNode({ title: 'Other', position: { x: 0, y: 300 } });
    await api.createEdge(a.id, b.id, 'HAS');
    await api.createEdge(a.id, c.id, 'HAS');
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    const panel = page.getByRole('region', { name: 'Graph settings', exact: true });
    await expect(panel).toBeVisible();

    const before = await radiusOf(page, 'Hub');
    await panel.getByRole('slider', { name: /Largest dot/ }).fill('60');
    await expect.poll(() => radiusOf(page, 'Hub')).toBeGreaterThan(before ?? Infinity);

    // What is drawn really changes (a slider that only moves itself once shipped).
    const first = (selector: string) => page.locator(selector).first();
    await panel.getByRole('slider', { name: 'Line thickness' }).fill('4');
    await expect(first('.react-flow__edge-path.km-edge')).toHaveCSS('stroke-width', '4px');
    await panel.getByRole('slider', { name: 'Node name size' }).fill('20');
    await expect(first('.km-node-label')).toHaveCSS('font-size', '20px');
    await panel.getByRole('slider', { name: 'Link name size' }).fill('16');
    await expect(first('.react-flow__edge-text')).toHaveCSS('font-size', '16px');
    await panel.getByRole('slider', { name: 'Node name strength' }).fill('0.5');
    await expect(first('.km-node-label')).toHaveCSS('opacity', '0.5');
    // Arrow heads keep their size on a thick line.
    const marker = page.locator('marker').first();
    expect(await marker.getAttribute('markerUnits')).toBe('userSpaceOnUse');
    expect(await marker.getAttribute('markerWidth')).toBe('17');

    await panel.getByRole('checkbox', { name: 'Show link names' }).uncheck();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'HAS' })).toHaveCount(0);

    // Kept on this device, panel open state included.
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Show link names' })).not.toBeChecked();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'HAS' })).toHaveCount(0);

    await panel
      .getByRole('region', { name: 'Link names' })
      .getByRole('button', { name: 'Reset to defaults' })
      .click();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'HAS' })).toHaveCount(2);

    await panel.getByRole('button', { name: 'Close graph settings' }).click();
    await expect(panel).toBeHidden();
    const gear = page.getByRole('button', { name: 'Graph Settings' });
    await expect(gear).toBeFocused();

    // Opening moves focus into the panel; Escape closes it.
    await gear.click();
    await expect(panel.getByRole('button', { name: 'Close graph settings' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(gear).toBeFocused();
  });

  test('the phone app tunes the look on its own tab, not over the graph', async ({ page, api }) => {
    await api.createNode({ title: 'Solo', position: { x: 0, y: 0 } });
    await phoneWithCopy(page, api);
    await expect(page.locator('.react-flow__node', { hasText: 'Solo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Graph Settings' })).toHaveCount(0);

    await page.getByRole('link', { name: 'Graph settings' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Graph settings' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Dots' })).toBeVisible();
    // Nothing is dragged on the phone.
    await expect(page.getByRole('region', { name: 'Push when dragging' })).toHaveCount(0);
  });
});
