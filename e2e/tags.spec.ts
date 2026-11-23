import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function addTopLevel(page: Page, name: string) {
  const form = page.getByRole('form', { name: 'New top-level tag' });
  await form.getByRole('textbox').fill(name);
  await form.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId(`tag-${name}`)).toBeVisible();
}

async function addChild(page: Page, parent: string, name: string) {
  await page.getByRole('button', { name: `Add child tag to ${parent}` }).click();
  const input = page.getByRole('textbox', { name: `New child tag of ${parent}` });
  await input.fill(name);
  await input.press('Enter');
  await expect(page.getByTestId(`tag-${parent}`).getByTestId(`tag-${name}`)).toBeVisible();
}

test.describe('tag tree', () => {
  test('builds a tree inline, renames, recolours and moves via the form', async ({ page }) => {
    await page.goto('/tags');
    await addTopLevel(page, 'Work');
    await addTopLevel(page, 'Health');
    await addChild(page, 'Work', 'Gym');

    await page.getByRole('button', { name: 'Edit tag Gym' }).click();
    const form = page.getByRole('form', { name: 'Edit Gym' });
    await form.getByRole('textbox', { name: 'Tag name' }).fill('Training');
    await form.getByLabel('Tag colour').fill('#ff0000');
    await form.getByRole('combobox', { name: 'Parent tag' }).selectOption({ label: 'Health' });
    await form.getByRole('button', { name: 'Save' }).click();

    const moved = page.getByTestId('tag-Health').getByTestId('tag-Training');
    await expect(moved).toBeVisible();
    await expect(moved.locator('.color-dot').first()).toHaveCSS(
      'background-color',
      'rgb(255, 0, 0)',
    );
  });

  test('cannot move a tag under its own descendant', async ({ page }) => {
    await page.goto('/tags');
    await addTopLevel(page, 'A');
    await addChild(page, 'A', 'B');

    await page.getByRole('button', { name: 'Edit tag A' }).click();
    const parent = page
      .getByRole('form', { name: 'Edit A' })
      .getByRole('combobox', { name: 'Parent tag' });
    await expect(parent.locator('option')).toHaveText(['(top level)']);
  });

  test('collapses a branch and guards deleting a parent', async ({ page }) => {
    await page.goto('/tags');
    await addTopLevel(page, 'Work');
    await addChild(page, 'Work', 'Backend');

    await expect(page.getByRole('button', { name: 'Delete tag Work' })).toBeDisabled();
    await page.getByRole('button', { name: 'Collapse Work' }).click();
    await expect(page.getByTestId('tag-Backend')).toBeHidden();
    await page.getByRole('button', { name: 'Expand Work' }).click();

    await page.getByRole('button', { name: 'Delete tag Backend' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByTestId('tag-Backend')).toHaveCount(0);
  });
});

test.describe('drag and drop', () => {
  test.skip(
    ({ isMobile }) => isMobile,
    'HTML5 drag-and-drop is a pointer interaction; touch uses the pickers.',
  );

  test('drags a tag onto another to nest it, and back to top level', async ({ page, api }) => {
    await api.createTag('Work');
    await api.createTag('Backend');
    await page.goto('/tags');

    await page.getByTestId('tag-row-Backend').dragTo(page.getByTestId('tag-row-Work'));
    await expect(page.getByTestId('tag-Work').getByTestId('tag-Backend')).toBeVisible();

    await page.getByTestId('tag-row-Backend').dragTo(page.getByTestId('tag-root-drop'));
    await expect(page.getByTestId('tag-Work').getByTestId('tag-Backend')).toHaveCount(0);
    await expect(page.getByTestId('tag-Backend')).toBeVisible();
  });

  test('drags a child tag out of its parent onto empty space', async ({ page, api }) => {
    const work = await api.createTag('Work');
    await api.createTag('Backend', work.id);
    await api.createTag('Health');
    await page.goto('/tags');

    // Real pointer drag from the row down into blank space under the tree.
    const row = await page.getByTestId('tag-row-Backend').boundingBox();
    if (!row) throw new Error('row not rendered');
    await page.mouse.move(row.x + 60, row.y + row.height / 2);
    await page.mouse.down();
    await page.mouse.move(row.x + 60, row.y + 140, { steps: 12 });
    await page.mouse.up();

    await expect(page.getByTestId('tag-Work').getByTestId('tag-Backend')).toHaveCount(0);
    await expect(page.getByTestId('tag-Backend')).toBeVisible();
  });

  test('dropping a child on its own parent changes nothing', async ({ page, api }) => {
    const work = await api.createTag('Work');
    await api.createTag('Backend', work.id);
    await page.goto('/tags');

    await page.getByTestId('tag-row-Backend').dragTo(page.getByTestId('tag-row-Work'));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('tag-Work').getByTestId('tag-Backend')).toBeVisible();
  });

  test('refuses to drop a tag into its own subtree', async ({ page, api }) => {
    const a = await api.createTag('A');
    await api.createTag('B', a.id);
    await page.goto('/tags');

    await page.getByTestId('tag-row-A').dragTo(page.getByTestId('tag-row-B'));
    // Still A > B, not B > A.
    await expect(page.getByTestId('tag-A').getByTestId('tag-B')).toBeVisible();
  });

  test('drags several tags onto a node and onto a task', async ({ page, api }) => {
    const work = await api.createTag('Work');
    await api.createTag('Backend', work.id);
    await api.createTag('Urgent');
    const node = await api.createNode({ title: 'Launch' });
    await api.createTask(node.id, 'Write API');
    await page.goto(`/nodes/${node.id}`);

    const palette = page.getByRole('list', { name: 'Tag palette' });
    const nodeTags = page.getByTestId('tags-of-Launch');
    await palette.getByTestId('tag-chip-Backend').dragTo(nodeTags);
    await palette.getByTestId('tag-chip-Urgent').dragTo(nodeTags);
    await expect(nodeTags.getByTestId('tag-chip-Backend')).toContainText('Work / Backend');
    await expect(nodeTags.getByTestId('tag-chip-Urgent')).toBeVisible();

    const task = page.getByTestId('task-Write API');
    await palette.getByTestId('tag-chip-Urgent').dragTo(task);
    await palette.getByTestId('tag-chip-Work').dragTo(task);
    await expect(task.getByTestId('tag-chip-Urgent')).toBeVisible();
    await expect(task.getByTestId('tag-chip-Work')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('tags-of-Launch').locator('.tag-chip')).toHaveCount(2);
    await expect(page.getByTestId('task-Write API').locator('.tag-chip')).toHaveCount(2);
  });
});

