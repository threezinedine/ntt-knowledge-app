import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function addTopLevel(page: Page, name: string) {
  const form = page.getByRole('form', { name: 'New top-level category' });
  await form.getByRole('textbox').fill(name);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId(`category-${name}`)).toBeVisible();
}

async function addChild(page: Page, parent: string, name: string) {
  await page.getByRole('button', { name: `Add sub-category to ${parent}` }).click();
  const input = page.getByRole('textbox', { name: `New sub-category of ${parent}` });
  await input.fill(name);
  await input.press('Enter');
  await expect(
    page.getByTestId(`category-${parent}`).getByTestId(`category-${name}`),
  ).toBeVisible();
}

test.describe('tasks and categories', () => {
  test('builds a category tree inline and files a task under a sub-category', async ({
    page,
    api,
  }) => {
    const node = await api.createNode({ title: 'Launch' });

    await page.goto('/categories');
    await addTopLevel(page, 'Work');
    await addChild(page, 'Work', 'Backend');
    await addChild(page, 'Backend', 'API');

    await page.goto(`/nodes/${node.id}`);
    const taskForm = page.getByRole('form', { name: 'Add task' });
    await taskForm.getByRole('textbox', { name: 'New task' }).fill('Write API');
    await taskForm
      .getByRole('combobox', { name: 'Task category' })
      .selectOption({ label: 'Work / Backend / API' });
    await taskForm.getByRole('button', { name: 'Add' }).click();

    const list = page.getByTestId('task-list');
    await expect(list.getByText('Write API')).toBeVisible();
    await expect(list.getByText('Work / Backend / API')).toBeVisible();

    await list.getByRole('button', { name: 'Start task Write API' }).click();
    await expect(list.getByRole('button', { name: 'Pause task Write API' })).toBeVisible();

    await list.getByRole('checkbox').check();
    await expect(page.getByRole('region', { name: 'Tasks' }).getByText('1/1')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('task-list').getByRole('checkbox')).toBeChecked();
  });

  test('renames, recolours and moves a category', async ({ page }) => {
    await page.goto('/categories');
    await addTopLevel(page, 'Work');
    await addTopLevel(page, 'Health');
    await addChild(page, 'Work', 'Gym');

    await page.getByRole('button', { name: 'Edit category Gym' }).click();
    const form = page.getByRole('form', { name: 'Edit Gym' });
    await form.getByRole('textbox', { name: 'Category name' }).fill('Training');
    await form.getByLabel('Category colour').fill('#ff0000');
    await form.getByRole('combobox', { name: 'Parent category' }).selectOption({ label: 'Health' });
    await form.getByRole('button', { name: 'Save' }).click();

    const moved = page.getByTestId('category-Health').getByTestId('category-Training');
    await expect(moved).toBeVisible();
    await expect(moved.locator('.color-dot').first()).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    );
    await expect(page.getByTestId('category-Work').getByTestId('category-Training')).toHaveCount(0);
  });

  test('cannot move a category under its own descendant', async ({ page }) => {
    await page.goto('/categories');
    await addTopLevel(page, 'A');
    await addChild(page, 'A', 'B');

    await page.getByRole('button', { name: 'Edit category A' }).click();
    const parent = page
      .getByRole('form', { name: 'Edit A' })
      .getByRole('combobox', { name: 'Parent category' });
    await expect(parent.locator('option')).toHaveText(['(top level)']);
  });

  test('collapses a branch', async ({ page }) => {
    await page.goto('/categories');
    await addTopLevel(page, 'Work');
    await addChild(page, 'Work', 'Backend');

    await page.getByRole('button', { name: 'Collapse Work' }).click();
    await expect(page.getByTestId('category-Backend')).toBeHidden();
    await page.getByRole('button', { name: 'Expand Work' }).click();
    await expect(page.getByTestId('category-Backend')).toBeVisible();
  });

  test('refuses to delete a category that has sub-categories', async ({ page }) => {
    await page.goto('/categories');
    await addTopLevel(page, 'Parent');
    await addChild(page, 'Parent', 'Kid');

    await page.getByRole('button', { name: 'Delete category Parent' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Delete or move the sub-categories first')).toBeVisible();
  });
});
