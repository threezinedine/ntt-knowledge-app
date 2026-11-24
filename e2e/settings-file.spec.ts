import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

const settingsFile = (settings: Record<string, unknown>) => ({
  name: 'km-settings.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify({ format: 'km-settings/1', settings })),
});

test.describe('settings file', () => {
  test('export downloads this device’s settings as JSON', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Downloads; the phone app copies instead.');
    await page.goto('/');
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    const panel = page.getByRole('region', { name: 'Graph settings', exact: true });
    await panel.getByRole('checkbox', { name: 'Show arrows' }).uncheck();

    const download = page.waitForEvent('download');
    await panel.getByRole('button', { name: 'Export Settings…' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^km-settings-\d{4}-\d{2}-\d{2}\.json$/);
    const doc = JSON.parse(await readFile(await file.path(), 'utf8')) as {
      format: string;
      settings: { graph?: { showArrows?: boolean } };
    };
    expect(doc.format).toBe('km-settings/1');
    expect(doc.settings.graph?.showArrows).toBe(false);
  });

  test('import loads a file, reloads and keeps what the file lacks', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard; the phone tab is tested below.');
    await page.goto('/');
    // A non-default this device has and the file doesn't mention.
    await page.getByRole('button', { name: 'Graph Settings' }).click();
    await page
      .getByRole('region', { name: 'Graph settings', exact: true })
      .getByRole('checkbox', { name: 'Show arrows' })
      .uncheck();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Show All Commands' }).click();
    await page.keyboard.type('Import Settings');
    await page.keyboard.press('Enter');
    await (
      await chooser
    ).setFiles(settingsFile({ language: 'vi', graph: { showLinkLabels: false }, bogus: 1 }));

    // Reloaded in Vietnamese, with a note of what was skipped.
    await expect(page.getByRole('status').filter({ hasText: 'Đã nhập cài đặt (2)' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: 'bogus' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Cài đặt graph', exact: true });
    await expect(panel.getByRole('checkbox', { name: 'Hiện tên liên kết' })).not.toBeChecked();
    await expect(panel.getByRole('checkbox', { name: 'Hiện mũi tên' })).not.toBeChecked(); // kept
  });

  test('a file that is not settings changes nothing', async ({ page, isMobile }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard.');
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Show All Commands' }).click();
    await page.keyboard.type('Import Settings');
    await page.keyboard.press('Enter');
    await (
      await chooser
    ).setFiles({
      name: 'x.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"hello":1}'),
    });
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'That is not a Knowledge Manager settings file.' }),
    ).toBeVisible();
  });

  test('the phone app’s settings tab can import too', async ({ page }) => {
    await page.addInitScript({
      content: 'window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };',
    });
    await page.goto('/graph-settings');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import Settings…' }).click();
    await (await chooser).setFiles(settingsFile({ graph: { maxRadius: 80 } }));
    await expect(
      page.getByRole('status').filter({ hasText: 'Settings imported (1)' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Export Settings…' })).toBeVisible();
  });

  test('the phone app copies its settings instead of downloading', async ({ page }) => {
    await page.addInitScript({
      content: 'window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };',
    });
    await page.goto('/graph-settings');
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await page.getByRole('button', { name: 'Export Settings…' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings copied' })).toBeVisible();
    expect(downloaded).toBe(false);
  });
});
