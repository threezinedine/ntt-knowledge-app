import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const quickBox = (page: Page) =>
  page.getByRole('dialog', { name: 'Quick input' }).getByRole('combobox');

async function runCommand(page: Page, title: string) {
  await page.keyboard.press('F1');
  await quickBox(page).fill(`>${title}`); // '>' = commands, not nodes
  await page.keyboard.press('Enter');
}

test.describe('backup and markdown export (command palette)', () => {
  test('Backup Now writes a database copy and says where', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard; one profile is enough here.');
    await api.createNode({ title: 'Backed up' });
    await page.goto('/');
    await runCommand(page, 'Backup Now');
    const toast = page.getByRole('status').filter({ hasText: 'Backup saved' });
    await expect(toast).toContainText(/Backup saved: (km-[\w-]+\.sqlite) \(\d+ KB\) in /);
    const text = (await toast.textContent()) ?? '';
    const [, file = '', dir = ''] = /Backup saved: (\S+) \(.+?\) in (.+)$/.exec(text) ?? [];
    expect(existsSync(join(dir, file))).toBe(true);
  });

  test('Export Markdown writes one .md per node', async ({ page, api, isMobile }) => {
    test.skip(isMobile, 'The palette needs a hardware keyboard; one profile is enough here.');
    const a = await api.createNode({ title: 'Rust', content: 'Ownership rules.' });
    const b = await api.createNode({ title: 'Borrowing' });
    await api.createEdge(a.id, b.id, 'HAS');
    await page.goto('/');
    await runCommand(page, 'Export Markdown');
    const toast = page.getByRole('status').filter({ hasText: 'Markdown export written' });
    await expect(toast).toContainText('(notes: 2)');
    const text = (await toast.textContent()) ?? '';
    const [, dir = ''] = /written to (.+) \(notes/.exec(text) ?? [];
    expect(readdirSync(dir).sort()).toEqual(['Borrowing.md', 'Rust.md']);
    const md = readFileSync(join(dir, 'Rust.md'), 'utf8');
    expect(md).toContain('  - { relation: "HAS", to: "[[Borrowing]]" }');
    expect(md).toContain('Ownership rules.');
  });

  test('the phone app has neither command', async ({ page }) => {
    await page.addInitScript({
      content: 'window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };',
    });
    await page.goto('/');
    await page.keyboard.press('F1');
    await quickBox(page).fill('>Backup');
    await expect(page.getByRole('option', { name: /Backup Now/ })).toHaveCount(0);
    await quickBox(page).fill('>Export Markdown');
    await expect(page.getByRole('option', { name: /Export Markdown/ })).toHaveCount(0);
  });
});
