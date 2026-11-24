import type { Page } from '@playwright/test';
import { expect, phoneWithCopy, test } from './fixtures';

// What an AI chat answers to "end": prose around a ```json block.
const reply = `Great session! Here is the summary:

\`\`\`json
{
  "format": "km-whys/1",
  "summary": "Checked why caches are fast",
  "conclusion": "Latency, not size, is the point",
  "whys": [
    {
      "question": "Why is a small cache fast?",
      "answer": "It sits close to the core",
      "takeaway": "Distance costs time",
      "children": [
        { "question": "Why does distance matter?", "answer": "", "takeaway": "", "children": [] }
      ]
    },
    { "question": "Why not make all memory fast?", "answer": "Cost", "takeaway": "", "children": [] }
  ]
}
\`\`\`

Keep it up!`;

const dialog = (page: Page) => page.getByRole('dialog', { name: /^5 Whys:/ });

test.describe('5 Whys', () => {
  test('copy a prompt, paste the AI reply back, and save it as a tree', async ({ page, api }) => {
    const node = await api.createNode({
      title: 'Cache',
      content: 'A cache is fast because it is small.',
    });
    const ram = await api.createNode({ title: 'RAM' });
    await api.createEdge(node.id, ram.id, 'USES');

    await page.goto(`/nodes/${node.id}`);
    const panel = page.getByRole('region', { name: '5 Whys' });
    await expect(panel).toContainText('No sessions yet.');
    await panel.getByRole('button', { name: 'Open 5 Whys' }).click();
    const d = dialog(page);
    await expect(d).toHaveAccessibleName('5 Whys: Cache');

    // With no sessions yet, the guide is open.
    await expect(d.getByText('How it works')).toBeVisible();
    await expect(d.getByText(/Press Add, pick the prompt language/)).toBeVisible();

    await d.getByRole('button', { name: 'Add' }).click();
    const prompt = d.getByRole('textbox', { name: 'Prompt for the AI' });
    await expect(prompt).toHaveValue(/Title: Cache/);
    await expect(prompt).toHaveValue(/A cache is fast because it is small\./);
    await expect(prompt).toHaveValue(/- Cache -\[USES\]-> RAM/);
    await d
      .getByRole('combobox', { name: 'Prompt language' })
      .selectOption({ label: 'Tiếng Việt' });
    await expect(prompt).toHaveValue(/Tiêu đề: Cache/);
    await expect(prompt).toHaveValue(/"đào sâu"/);

    const paste = d.getByRole('textbox', { name: 'AI reply (JSON)' });
    const save = d.getByRole('button', { name: 'Save session' });
    await paste.fill('no json in here');
    await expect(d.getByText(/No JSON found/)).toBeVisible();
    await expect(save).toBeDisabled();

    await paste.fill(reply);
    const preview = d.getByRole('list', { name: 'Whys' });
    await expect(preview).toContainText('1 Why is a small cache fast?');
    await expect(preview).toContainText('1.1 Why does distance matter?');
    await expect(preview).toContainText('(no answer)');
    await save.click();

    // Saved: it opens for editing, and the list shows it.
    await expect(d.getByRole('group', { name: 'Why 1.1' })).toBeVisible();
    await d.getByRole('button', { name: 'Back' }).click();
    await expect(d.getByRole('button', { name: /Checked why caches are fast/ })).toContainText(
      'whys: 3 · levels: 2',
    );
    await d.getByRole('button', { name: 'Close' }).click();
    await expect(d).toHaveCount(0);
    await expect(panel).toContainText('Sessions: 1');
  });

  test('edit a saved session by field or as JSON, then delete it', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Cache' });
    const created = await page.request.post(`/api/nodes/${node.id}/whys`, {
      data: {
        summary: 'First look',
        whys: [{ question: 'Why fast?', answer: 'Close', children: [{ question: 'Why close?' }] }],
      },
    });
    expect(created.status()).toBe(201);

    await page.goto(`/nodes/${node.id}`);
    await page.getByRole('button', { name: 'Open 5 Whys' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /First look/ }).click();

    // Fields: answer a why, add a deeper one (it needs a question to save).
    const saveChanges = d.getByRole('button', { name: 'Save changes' });
    await expect(saveChanges).toBeDisabled();
    await d.getByRole('group', { name: 'Why 1.1' }).getByLabel('Answer').fill('Short wires');
    await d.getByRole('button', { name: 'Add a deeper why under 1.1' }).click();
    await expect(d.getByText('Every why needs a question.')).toBeVisible();
    await expect(saveChanges).toBeDisabled();
    await d.getByRole('group', { name: 'Why 1.1.1' }).getByLabel('Question').fill('Why wires?');
    await saveChanges.click();
    await expect(page.getByRole('status').filter({ hasText: 'Session saved' })).toBeVisible();
    await expect(saveChanges).toBeDisabled();

    // Leaving with unsaved edits asks first.
    await d.getByLabel('Summary').fill('Changed');
    await d.getByRole('button', { name: 'Close' }).click();
    await expect(d.getByRole('alert')).toContainText('You have unsaved changes.');
    await d.getByRole('button', { name: 'Keep editing' }).click();
    await expect(d.getByLabel('Summary')).toHaveValue('Changed');
    await d.getByRole('button', { name: 'Discard changes' }).click();
    await expect(d.getByLabel('Summary')).toHaveValue('First look');

    // JSON: edit the text, apply, save.
    await d.getByRole('tab', { name: 'JSON' }).click();
    const json = d.getByRole('textbox', { name: 'Session JSON' });
    await expect(json).toHaveValue(/"answer": "Short wires"/);
    await json.fill((await json.inputValue()).replace('First look', 'Second look'));
    await d.getByRole('button', { name: 'Apply JSON' }).click();
    await expect(d.getByLabel('Summary')).toHaveValue('Second look');
    await saveChanges.click();
    await expect(saveChanges).toBeDisabled();

    // It all survived a reload.
    await page.reload();
    await page.getByRole('button', { name: 'Open 5 Whys' }).click();
    await d.getByRole('button', { name: /Second look/ }).click();
    await expect(d.getByRole('group', { name: 'Why 1.1.1' }).getByLabel('Question')).toHaveValue(
      'Why wires?',
    );

    await d.getByRole('button', { name: 'Delete session' }).click();
    await d.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(d.getByText('No sessions yet.')).toBeVisible();
  });

  test('one press copies the full prompt: notes, links and every earlier session', async ({
    page,
    api,
    context,
    isMobile,
  }) => {
    test.skip(isMobile, 'Clipboard permissions are desktop-only in the emulator.');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const node = await api.createNode({ title: 'Cache', content: 'Small is fast.' });
    const ram = await api.createNode({ title: 'RAM' });
    await api.createEdge(node.id, ram.id, 'USES');
    await page.request.post(`/api/nodes/${node.id}/whys`, {
      data: {
        summary: 'First look',
        whys: [
          {
            question: 'Why is small fast?',
            answer: 'Fewer lines',
            children: [{ question: 'Why fewer?' }],
          },
        ],
      },
    });

    await page.goto(`/nodes/${node.id}`);
    const panel = page.getByRole('region', { name: '5 Whys' });
    // Typed but not autosaved yet: the copy must still quote it.
    await page.getByRole('textbox', { name: 'Title' }).fill('Cache memory');
    await panel.getByRole('button', { name: 'Copy prompt' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Prompt copied' })).toContainText(
      /Prompt copied \(characters: \d+, earlier sessions: 1\)/,
    );
    // Windows' clipboard turns \n into \r\n.
    const copied = (await page.evaluate<string>('navigator.clipboard.readText()')).replace(
      /\r\n/g,
      '\n',
    );
    expect(copied).toContain('Title: Cache memory');
    expect(copied).toContain('Small is fast.');
    expect(copied).toContain('- Cache memory -[USES]-> RAM');
    expect(copied).toContain('  Summary: First look');
    expect(copied).toContain('  1. Why is small fast?\n     My answer: Fewer lines');
    expect(copied).toContain('    1.1. Why fewer?');

    // The shortcut does the same, in the language picked next to the button.
    await panel.getByRole('combobox', { name: 'Prompt language' }).selectOption('vi');
    await page.evaluate('navigator.clipboard.writeText("")');
    await page.getByRole('heading', { name: '5 Whys' }).click(); // focus out of the editor
    await page.keyboard.press('Alt+Shift+W');
    await expect
      .poll(() => page.evaluate<string>('navigator.clipboard.readText()'))
      .toContain('Tiêu đề: Cache memory');
  });

  test('the phone app has no 5 Whys and no link check: it only views', async ({ page, api }) => {
    const node = await api.createNode({ title: 'Cache' });
    await page.request.post(`/api/nodes/${node.id}/whys`, {
      data: { summary: 'Read me', whys: [{ question: 'Why?', answer: 'Because' }] },
    });
    await phoneWithCopy(page, api);
    await page.goto(`/nodes/${node.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Cache' })).toBeVisible();
    await expect(page.getByRole('region', { name: '5 Whys' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Link check' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Copy prompt|Open 5 Whys/ })).toHaveCount(0);
    // Their shortcuts have no handler there either.
    await page.keyboard.press('Alt+W');
    await expect(dialog(page)).toHaveCount(0);
  });
});
