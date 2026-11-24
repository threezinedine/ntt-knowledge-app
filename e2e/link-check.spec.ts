import { expect, test } from './fixtures';

test.describe('link check', () => {
  test('copies a fact-check prompt for the local graph, at the chosen level', async ({
    page,
    api,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'Clipboard permissions are desktop-only in the emulator.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const cpu = await api.createNode({ title: 'CPU', content: 'Runs instructions.' });
    const cache = await api.createNode({ title: 'Cache', content: 'Small and fast.' });
    const memory = await api.createNode({ title: 'Memory' });
    await api.createEdge(cpu.id, cache.id, 'USES');
    await api.createEdge(cache.id, memory.id, 'PART_OF');
    const tag = await api.createTag('Hardware');
    await page.request.put(`/api/nodes/${cpu.id}/tags/${tag.id}`);

    await page.goto(`/nodes/${cpu.id}`);
    const panel = page.getByRole('region', { name: 'Link check' });
    const level = panel.getByRole('combobox', { name: 'Local graph level' });
    const preview = panel.getByRole('status', { name: 'Prompt size' });
    await expect(level).toHaveValue('1');
    await expect(preview).toHaveText(/^Notes: 2 · links to check: 1 · characters: \d+$/);
    await level.selectOption('2');
    await expect(preview).toContainText('Notes: 3 · links to check: 2');

    await panel.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Link check prompt copied' }),
    ).toContainText(/\(notes: 3, links: 2, characters: \d+\)/);
    // Windows' clipboard turns \n into \r\n.
    const copied = (await page.evaluate<string>('navigator.clipboard.readText()')).replace(
      /\r\n/g,
      '\n',
    );
    expect(copied).toContain('Starting note: [N1] CPU. Level 2');
    expect(copied).toContain('## [N1] CPU (starting note)\nTags: Hardware');
    expect(copied).toContain('Runs instructions.');
    expect(copied).toContain('- L1: [N1] CPU -[USES]-> [N2] Cache');
    expect(copied).toContain('- L2: [N2] Cache -[PART_OF]-> [N3] Memory');

    // The level is remembered; the shortcut copies the Vietnamese version.
    await page.reload();
    await expect(level).toHaveValue('2');
    await panel.getByRole('combobox', { name: 'Prompt language' }).selectOption('vi');
    await page.evaluate('navigator.clipboard.writeText("")');
    await panel.getByRole('heading', { name: 'Link check' }).click();
    await page.keyboard.press('Alt+Shift+L');
    await expect
      .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
      .toContain('Ghi chú gốc: [N1] CPU. Level 2');
  });

  test('copies from a browser on another PC, where plain http has no Clipboard API', async ({
    page,
    api,
  }) => {
    const a = await api.createNode({ title: 'Rust', content: 'Ownership.' });
    const b = await api.createNode({ title: 'Borrowing' });
    await api.createEdge(a.id, b.id, 'HAS');
    // http://<lan-ip>: not a secure context, so no navigator.clipboard;
    // record what the old copy command copies instead.
    await page.addInitScript({
      content: `
        Object.defineProperty(navigator, 'clipboard', { value: undefined });
        window.__copied = null;
        document.execCommand = (cmd) => {
          if (cmd !== 'copy') return false;
          window.__copied = document.activeElement && document.activeElement.value;
          return true;
        };`,
    });
    await page.goto(`/nodes/${a.id}`);
    const panel = page.getByRole('region', { name: 'Link check' });
    await expect(panel.getByRole('status', { name: 'Prompt size' })).toContainText(
      'Notes: 2 · links to check: 1',
    );
    await panel.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Link check prompt copied' }),
    ).toBeVisible();
    const copied = await page.evaluate<string | null>('window.__copied');
    expect(copied).toContain('- L1: [N1] Rust -[HAS]-> [N2] Borrowing');
    expect(copied).toContain('Ownership.');
  });

  test('says when a level has no links to check', async ({ page, api }) => {
    const a = await api.createNode({ title: 'Alone' });
    await page.goto(`/nodes/${a.id}`);
    const panel = page.getByRole('region', { name: 'Link check' });
    await expect(panel.getByRole('status', { name: 'Prompt size' })).toContainText(
      'Notes: 1 · links to check: 0',
    );
    await expect(panel.getByText(/No links at this level yet/)).toBeVisible();
  });
});
