import type { Page } from '@playwright/test';
import { addMember, createFile, docBlocks, docEditor, expect, snap, test, USERS, waitForSync } from './fixtures.ts';

const openShareDialog = async (page: Page, title: string) => {
  await page.getByRole('banner').getByRole('button', { name: 'Share' }).click();
  return page.getByRole('dialog', { name: `Share “${title}”` });
};

test('two people edit the same document in real time', async ({ page, openAs }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Team notes' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);

  const dialog = await openShareDialog(page, 'Team notes');
  await dialog.getByRole('textbox', { name: 'Add people by username' }).fill(USERS.victor.username);
  await dialog.getByRole('combobox', { name: 'Role for new people' }).selectOption('editor');
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: `Role for ${USERS.victor.displayName}` })).toHaveValue('editor');
  await dialog.getByRole('button', { name: 'Done' }).click();

  const victor = await openAs('victor');
  await victor.goto(`/d/${doc.id}`);
  await waitForSync(victor);

  await docEditor(page).click();
  await page.keyboard.type('Maria: the agenda is ready.');
  await expect.poll(() => docBlocks(victor)).toEqual(['Maria: the agenda is ready.']);

  await docEditor(victor).click();
  await victor.keyboard.press('ControlOrMeta+End');
  await victor.keyboard.press('Enter');
  await victor.keyboard.type('Victor: I will bring the slides.');
  await expect.poll(() => docBlocks(page)).toEqual(['Maria: the agenda is ready.', 'Victor: I will bring the slides.']);

  await expect(page.locator('.presence').getByTitle(USERS.victor.displayName)).toBeVisible();
  await expect(victor.locator('.presence').getByTitle(USERS.maria.displayName)).toBeVisible();
  await expect(docEditor(page).locator('.collaboration-carets__label')).toHaveText(USERS.victor.displayName);
  await snap(page, 'collab-maria');
  await snap(victor, 'collab-victor');
});

test('viewers can read a document but not change it', async ({ page, openAs }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Board minutes' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  await docEditor(page).click();
  await page.keyboard.type('Only the board edits these minutes.');
  await addMember(page, doc.id, 'victor', 'viewer');

  const victor = await openAs('victor');
  await victor.goto(`/d/${doc.id}`);
  await expect(victor.getByTestId('save-status')).toHaveText('View only');
  await expect(victor.getByTestId('access-banner')).toHaveText('You can view this document, but not edit it or comment.');
  const editor = docEditor(victor);
  await expect.poll(() => docBlocks(victor)).toEqual(['Only the board edits these minutes.']);
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await expect(victor.getByRole('textbox', { name: 'File name' })).not.toBeEditable();
  await expect(victor.getByTestId('doc-toolbar').getByRole('button', { name: 'Undo' })).toHaveCount(0);

  // Viewers can still select (and copy) text.
  await editor.locator('p').click({ clickCount: 3 });
  await expect.poll(() => victor.evaluate(() => getSelection()?.toString())).toContain('Only the board edits these minutes.');
  await victor.keyboard.type('Sneaky edit');
  await expect.poll(() => docBlocks(victor)).toEqual(['Only the board edits these minutes.']);
  await snap(victor, 'collab-viewer');
});

test('commenters can comment without editing, and the owner sees it live', async ({ page, openAs }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Budget draft' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  await docEditor(page).click();
  await page.keyboard.type('Travel budget: 12,000 EUR');
  await addMember(page, doc.id, 'victor', 'commenter');

  const victor = await openAs('victor');
  await victor.goto(`/d/${doc.id}`);
  await expect(victor.getByTestId('access-banner')).toHaveText('You can view and comment on this document, but not edit it.');
  await docEditor(victor).locator('p').click({ clickCount: 3 });
  const bubble = victor.getByTestId('text-bubble');
  await expect(bubble.getByRole('button', { name: 'Bold' })).toHaveCount(0);
  await bubble.getByTestId('bubble-comment').click();
  await victor.getByTestId('new-comment-input').fill('Can we lower this?');
  await victor.getByTestId('new-comment').getByRole('button', { name: 'Comment' }).click();
  await expect(victor.getByTestId('comment-thread')).toContainText('Can we lower this?');
  await expect.poll(() => docBlocks(victor)).toEqual(['Travel budget: 12,000 EUR']);

  const toggle = page.getByTestId('comments-toggle');
  await expect(toggle).toHaveAccessibleName('Comments (1 open)');
  // The panel opens by itself when the first comment arrives.
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('comment-thread')).toContainText(USERS.victor.displayName);
  await expect(page.getByTestId('comment-thread')).toContainText('Can we lower this?');
  await snap(page, 'collab-comment-from-commenter');
});

