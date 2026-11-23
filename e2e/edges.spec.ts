import { expect, test } from './fixtures';

test.describe('links between nodes', () => {
  test('creates a named directed link from the node page and shows it on both ends', async ({
    page,
    api,
  }) => {
    const a = await api.createNode({ title: 'Service A' });
    await api.createNode({ title: 'Service B' });

    await page.goto(`/nodes/${a.id}`);
    const form = page.getByRole('form', { name: 'Add link' });
    await form.getByRole('combobox', { name: 'Relation' }).fill('DEPENDS_ON');
    await form.getByRole('combobox', { name: 'Target node' }).selectOption({ label: 'Service B' });
    await form.getByRole('button', { name: 'Link' }).click();

    const outgoing = page.getByTestId('edges-outgoing');
    await expect(outgoing).toContainText('[DEPENDS_ON]');
    await outgoing.getByRole('link', { name: 'Service B' }).click();

    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Service B');
    const incoming = page.getByTestId('edges-incoming');
    await expect(incoming).toContainText('Service A');
    await expect(incoming).toContainText('[DEPENDS_ON]');
  });

  test('reports a duplicate link', async ({ page, api }) => {
    const a = await api.createNode({ title: 'A' });
    const b = await api.createNode({ title: 'B' });
    await api.createEdge(a.id, b.id, 'R');

    await page.goto(`/nodes/${a.id}`);
    const form = page.getByRole('form', { name: 'Add link' });
    await form.getByRole('combobox', { name: 'Relation' }).fill('R');
    await form.getByRole('combobox', { name: 'Target node' }).selectOption({ label: 'B' });
    await form.getByRole('button', { name: 'Link' }).click();

    await expect(form.getByText(/already exists/)).toBeVisible();
  });

  test('removes a link', async ({ page, api }) => {
    const a = await api.createNode({ title: 'A' });
    const b = await api.createNode({ title: 'B' });
    await api.createEdge(a.id, b.id, 'R');

    await page.goto(`/nodes/${a.id}`);
    await page.getByRole('button', { name: 'Remove link R B' }).click();
    await expect(page.getByTestId('edges-outgoing')).toHaveCount(0);
  });

  test('shows labelled edges on the graph', async ({ page, api }) => {
    const a = await api.createNode({ title: 'Parent', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Child', position: { x: 0, y: 200 } });
    await api.createEdge(a.id, b.id, 'HAS_CHILD');

    await page.goto('/');
    const canvas = page.getByTestId('graph-canvas');
    await expect(canvas.locator('.react-flow__node', { hasText: 'Parent' })).toBeVisible();
    await expect(canvas.locator('.react-flow__node', { hasText: 'Child' })).toBeVisible();
    await expect(canvas.locator('.react-flow__edge-text', { hasText: 'HAS_CHILD' })).toBeVisible();
  });
});
