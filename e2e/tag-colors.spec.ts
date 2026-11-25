import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** The dot's drawn colour as [r, g, b]. */
const rgbOf = async (page: Page, title: string) => {
  const css = await page
    .locator('.react-flow__node', { hasText: title })
    .locator('.km-node')
    // Runs in the browser; the e2e project has no DOM types, so name the one call it makes.
    .evaluate(
      (el) =>
        (
          globalThis as unknown as { getComputedStyle: (e: unknown) => { backgroundColor: string } }
        ).getComputedStyle(el).backgroundColor,
    );
  return (css.match(/\d+/g) ?? []).slice(0, 3).map(Number);
};
const redness = async (page: Page, title: string) => {
  const [r = 0, g = 0, b = 0] = await rgbOf(page, title);
  return r - (g + b) / 2;
};

test.describe('tag colours on the graph (experimental)', () => {
  test('the biggest dot takes its tag colour and it fades out along the links', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Uses the settings panel beside the canvas.');
    const science = await api.createTag('Science', null, '#ff0000');
    const physics = await api.createTag('Physics', science.id);
    const hub = await api.createNode({
      title: 'Hub',
      position: { x: 0, y: 0 },
      tagIds: [physics.id],
    });
    const near = await api.createNode({ title: 'Near', position: { x: 300, y: 0 } });
    const far = await api.createNode({ title: 'Far', position: { x: 600, y: 0 } });
    const other = await api.createNode({ title: 'Other', position: { x: 0, y: 300 } });
    await api.createNode({ title: 'Lone', position: { x: 600, y: 300 } });
    await api.createEdge(hub.id, near.id, 'HAS');
    await api.createEdge(far.id, near.id, 'HAS'); // pointing back still spreads
    await api.createEdge(other.id, hub.id, 'HAS');

    await page.goto('/');
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    const panel = page.getByRole('region', { name: 'Graph settings', exact: true });
    const colours = panel.getByRole('region', { name: 'Tag colours (experimental)' });
    await expect(colours.getByRole('slider', { name: 'Coloured big dots' })).toBeDisabled();
    const before = await rgbOf(page, 'Hub');

    await colours.getByRole('checkbox', { name: 'Colour dots by their tags' }).check();
    // A shade of the root's red, not the type colour it had.
    await expect.poll(() => redness(page, 'Hub')).toBeGreaterThan(100);
    expect(await rgbOf(page, 'Hub')).not.toEqual(before);
    await expect.poll(async () => (await redness(page, 'Near')) > 0).toBe(true);
    expect(await redness(page, 'Hub')).toBeGreaterThan(await redness(page, 'Near'));
    expect(await redness(page, 'Near')).toBeGreaterThan(await redness(page, 'Far'));
    expect(await rgbOf(page, 'Lone')).toEqual(before); // nothing reaches it
    // Only the big dot is drawn to stand out (ring and glow).
    await expect(page.locator('.km-node--hub')).toHaveCount(1);
    await expect(
      page.locator('.react-flow__node', { hasText: 'Hub' }).locator('.km-node'),
    ).toHaveClass(/km-node--hub/);

    // Ranked by EXP instead (needs the per-node EXP): Hub is still the only tagged dot.
    await colours.getByRole('combobox', { name: 'Biggest dots by' }).selectOption('Most EXP');
    await expect.poll(() => redness(page, 'Hub')).toBeGreaterThan(100);

    await colours.getByRole('checkbox', { name: 'Colour dots by their tags' }).uncheck();
    await expect.poll(() => rgbOf(page, 'Hub')).toEqual(before);
  });

  test('says why nothing changes when no top-level tag has a colour', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Uses the settings panel beside the canvas.');
    const root = await api.createTag('Plain');
    await api.createTag('Kid', root.id, '#ff0000'); // a nested tag's own colour doesn't count
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    await page.getByRole('checkbox', { name: 'Colour dots by their tags' }).check();
    await expect(page.getByRole('note')).toContainText('No top-level tag has a colour yet');
  });

  test('only a top-level tag has its own colour picker', async ({ page, api }) => {
    const science = await api.createTag('Science', null, '#ff0000');
    await api.createTag('Physics', science.id);
    await page.goto('/tags');

    await page.getByRole('button', { name: 'Edit tag Physics' }).click();
    const nested = page.getByRole('form', { name: 'Edit Physics' });
    await expect(nested.getByText('Colour comes from the parent tag')).toBeVisible();
    await expect(nested.getByLabel('Tag colour')).toHaveCount(0);
    await nested.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit tag Science' }).click();
    await expect(
      page.getByRole('form', { name: 'Edit Science' }).getByLabel('Tag colour'),
    ).toBeVisible();
  });
});