test('link sharing opens a document to everyone signed in, until it is turned off', async ({ page, openAs }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Open letter' });
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);
  await docEditor(page).click();
  await page.keyboard.type('Dear readers,');

  const victor = await openAs('victor');
  await victor.goto(`/d/${doc.id}`);
  await expect(victor.getByRole('heading', { name: 'File not found' })).toBeVisible();

  let dialog = await openShareDialog(page, 'Open letter');
  await dialog.getByRole('combobox', { name: 'General access' }).selectOption('anyone');
  await expect(dialog.getByRole('combobox', { name: 'Link role' })).toHaveValue('view');
  await dialog.getByRole('combobox', { name: 'Link role' }).selectOption('edit');
  await expect(dialog.getByText('Anyone signed in to TitoDocs with the link can open it')).toBeVisible();
  await snap(page, 'share-dialog');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await victor.reload();
  await waitForSync(victor);
  await docEditor(victor).click();
  await victor.keyboard.press('ControlOrMeta+End');
  await victor.keyboard.type(' thank you.');
  await expect.poll(() => docBlocks(page)).toEqual(['Dear readers, thank you.']);

  // Turning link sharing off takes effect at once for people who already have the document open.
  dialog = await openShareDialog(page, 'Open letter');
  await dialog.getByRole('combobox', { name: 'General access' }).selectOption('restricted');
  await expect(dialog.getByText('Only people with access can open it')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(victor.getByRole('heading', { name: 'File not found' })).toBeVisible();

  // Once it is back on, the document opens again in the same tab (and over the same connection).
  const response = await page.request.put(`/api/files/${doc.id}/sharing`, { data: { linkAccess: 'view' } });
  expect(response.status()).toBe(200);
  await victor.getByRole('link', { name: 'Go to TitoDocs home' }).click();
  // Let the closed document's room be released first.
  await victor.waitForTimeout(2_500);
  await victor.goBack();
  await waitForSync(victor);
  await expect.poll(() => docBlocks(victor)).toEqual(['Dear readers, thank you.']);
});

test('lowering someone to viewer stops their edits at once', async ({ page, openAs }) => {
  const doc = await createFile(page, { type: 'doc', title: 'Press release' });
  await addMember(page, doc.id, 'victor', 'editor');
  await page.goto(`/d/${doc.id}`);
  await waitForSync(page);

  const victor = await openAs('victor');
  await victor.goto(`/d/${doc.id}`);
  await waitForSync(victor);
  await docEditor(victor).click();
  await victor.keyboard.type('Draft by Victor.');
  await expect.poll(() => docBlocks(page)).toEqual(['Draft by Victor.']);

  const dialog = await openShareDialog(page, 'Press release');
  await dialog.getByRole('combobox', { name: `Role for ${USERS.victor.displayName}` }).selectOption('viewer');
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect(victor.getByTestId('save-status')).toHaveText('View only');
  await expect(docEditor(victor)).toHaveAttribute('contenteditable', 'false');
  await docEditor(victor).click();
  await victor.keyboard.type(' More text.');
  await expect.poll(() => docBlocks(victor)).toEqual(['Draft by Victor.']);
  await expect.poll(() => docBlocks(page)).toEqual(['Draft by Victor.']);

  // Victor still follows Maria's edits live.
  await docEditor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' Approved.');
  await expect.poll(() => docBlocks(victor)).toEqual(['Draft by Victor. Approved.']);
});
