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

  test('the phone app shows wikilinks as links', async ({ page, api }) => {
    const redis = await api.createNode({ title: 'Redis' });
    const notes = await api.createNode({ title: 'Notes', content: 'See [[Redis]].' });
    await phoneWithCopy(page, api);
    await page.goto(`/nodes/${notes.id}`);
    await page.getByTestId('markdown-preview').getByRole('link', { name: 'Redis' }).click();
    await expect(page).toHaveURL(new RegExp(`/nodes/${redis.id}$`));
  });
});
