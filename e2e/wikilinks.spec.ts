import type { Page } from '@playwright/test';
import { expect, phoneWithCopy, test } from './fixtures';

/** In-app navigation away from the node page (unmounts the editor, unlike a reload). */
const leaveToGraph = (page: Page) =>
  page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: 'Graph' }).click();

test.describe('wikilinks', () => {
  test('[[Title]] in the preview opens that node; an unknown title stays text', async ({
    page,
    api,
  }) => {
    const redis = await api.createNode({ title: 'Redis' });
    const notes = await api.createNode({
      title: 'Notes',
      content: 'Cache: [[Redis|the cache]]. Later: [[Nope]].',
    });
    await page.goto(`/nodes/${notes.id}`);
    await page.getByRole('tab', { name: 'Preview' }).click();
    const preview = page.getByTestId('markdown-preview');
    await expect(preview.getByRole('link')).toHaveCount(1);
    await expect(preview).toContainText('[[Nope]]');
    await preview.getByRole('link', { name: 'the cache' }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${redis.id}$`));
  });

  test('leaving a node links what it mentions; typing [[ suggests titles', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Typing with a hardware keyboard; the phone app only views.');
    await api.createNode({ title: 'Redis' });
    await api.createNode({ title: 'Kafka' });
    const notes = await api.createNode({ title: 'Notes' });
    await page.goto(`/nodes/${notes.id}`);

    await page.locator('.cm-content').click();
    await page.keyboard.type('We use redis. See [[Ka');
    await page
      .getByRole('listbox', { name: 'Completions' })
      .getByRole('option', { name: 'Kafka' })
      .click();
    await expect(page.locator('.cm-content')).toHaveText('We use redis. See [[Kafka]]');
    await expect(page.getByTestId('save-status')).toHaveText('Saved');
    // Not linked while still on the page...
    expect((await api.getNode(notes.id)).content).toBe('We use redis. See [[Kafka]]');

    await leaveToGraph(page);
    await expect
      .poll(async () => (await api.getNode(notes.id)).content)
      .toBe('We use [[Redis|redis]]. See [[Kafka]]');
  });

  test('renaming a node rewrites the links to it', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'Editing; the phone app only views.');
    const redis = await api.createNode({ title: 'Redis' });
    const other = await api.createNode({ title: 'Other', content: 'Uses [[Redis]].' });
    await page.goto(`/nodes/${redis.id}`);
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.fill('Valkey');
    await expect(page.getByTestId('save-status')).toHaveText('Saved');

    await leaveToGraph(page);
    await expect.poll(async () => (await api.getNode(other.id)).content).toBe('Uses [[Valkey]].');
  });

  test('a node added on the graph links its mentions elsewhere', async ({ page, api }) => {
    const notes = await api.createNode({ title: 'Notes', content: 'Kafka is a log.' });
    await page.goto('/');
    await page.getByRole('textbox', { name: 'New node title' }).fill('Kafka');
    await page.getByRole('button', { name: 'Add node' }).click();
    await expect
      .poll(async () => (await api.getNode(notes.id)).content)
      .toBe('[[Kafka]] is a log.');
  });

  test('the graph draws wikilinks as dashed lines; a setting hides them', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'The settings panel beside the canvas; the phone has its own tab.');
    const redis = await api.createNode({ title: 'Redis', position: { x: 0, y: 0 } });
    await api.createNode({ title: 'Notes', content: 'See [[Redis]].', position: { x: 300, y: 0 } });
    const kafka = await api.createNode({
      title: 'Kafka',
      content: '[[Redis]] too',
      position: { x: 0, y: 300 },
    });
    await api.createEdge(kafka.id, redis.id, 'FEEDS'); // a real link: no dashed line on top
    await page.goto('/');
    const dashed = page.locator('.km-wikilink');
    await expect(dashed).toHaveCount(1);
    await expect(page.locator('.km-edge')).toHaveCount(1);

    await page.getByRole('button', { name: 'Graph Settings' }).click();
    const panel = page.getByRole('region', { name: 'Graph settings', exact: true });
    await panel.getByRole('checkbox', { name: 'Show wikilinks (dashed)' }).uncheck();
    await expect(dashed).toHaveCount(0);
  });

  test('the node page shows its local graph, with its own depth', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'Editing page; the phone app only views.');
    const a = await api.createNode({ title: 'Alpha' });
    const b = await api.createNode({ title: 'Beta' });
    const c = await api.createNode({ title: 'Gamma' });
    await api.createNode({ title: 'Far away' });
    await api.createEdge(a.id, b.id, 'NEXT');
    await api.createEdge(b.id, c.id, 'NEXT');
    await page.goto(`/nodes/${a.id}`);

    const panel = page.getByRole('region', { name: 'Local graph' });
    const local = panel.getByTestId('local-graph');
    const dot = (title: string) => local.locator('.react-flow__node', { hasText: title });
    await expect(dot('Alpha')).toBeVisible();
    await expect(dot('Beta')).toBeVisible();
    await expect(dot('Gamma')).toHaveCount(0); // two steps away
    await panel.getByRole('combobox', { name: 'Local graph depth' }).selectOption('2');
    await expect(dot('Gamma')).toBeVisible();
    await expect(dot('Far away')).toHaveCount(0);

    // The wheel over it scrolls the page, as anywhere else on it (no scroll trap).
    const scrollTop = () =>
      page.getByRole('main').evaluate((el) => (el as { scrollTop: number }).scrollTop);
    await local.hover(); // (scrolls it into view first)
    const before = await scrollTop();
    await page.mouse.wheel(0, 200);
    await expect.poll(scrollTop).toBeGreaterThan(before);
    await local.scrollIntoViewIfNeeded();

    await dot('Beta').click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${b.id}$`));
    // The depth is remembered; folding hides the canvas.
    await expect(panel.getByRole('combobox', { name: 'Local graph depth' })).toHaveValue('2');
    await panel.getByRole('button', { name: 'Local graph' }).click();
    await expect(panel.getByTestId('local-graph')).toHaveCount(0);
  });

  test('on a touch screen a finger drag over the local graph scrolls the page', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Touch screens only.');
    const a = await api.createNode({ title: 'Alpha' });
    const b = await api.createNode({ title: 'Beta' });
    await api.createEdge(a.id, b.id, 'NEXT');
    await page.goto(`/nodes/${a.id}`);
    const local = page.getByTestId('local-graph');
    await local.scrollIntoViewIfNeeded();
    await expect(local.locator('.react-flow__node', { hasText: 'Beta' })).toBeVisible();
    const box = await local.boundingBox();
    if (!box) throw new Error('local graph not rendered');
    const scrollTop = () =>
      page.getByRole('main').evaluate((el) => (el as { scrollTop: number }).scrollTop);
    const before = await scrollTop();
    // A real finger drag (raw touch events): down the canvas, so the page scrolls up.
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 3;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + i * 12 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(before).toBeGreaterThan(0);
    await expect.poll(scrollTop).toBeLessThan(before);
  });

  test('the phone app shows wikilinks as links', async ({ page, api }) => {
    const redis = await api.createNode({ title: 'Redis' });
    const notes = await api.createNode({ title: 'Notes', content: 'See [[Redis]].' });
    await phoneWithCopy(page, api);
    await page.goto(`/nodes/${notes.id}`);
    await page.getByTestId('markdown-preview').getByRole('link', { name: 'Redis' }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${redis.id}$`));
  });
});
