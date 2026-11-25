import { expect, isNarrow, test } from './fixtures';

/**
 * Language selection. Other specs run in English (playwright.config.ts pins
 * `locale: 'en-US'`); these switch the browser language or use the picker.
 */
test.describe('localization', () => {
  test('starts in English and switches to Vietnamese, remembering the choice', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('link', { name: 'Graph', exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'Language' }).selectOption({ label: 'Tiếng Việt' });

    await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
    await expect(page.getByRole('link', { name: 'Đồ thị', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Thẻ', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Thêm nút' })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Ngôn ngữ' })).toHaveValue('vi');
    await expect(page.getByRole('link', { name: 'Đồ thị', exact: true })).toBeVisible();

    await page.getByRole('combobox', { name: 'Ngôn ngữ' }).selectOption({ label: 'English' });
    await expect(page.getByRole('link', { name: 'Graph', exact: true })).toBeVisible();
  });

  test.describe('with a Vietnamese browser', () => {
    test.use({ locale: 'vi-VN' });

    test('picks Vietnamese automatically', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
      await expect(page.getByRole('combobox', { name: 'Ngôn ngữ' })).toHaveValue('vi');
    });

    test('a whole node flow works with Vietnamese labels', async ({ page, api }) => {
      await api.createTag('Học');
      await page.goto('/');
      const tabs = page.getByRole('navigation', { name: 'Chế độ xem' });
      // A phone has the node list (and the fields) on tabs of their own.
      if (isNarrow(page)) await tabs.getByRole('link', { name: 'Node', exact: true }).click();
      await page.getByRole('button', { name: '+ Mới' }).click();

      const title = page.getByRole('textbox', { name: 'Tiêu đề' });
      await expect(title).toHaveValue('Chưa đặt tên'); // new nodes get a localized title
      await title.fill('Đồ thị tri thức');
      await expect(page.getByTestId('save-status')).toHaveText('Đã lưu');

      const tags = page.getByRole('region', { name: 'Thẻ' });
      await tags.getByRole('button', { name: 'Gắn thẻ Học' }).click();
      await expect(
        page.getByRole('group', { name: 'Thẻ của Đồ thị tri thức' }).getByText('Học'),
      ).toBeVisible();
      await page.getByRole('tab', { name: 'Xem trước' }).click();
      await expect(page.getByTestId('markdown-preview')).toBeVisible();

      // The field gains EXP and shows its level in Vietnamese.
      if (isNarrow(page)) await tabs.getByRole('link', { name: 'Lĩnh vực', exact: true }).click();
      const fields = page.getByRole('region', { name: 'Lĩnh vực' });
      await expect(fields.getByTestId('field-Học')).toContainText('Cấp 1');
    });

    test('server errors are shown in Vietnamese', async ({ page, api }) => {
      await api.createTag('Công việc');
      await page.goto('/tags');

      const form = page.getByRole('form', { name: 'Thẻ cấp cao nhất mới' });
      await form.getByRole('textbox').fill('công việc');
      await form.getByRole('button', { name: 'Thêm' }).click();

      await expect(form.getByText('Ở cấp này đã có thẻ trùng tên.')).toBeVisible();
    });
  });
});
