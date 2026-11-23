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