test.describe('tags without drag (touch / keyboard)', () => {
  test('moves a nested tag to top level with the ⤒ button', async ({ page, api }) => {
    const work = await api.createTag('Work');
    await api.createTag('Backend', work.id);
    await page.goto('/tags');

    await expect(page.getByRole('button', { name: 'Move Work to top level' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Move Backend to top level' }).click();
    await expect(page.getByTestId('tag-Work').getByTestId('tag-Backend')).toHaveCount(0);
    await expect(page.getByTestId('tag-Backend')).toBeVisible();
  });

  test('attaches and removes tags via pickers; tasks keep working', async ({ page, api }) => {
    await api.createTag('Urgent');
    await api.createTag('Later');
    const node = await api.createNode({ title: 'Launch' });
    await page.goto(`/nodes/${node.id}`);

    await page
      .getByRole('combobox', { name: 'Add tag to Launch' })
      .selectOption({ label: 'Urgent' });
    await page
      .getByRole('combobox', { name: 'Add tag to Launch' })
      .selectOption({ label: 'Later' });
    const nodeTags = page.getByTestId('tags-of-Launch');
    await expect(nodeTags.locator('.tag-chip')).toHaveCount(2);

    await nodeTags.getByRole('button', { name: 'Remove tag Later' }).click();
    await expect(nodeTags.locator('.tag-chip')).toHaveCount(1);

    const taskForm = page.getByRole('form', { name: 'Add task' });
    await taskForm.getByRole('textbox', { name: 'New task' }).fill('Ship it');
    await taskForm.getByRole('combobox', { name: 'Initial tag' }).selectOption({ label: 'Urgent' });
    await taskForm.getByRole('button', { name: 'Add' }).click();

    const task = page.getByTestId('task-Ship it');
    await expect(task.getByTestId('tag-chip-Urgent')).toBeVisible();
    await task
      .getByRole('combobox', { name: 'Add tag to Ship it' })
      .selectOption({ label: 'Later' });
    await expect(task.locator('.tag-chip')).toHaveCount(2);

    await task.getByRole('button', { name: 'Start task Ship it' }).click();
    await expect(task.getByRole('button', { name: 'Pause task Ship it' })).toBeVisible();
    await task.getByRole('checkbox').check();
    await expect(page.getByRole('region', { name: 'Tasks' }).getByText('1/1')).toBeVisible();
  });
});
