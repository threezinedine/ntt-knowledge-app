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
    const preview = panel.getByTestId('link-check-preview');
    await expect(level).toHaveValue('1');
    await expect(preview).toContainText(/^2 notes · 1 links to check · \d+ characters$/);
    await level.selectOption('2');
    await expect(preview).toContainText(/^3 notes · 2 links to check/);

    await panel.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Link check prompt copied' }),
    ).toContainText(/\(3 notes, 2 links, \d+ characters\)/);
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

  test('shows the preview in the phone app too (nothing is saved back)', async ({ page, api }) => {
    const a = await api.createNode({ title: 'Alone' });
    await page.addInitScript({
      content: 'window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };',
    });
    await page.goto(`/nodes/${a.id}`);
    const panel = page.getByRole('region', { name: 'Link check' });
    await expect(panel.getByTestId('link-check-preview')).toContainText(
      '1 notes · 0 links to check',
    );
    await expect(panel.getByText(/No links at this level yet/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Copy prompt' })).toBeVisible();
  });
});
