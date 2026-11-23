import { expect, test } from './fixtures';

test.describe('tasks and categories', () => {
  test('builds a category tree and files a task under a sub-category', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Launch' });

    await page.goto('/categories');
    const form = page.getByRole('form', { name: 'Add category' });
    await form.getByRole('textbox', { name: 'Category name' }).fill('Work');
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.category-tree').getByText('Work')).toBeVisible();

    await form.getByRole('textbox', { name: 'Category name' }).fill('Backend');
    await form.getByRole('combobox', { name: 'Parent category' }).selectOption({ label: 'Work' });
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.category-tree .category-tree').getByText('Backend')).toBeVisible();

    await page.goto(`/nodes/${node.id}`);
    const taskForm = page.getByRole('form', { name: 'Add task' });
    await taskForm.getByRole('textbox', { name: 'New task' }).fill('Write API');
    await taskForm
      .getByRole('combobox', { name: 'Task category' })
      .selectOption({ label: 'Work / Backend' });
    await taskForm.getByRole('button', { name: 'Add' }).click();

    const list = page.getByTestId('task-list');
    await expect(list.getByText('Write API')).toBeVisible();
    await expect(list.getByText('Work / Backend')).toBeVisible();

    await list.getByRole('checkbox').check();
    await expect(page.getByRole('region', { name: 'Tasks' }).getByText('1/1')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('task-list').getByRole('checkbox')).toBeChecked();
  });

  test('refuses to delete a category that has sub-categories', async ({ page }) => {
    await page.goto('/categories');
    const form = page.getByRole('form', { name: 'Add category' });
    await form.getByRole('textbox', { name: 'Category name' }).fill('Parent');
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.category-tree').getByText('Parent')).toBeVisible();
    await form.getByRole('textbox', { name: 'Category name' }).fill('Kid');
    await form.getByRole('combobox', { name: 'Parent category' }).selectOption({ label: 'Parent' });
    await form.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('.category-tree').getByText('Kid')).toBeVisible();

    await page.getByRole('button', { name: 'Delete category Parent' }).click();
    await expect(page.getByText('Delete or move the sub-categories first')).toBeVisible();
  });
});
