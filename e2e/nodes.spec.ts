import { expect, test } from './fixtures';

test.describe('node editing', () => {
  test('creates a node, edits title/type/markdown, and persists across reload', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New' }).click();

    await expect(page).toHaveURL(/\/nodes\/[0-9a-f-]{36}$/);
    const title = page.getByRole('textbox', { name: 'Title' });
    await expect(title).toHaveValue('Untitled');

    await title.fill('Graph databases');
    await page.getByRole('textbox', { name: 'Type' }).fill('topic');
    await page.locator('.cm-content').click();
    await page.keyboard.type('# Property graphs\n\nNodes and named edges.');

    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    await page.reload();
    await expect(title).toHaveValue('Graph databases');
    await expect(page.getByRole('textbox', { name: 'Type' })).toHaveValue('topic');
    await expect(page.locator('.cm-content')).toContainText('Nodes and named edges.');

    await page.getByRole('tab', { name: 'Preview' }).click();
    await expect(
      page.getByTestId('markdown-preview').getByRole('heading', { name: 'Property graphs' }),
    ).toBeVisible();

    const sidebar = page.getByRole('navigation', { name: 'Nodes' });
    await expect(sidebar.getByRole('link', { name: /Graph databases/ })).toBeVisible();
  });

  test('does not save a blank title', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Keep me' });
    await page.goto(`/nodes/${node.id}`);

    await page.getByRole('textbox', { name: 'Title' }).fill('   ');
    await expect(page.getByText('Title is required')).toBeVisible();
    // Content typed while the title is invalid must still be saved.
    await page.locator('.cm-content').click();
    await page.keyboard.type('Typed with a blank title');
    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Keep me');
    await expect(page.locator('.cm-content')).toContainText('Typed with a blank title');
  });

  test('dragging nodes on the graph does not reorder the sidebar', async ({ page, api }) => {
    const older = await api.createNode({ title: 'Older' });
    await api.createNode({ title: 'Newer' });
    await page.request.patch(`/api/nodes/${older.id}`, { data: { position: { x: 9, y: 9 } } });

    await page.goto('/');
    const links = page.getByRole('navigation', { name: 'Nodes' }).getByRole('link');
    await expect(links).toHaveText([/Newer/, /Older/]);
  });

  test('searches nodes by title', async ({ page, api }) => {
    await api.createNode({ title: 'Rust ownership' });
    await api.createNode({ title: 'Cooking pasta' });
    await page.goto('/');

    const sidebar = page.getByRole('navigation', { name: 'Nodes' });
    await page.getByRole('searchbox', { name: 'Search nodes' }).fill('rust');
    await expect(sidebar.getByRole('link')).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: /Rust ownership/ })).toBeVisible();
  });

  test('edits JSON properties', async ({ page, api }) => {
    const node = await api.createNode({ title: 'With props' });
    await page.goto(`/nodes/${node.id}`);

    const props = page.getByRole('textbox', { name: 'Properties JSON' });
    await props.fill('{ "priority": 2, "tags": ["a"] }');
    await props.blur();
    await expect(async () => {
      const res = await page.request.get(`/api/nodes/${node.id}`);
      expect(((await res.json()) as { props: unknown }).props).toEqual({
        priority: 2,
        tags: ['a'],
      });
    }).toPass();

    await props.fill('[1, 2]');
    await props.blur();
    await expect(page.getByText('Properties must be a JSON object')).toBeVisible();
  });

  test('deletes a node after confirmation', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Doomed' });
    await page.goto(`/nodes/${node.id}`);

    await page.getByRole('button', { name: 'Delete node' }).click();
    await page.getByRole('button', { name: 'Confirm delete' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('navigation', { name: 'Nodes' }).getByText('Doomed')).toHaveCount(
      0,
    );
  });
});
