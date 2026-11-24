import { asPhoneApp, expect, hubUrl, openSync, phoneWithCopy, test } from './fixtures';

test.describe('read-only mode (the phone app)', () => {
  test('a node is shown to read: no editor, no delete, links still navigate', async ({
    page,
    api,
  }) => {
    const a = await api.createNode({
      title: 'Rust',
      content: '# Ownership\n\nEach value has **one** owner.',
    });
    const b = await api.createNode({ title: 'Borrowing' });
    await api.createEdge(a.id, b.id, 'HAS');
    const tag = await api.createTag('Lang');
    await page.request.put(`/api/nodes/${a.id}/tags/${tag.id}`);

    await phoneWithCopy(page, api);
    await page.goto(`/nodes/${a.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Rust' })).toBeVisible();
    await expect(
      page.getByTestId('markdown-preview').getByRole('heading', { name: 'Ownership' }),
    ).toBeVisible();
    await expect(page.getByTestId('markdown-preview').locator('strong')).toHaveText('one');
    await expect(page.getByRole('main').getByText('Lang')).toBeVisible(); // its tag chip

    // Nothing to edit with.
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete node' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'Add link' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Rename link/ })).toHaveCount(0);

    await page.getByTestId('edges-outgoing').getByRole('link', { name: 'Borrowing' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Borrowing' })).toBeVisible();
  });

  test('no way to create, and no tags editor', async ({ page, api }) => {
    await api.createNode({ title: 'Solo' });
    await phoneWithCopy(page, api);
    await expect(page.getByRole('navigation', { name: 'Nodes' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New' })).toHaveCount(0);
    await expect(page.getByRole('form', { name: 'New node' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Tags' })).toHaveCount(0);
    await page.goto('/tags');
    await expect(page).toHaveURL(/\/$/);
  });

  test('the node menu only offers what changes nothing', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Right-click; the same menu opens by long-press.');
    await api.createNode({ title: 'Menu' });
    await phoneWithCopy(page, api);
    await page
      .getByRole('navigation', { name: 'Nodes' })
      .getByRole('link', { name: /Menu/ })
      .click({ button: 'right' });
    await expect(page.getByRole('menuitem')).toHaveText([
      'Open',
      'Reveal in Graph',
      'Copy Title',
      'Copy Link',
    ]);
  });

  test('a link’s menu only opens its ends', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Right-click on the canvas.');
    const a = await api.createNode({ title: 'Here', position: { x: 0, y: 0 } });
    const b = await api.createNode({ title: 'There', position: { x: 400, y: 0 } });
    const edge = await api.createEdge(a.id, b.id, 'TO');
    await phoneWithCopy(page, api);
    // The link is drawn once its nodes are measured; clicking earlier hits nothing.
    await expect(page.locator('.react-flow__edge-text').first()).toBeVisible();
    await page.getByTestId(`rf__edge-${edge.id}`).click({ button: 'right', force: true });
    await expect(page.getByRole('menuitem')).toHaveText(['Open “Here”', 'Open “There”']);
  });

  test('the phone pairs with the hub as a read-only device and only pulls', async ({
    page,
    api,
  }) => {
    await api.createNode({ title: 'Anything' });
    await api.publishToHub();
    let body: unknown;
    page.on('request', (r) => {
      if (r.url().endsWith('/api/hub/pair')) body = r.postDataJSON();
    });
    await asPhoneApp(page);
    await page.goto('/');
    await openSync(page);
    const dialog = page.getByRole('dialog', { name: 'Sync' });
    await dialog.getByLabel('Hub address').fill(hubUrl());
    await dialog.getByRole('button', { name: 'Connect' }).click();
    await expect(dialog.getByRole('button', { name: 'Pull', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Push' })).toHaveCount(0);
    expect(body).toEqual({ code: '', name: 'Phone', readOnly: true });
  });

  test('the phone keeps its copy offline, and says it is offline', async ({ page, api }) => {
    await api.createNode({ title: 'Pocket note' });
    await phoneWithCopy(page, api);
    // No network: every request to the hub fails. The phone asks no server for data.
    const asked: string[] = [];
    await page.route('**/api/**', (route) => {
      asked.push(route.request().url());
      return route.abort('internetdisconnected');
    });
    await page.reload();
    await expect(
      page.getByRole('navigation', { name: 'Nodes' }).getByRole('link', { name: /Pocket note/ }),
    ).toBeVisible();
    await expect(page.getByRole('banner').getByText('Offline')).toBeVisible();
    expect(asked.every((url) => url.includes('/api/hub/'))).toBe(true);
  });

  test('a read-only session in a normal browser is read-only too', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Seen' });
    await page.route('/api/auth/status', (r) =>
      r.fulfill({
        json: { enabled: true, signedIn: true, expiresAt: Date.now() + 3_600_000, readOnly: true },
      }),
    );
    await page.goto(`/nodes/${node.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Seen' })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0);
  });

  test('the graph can be looked at, not rearranged', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Mouse drag; touch drag goes through the same React Flow switch.');
    await api.createNode({ title: 'Still', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Other', position: { x: 300, y: 0 } });
    await phoneWithCopy(page, api);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET')
        writes.push(`${r.method()} ${r.url()}`);
    });
    const box = async (title: string) => {
      const b = await page.locator('.react-flow__node', { hasText: title }).boundingBox();
      if (!b) throw new Error(`${title} not rendered`);
      return b;
    };
    const gap = async () => {
      const [a, b] = [await box('Still'), await box('Other')];
      return { dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y) };
    };
    const before = await box('Still');
    const gapBefore = await gap();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + 150, before.y + 120, { steps: 10 });
    await page.mouse.up();
    await page.keyboard.press('Delete');

    // Dragging a node only pans the view: the nodes keep their places.
    expect(await gap()).toEqual(gapBefore);
    await expect(page.locator('.react-flow__node')).toHaveCount(2);
    expect(writes).toEqual([]);
  });
});
