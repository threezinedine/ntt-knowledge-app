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

  test('renames a link from the node page', async ({ page, api }) => {
    const a = await api.createNode({ title: 'A' });
    const b = await api.createNode({ title: 'B' });
    await api.createEdge(a.id, b.id, 'USES');

    await page.goto(`/nodes/${a.id}`);
    const outgoing = page.getByTestId('edges-outgoing');
    await outgoing.getByRole('button', { name: 'Rename link USES (B)' }).click();
    const input = outgoing.getByRole('textbox', { name: 'Link name' });
    await expect(input).toBeFocused();
    await input.fill('DEPENDS_ON');
    await input.press('Enter');
    await expect(outgoing).toContainText('[DEPENDS_ON]');
    // Focus goes back to the name, not to the top of the page.
    await expect(
      outgoing.getByRole('button', { name: 'Rename link DEPENDS_ON (B)' }),
    ).toBeFocused();

    // Escape keeps the old name.
    await outgoing.getByRole('button', { name: 'Rename link DEPENDS_ON (B)' }).click();
    await input.fill('NOPE');
    await input.press('Escape');
    await expect(outgoing).toContainText('[DEPENDS_ON]');

    await page.reload();
    await expect(page.getByTestId('edges-outgoing')).toContainText('[DEPENDS_ON]');
  });

  test('renames a link on the graph by double-clicking it', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Double-click is a pointer gesture.');
    const a = await api.createNode({ title: 'Up', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Down', position: { x: 300, y: 300 } });
    await api.createEdge(a.id, b.id, 'FLOWS');

    await page.goto('/');
    const label = page.locator('.react-flow__edge-text', { hasText: 'FLOWS' });
    // The label runs along the (diagonal) link.
    const transform = (await label.getAttribute('transform')) ?? '';
    expect(Number(/^rotate\((-?[\d.e-]+)/.exec(transform)?.[1])).toBeCloseTo(45, 0);
    await label.dblclick();
    const input = page.getByRole('textbox', { name: 'Link name' });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('FLOWS');
    await input.fill('FEEDS');
    await input.press('Enter');
    await expect(page.locator('.react-flow__edge-text', { hasText: 'FEEDS' })).toBeVisible();

    await page.reload();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'FEEDS' })).toBeVisible();
  });

  test('renaming onto an existing link is refused and the old name comes back', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Double-click is a pointer gesture.');
    const a = await api.createNode({ title: 'Left', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Right', position: { x: 400, y: 0 } });
    await api.createEdge(a.id, b.id, 'USES');
    await api.createEdge(a.id, b.id, 'OWNS');

    await page.goto('/');
    await page.locator('.react-flow__edge-text', { hasText: 'OWNS' }).dblclick();
    const input = page.getByRole('textbox', { name: 'Link name' });
    await input.fill('USES');
    await input.press('Enter');
    await expect(page.getByText(/Couldn't rename the link: .*already exists/)).toBeVisible();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'OWNS' })).toBeVisible();
    await expect(page.locator('.react-flow__edge-text', { hasText: 'USES' })).toHaveCount(1);
  });

  test('"Rename Link" in the palette renames the selected link', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Selecting an edge by click; the palette itself is covered elsewhere.');
    const a = await api.createNode({ title: 'P', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'Q', position: { x: 400, y: 0 } });
    await api.createEdge(a.id, b.id, 'SEES');

    await page.goto('/');
    await page.locator('.react-flow__edge-text', { hasText: 'SEES' }).click();
    await page.keyboard.press('ControlOrMeta+Shift+P');
    await page.keyboard.type('Rename Link');
    await page.getByRole('option', { name: /Rename Link/ }).click();
    const input = page.getByRole('textbox', { name: 'Link name' });
    await expect(input).toBeFocused();
    await input.fill('WATCHES');
    await input.press('Enter');
    await expect(page.locator('.react-flow__edge-text', { hasText: 'WATCHES' })).toBeVisible();
  });
});
