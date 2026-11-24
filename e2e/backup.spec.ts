import type { Page } from '@playwright/test';
import { asPhoneApp, expect, test } from './fixtures';

const quickBox = (page: Page) =>
  page.getByRole('dialog', { name: 'Quick input' }).getByRole('combobox');

async function runCommand(page: Page, title: string) {
  await page.keyboard.press('F1');
  await quickBox(page).fill(`>${title}`); // '>' = commands, not nodes
  await page.keyboard.press('Enter');
}

/** A folder picker that keeps what is written to it, in the page (window.__written). */
const fakeFolderPicker = (page: Page) =>
  page.addInitScript(() => {
    const written: Record<string, string> = {};
    (window as unknown as { __written: typeof written }).__written = written;
    (window as unknown as { showDirectoryPicker: unknown }).showDirectoryPicker = () =>
      Promise.resolve({
        name: 'notes',
        getFileHandle: (name: string) =>
          Promise.resolve({
            createWritable: () =>
              Promise.resolve({
                write: (text: string) => {
                  written[name] = text;
                  return Promise.resolve();
                },
                close: () => Promise.resolve(),
              }),
          }),
      });
  });

test.describe('markdown export and files on disk (command palette)', () => {
  test('Export Markdown writes one .md per node into the folder you pick', async ({
    page,
    api,
    isMobile,
  }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard; one profile is enough here.');
    await fakeFolderPicker(page);
    const a = await api.createNode({ title: 'Rust', content: 'Ownership rules.' });
    const b = await api.createNode({ title: 'Borrowing' });
    await api.createEdge(a.id, b.id, 'HAS');
    await page.goto('/');
    await runCommand(page, 'Export Markdown');
    await expect(page.getByRole('status').filter({ hasText: 'written to notes' })).toContainText(
      '(notes: 2)',
    );
    const written = await page.evaluate(
      () => (window as unknown as { __written: Record<string, string> }).__written,
    );
    expect(Object.keys(written).sort()).toEqual(['Borrowing.md', 'Rust.md']);
    expect(written['Rust.md']).toContain('  - { relation: "HAS", to: "[[Borrowing]]" }');
    expect(written['Rust.md']).toContain('Ownership rules.');
  });

  test('the phone app has none of these commands', async ({ page }) => {
    await asPhoneApp(page);
    await page.goto('/');
    await page.keyboard.press('F1');
    await quickBox(page).fill('>Export Markdown');
    await expect(page.getByRole('option', { name: /Export Markdown/ })).toHaveCount(0);
    await quickBox(page).fill('>to a File');
    await expect(page.getByRole('option', { name: /to a File/ })).toHaveCount(0);
  });
});

test.describe('this device’s copy', () => {
  test('saved to a file you pick, again after every change', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard; one profile is enough here.');
    // A save-file picker that records each write's size, in the page.
    await page.addInitScript(() => {
      const writes: number[] = [];
      (window as unknown as { __writes: number[] }).__writes = writes;
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = () =>
        Promise.resolve({
          name: 'km.sqlite',
          queryPermission: () => Promise.resolve('granted'),
          createWritable: () =>
            Promise.resolve({
              write: (bytes: Uint8Array) => {
                writes.push(bytes.byteLength);
                return Promise.resolve();
              },
              close: () => Promise.resolve(),
            }),
        });
    });
    await api.createNode({ title: 'Kept' });
    await page.goto('/');
    await runCommand(page, 'Save This Device');
    await expect(
      page.getByRole('status').filter({ hasText: 'Saving this device’s copy to km.sqlite' }),
    ).toBeVisible();
    const writes = () =>
      page.evaluate(() => (window as unknown as { __writes: number[] }).__writes.length);
    expect(await writes()).toBe(1);
    await api.createNode({ title: 'Another' });
    await expect.poll(writes, { timeout: 5_000 }).toBe(2);
  });

  test('one tab at a time: a second one says the copy is open elsewhere', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('banner')).toBeVisible();
    const second = await context.newPage();
    await second.goto('/');
    await expect(second.getByRole('heading', { name: 'Open in another tab' })).toBeVisible({
      timeout: 10_000,
    });
  });
});
