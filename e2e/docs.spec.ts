import { readFile } from 'node:fs/promises';
import { createFile, docEditor, expect, pickMenu, snap, test, waitForSync } from './fixtures.ts';

test('writes and formats a new document that is still there after a reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('template-blank').click();
  await expect(page).toHaveURL(/\/d\/[\w-]+$/);
  await waitForSync(page);

  const title = page.getByRole('textbox', { name: 'File name' });
  await title.fill('Quarterly report');
  await title.press('Enter');

  const editor = docEditor(page);
  await editor.click();
  await page.getByTestId('paragraph-style').click();
  await page.getByRole('menuitemcheckbox', { name: /^Heading 1/ }).click();
  await page.keyboard.type('Quarterly report');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Revenue grew by ');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('twelve percent');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type(' this quarter.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- Hired three engineers');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Opened the Berlin office');

  await expect(editor.locator('h1')).toHaveText('Quarterly report');
  await expect(editor.locator('strong')).toHaveText('twelve percent');
  await expect(editor.locator('ul > li')).toHaveText(['Hired three engineers', 'Opened the Berlin office']);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');
  await snap(page, 'doc-formatted');

  await page.reload();
  await waitForSync(page);
  await expect(page.getByRole('textbox', { name: 'File name' })).toHaveValue('Quarterly report');
  await expect(docEditor(page).locator('h1')).toHaveText('Quarterly report');
  await expect(docEditor(page).locator('strong')).toHaveText('twelve percent');
  await expect(page).toHaveTitle(/Quarterly report/);

  const markdown = page.waitForEvent('download');
  await pickMenu(page, ['File', 'Download', 'Markdown (.md)']);
  const md = await markdown;
  expect(md.suggestedFilename()).toBe('Quarterly report.md');
  const text = await readFile(await md.path(), 'utf8');
  expect(text).toContain('# Quarterly report');
  expect(text).toContain('Revenue grew by **twelve percent** this quarter.');
  expect(text).toMatch(/^[-*] +Opened the Berlin office$/m);

  const word = page.waitForEvent('download');
  await pickMenu(page, ['File', 'Download', 'Microsoft Word (.docx)']);
  const docx = await word;
  expect(docx.suggestedFilename()).toBe('Quarterly report.docx');
  const bytes = await readFile(await docx.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');
});

test('comments on selected text, replies and resolves the thread', async ({ page }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Launch checklist' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await page.keyboard.type('The launch is planned for March 3.');
  await page.keyboard.press('Shift+Home');

  await page.getByTestId('bubble-comment').click();
  const composer = page.getByTestId('new-comment-input');
  await expect(composer).toBeFocused();
  await composer.fill('Is this date confirmed?');
  await page.getByTestId('new-comment').getByRole('button', { name: 'Comment' }).click();

  const thread = page.getByTestId('comment-thread');
  await expect(thread).toContainText('Is this date confirmed?');
  await expect(editor.locator('.comment-mark')).toHaveText('The launch is planned for March 3.');
  await expect(page.getByTestId('comments-toggle')).toHaveAccessibleName('Comments (1 open)');

  await thread.click();
  await thread.getByTestId('reply-input').fill('Yes, the venue confirmed it.');
  await thread.getByRole('button', { name: 'Reply' }).click();
  await expect(thread).toContainText('Yes, the venue confirmed it.');
  await snap(page, 'doc-comments');

  await thread.getByTestId('resolve-comment').click();
  await expect(page.getByTestId('comment-thread')).toHaveCount(0);
  await expect(page.getByTestId('comments-toggle')).toHaveAccessibleName('Comments');
  await expect(editor.locator('.comment-mark')).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Show comments' }).selectOption({ label: 'Resolved' });
  await expect(page.getByTestId('comment-thread')).toContainText('Resolved');
});

test('finds and replaces text', async ({ page }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Fruit' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  await docEditor(page).click();
  await page.keyboard.type('A red apple, a red cherry and a green pear.');

  await page.keyboard.press('ControlOrMeta+h');
  await expect(page.getByTestId('find-bar')).toBeVisible();
  await page.getByTestId('find-input').fill('red');
  await expect(page.getByTestId('find-status')).toHaveText('1 of 2');
  await page.getByTestId('replace-input').fill('ripe');
  await snap(page, 'doc-find-replace');
  await page.getByTestId('replace-all').click();
  await expect(docEditor(page)).toHaveText('A ripe apple, a ripe cherry and a green pear.');
});

test('names a version and restores it later', async ({ page }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Plan' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await page.keyboard.type('First draft of the plan.');
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  await pickMenu(page, ['File', 'Version history', 'Name current version']);
  await page.getByRole('textbox', { name: 'Version name' }).fill('First draft');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved version “First draft”')).toBeVisible();

  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('A completely different plan.');
  await expect(editor).toHaveText('A completely different plan.');

  await pickMenu(page, ['File', 'Version history', 'See version history']);
  const history = page.getByTestId('version-history');
  await history.getByRole('button', { name: /First draft/ }).click();
  await expect(history.getByTestId('version-paper')).toHaveText('First draft of the plan.');
  await snap(page, 'doc-version-history');
  await history.getByTestId('restore-version').click();
  await page.getByRole('dialog', { name: 'Restore this version?' }).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('Restored “First draft”')).toBeVisible();
  await expect(history).toBeHidden();
  await expect(editor).toHaveText('First draft of the plan.');
});

test('finds documents by their content from the home page', async ({ page }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Field notes' });
  const word = `quokka${Date.now().toString(36)}`;
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  await docEditor(page).click();
  await page.keyboard.type(`Spotted a ${word} near the river.`);
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // The server indexes the text when it stores the document, a moment after the last change.
  const result = page.getByRole('link', { name: /Field notes/ });
  await expect(async () => {
    await page.goto(`/?q=${word}`);
    await expect(result).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(result).toContainText(word);
  await snap(page, 'home-search');
});
