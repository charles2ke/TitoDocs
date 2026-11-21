import { readFile } from 'node:fs/promises';
import type { Locator, Page, Route } from '@playwright/test';
import { createFile, docEditor, expect, pickMenu, snap, test, waitForSync } from './fixtures.ts';

// A 1×1 PNG image.
const PNG = [
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0,
  0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 96, 0, 2, 0, 0, 5, 0, 1, 161, 67, 55, 39, 0, 0, 0, 0, 73, 69, 78, 68, 174,
  66, 96, 130,
];

/** Pastes PNG images with the given names, as if copied from a file manager. */
async function pasteImages(editor: Locator, names: string[]): Promise<void> {
  await editor.evaluate(
    (element, [bytes, list]) => {
      const clipboardData = new DataTransfer();
      for (const name of list) clipboardData.items.add(new File([new Uint8Array(bytes)], `${name}.png`, { type: 'image/png' }));
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    },
    [PNG, names] as const,
  );
}

/** The text of each block, or `image <name>` for images. */
const blocksWithImages = (editor: Locator): Promise<string[]> =>
  editor.evaluate((root) =>
    Array.from(root.children, (block) => {
      const image = block.querySelector('img');
      return image ? `image ${image.alt}` : (block.textContent ?? '');
    }),
  );

/** Holds the next image uploads until `release` is called. `started` resolves once one is waiting. */
async function holdUploads(page: Page): Promise<{ started: Promise<void>; release: () => Promise<void> }> {
  let notifyStarted!: () => void;
  let releaseHeld!: () => void;
  const started = new Promise<void>((resolve) => (notifyStarted = resolve));
  const held = new Promise<void>((resolve) => (releaseHeld = resolve));
  const handling: Promise<void>[] = [];
  const handler = (route: Route) => {
    const handled = (async () => {
      notifyStarted();
      await held;
      await route.continue();
    })();
    handling.push(handled);
    return handled;
  };
  await page.route('**/api/uploads', handler);
  return {
    started,
    release: async () => {
      releaseHeld();
      await Promise.all(handling);
      await page.unroute('**/api/uploads', handler);
    },
  };
}

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
  // The menu hands focus back to the editor on the next frame; typing before then would be lost.
  await expect(editor).toBeFocused();
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

test('keeps pasted images at their mapped insertion point during upload', async ({ page }) => {
  const file = await createFile(page, { type: 'doc', title: 'Image anchor' });
  await page.goto(`/d/${file.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await page.keyboard.type('alpha omega');
  await page.keyboard.press('Home');
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight');

  const upload = await holdUploads(page);
  await pasteImages(editor, ['anchor']);
  await upload.started;
  await page.keyboard.type('typed ');
  await upload.release();

  await expect(editor.locator('img[alt="anchor"]')).toHaveCount(1);
  expect(await blocksWithImages(editor)).toEqual(['alpha typed ', 'image anchor', 'omega']);
});

test('inserts several pasted images in order and keeps writing after them', async ({ page }) => {
  const file = await createFile(page, { type: 'doc', title: 'Image order' });
  await page.goto(`/d/${file.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('omega');

  // On an empty line…
  await page.keyboard.press('ArrowUp');
  await pasteImages(editor, ['first', 'second']);
  await expect(editor.locator('img')).toHaveCount(2);
  await page.keyboard.type('below');
  // …and at the end of a paragraph.
  await page.keyboard.press('ControlOrMeta+End');
  await pasteImages(editor, ['third', 'fourth']);
  await expect(editor.locator('img')).toHaveCount(4);
  await page.keyboard.type('end');

  expect(await blocksWithImages(editor)).toEqual([
    'alpha',
    'image first',
    'image second',
    'below',
    'omega',
    'image third',
    'image fourth',
    'end',
  ]);
});

test('leaves the cursor alone when someone writes elsewhere while images upload', async ({ page }) => {
  const file = await createFile(page, { type: 'doc', title: 'Image cursor' });
  await page.goto(`/d/${file.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await page.keyboard.type('alpha');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('omega');
  await page.keyboard.press('ArrowUp');

  // Writing somewhere else in the document.
  let upload = await holdUploads(page);
  await pasteImages(editor, ['moved']);
  await upload.started;
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' typed');
  await upload.release();
  await expect(editor.locator('img')).toHaveCount(1);
  await page.keyboard.type(' on');
  expect(await blocksWithImages(editor)).toEqual(['alpha', 'image moved', '', 'omega typed on']);

  // Writing in the file name.
  upload = await holdUploads(page);
  await pasteImages(editor, ['renamed']);
  await upload.started;
  const title = page.getByRole('textbox', { name: 'File name' });
  await title.click();
  await title.press('End');
  await page.keyboard.type(' renamed');
  await upload.release();
  await expect(editor.locator('img')).toHaveCount(2);
  await page.keyboard.type(' twice');
  await expect(title).toBeFocused();
  await expect(title).toHaveValue('Image cursor renamed twice');
  expect(await blocksWithImages(editor)).toEqual(['alpha', 'image moved', '', 'omega typed on', 'image renamed', '']);
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
