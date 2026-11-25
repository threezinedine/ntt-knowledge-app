import { expect, test } from './fixtures';

test('the activity bar switches views and toggles the sidebar', async ({ page, isMobile }) => {
  await page.goto('/');
  const bar = page.getByRole('navigation', { name: 'Views' });
  const main = page.getByRole('main');
  const barBox = await bar.boundingBox();
  const mainBox = await main.boundingBox();
  if (!barBox || !mainBox) throw new Error('layout not rendered');
  if (isMobile) {
    // Phone: a tab bar under the content.
    expect(barBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height - 1);
  } else {
    // Desktop: a strip down the left edge.
    expect(barBox.x + barBox.width).toBeLessThanOrEqual(mainBox.x + 1);
  }

  await bar.getByRole('link', { name: 'Tags' }).click();
  await expect(page).toHaveURL(/\/tags$/);
  const sidebarToggle = bar.getByRole('button', { name: 'Toggle Sidebar Visibility' });
  const nodes = page.getByRole('navigation', { name: 'Nodes' });
  await expect(nodes).toBeVisible();
  await sidebarToggle.click();
  await expect(nodes).toBeHidden();
  await expect(sidebarToggle).toHaveAttribute('aria-pressed', 'false');
  await sidebarToggle.click();
  await expect(nodes).toBeVisible();
});

test('a long node list never makes the whole page scroll; Fields keeps its room', async ({
  page,
  api,
  isMobile,
}) => {
  test.skip(isMobile, 'The desktop sidebar.');
  const tag = await api.createTag('Field');
  for (let i = 0; i < 40; i++) {
    await api.createNode({ title: `Node ${String(i)}`, tagIds: [tag.id] });
  }
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Nodes' }).getByRole('link')).toHaveCount(40);
  const page_ = await page.evaluate(() => {
    type Doc = { scrollingElement: { scrollHeight: number; clientHeight: number } };
    const doc = (globalThis as unknown as { document: Doc }).document.scrollingElement;
    return { scroll: doc.scrollHeight, view: doc.clientHeight };
  });
  expect(page_.scroll).toBeLessThanOrEqual(page_.view);
  const fields = await page.getByRole('region', { name: 'Fields' }).boundingBox();
  if (!fields) throw new Error('Fields not rendered');
  expect(fields.y + fields.height).toBeLessThanOrEqual(600);
  expect(fields.height).toBeGreaterThan(40); // not squeezed to its heading
});
