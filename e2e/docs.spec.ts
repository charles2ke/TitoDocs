import { readFile } from 'node:fs/promises';
import { createFile, docEditor, expect, pickMenu, readPdf, showPdfPage, snap, test, waitForSync } from './fixtures.ts';

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

test('downloads a PDF with the formatting, links and bookmarks of the document', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  const file = await createFile(page, { type: 'doc', title: 'Launch plan' });
  await page.goto(`/d/${file.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.click();
  await editor.evaluate((element, html) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, `<h1>Launch plan</h1>
    <p>We ship on <strong>June 3</strong>. Read the <a href="https://example.com/brief">brief</a> first.</p>
    <div data-type="table-of-contents"></div>
    <h2>Timeline</h2>
    <ol><li><p>Freeze features</p></li><li><p>Finish the beta ✓</p></li><li><p>Launch 🎉</p></li></ol>
    <h2>Budget</h2>
    <table><tbody>
      <tr><th><p>Item</p></th><th><p>Cost</p></th></tr>
      <tr><td><p>Ads</p></td><td><p>$4,000</p></td></tr>
      <tr><td><p>Events</p></td><td><p>$2,500</p></td></tr>
    </tbody></table>
    <pre><code class="language-js">const launch = new Date('2025-06-03');</code></pre>`);
  await expect(editor.locator('table')).toBeVisible();
  await expect(editor.locator('h2')).toHaveText(['Timeline', 'Budget']);

  const download = page.waitForEvent('download');
  await pickMenu(page, ['File', 'Download', 'PDF document (.pdf)']);
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe('Launch plan.pdf');
  const bytes = await readFile(await pdf.path());
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const content = await readPdf(bytes);
  // A Letter page, the default page setup.
  expect(content.size).toEqual([612, 792]);
  expect(content.title).toBe('Launch plan');
  expect(content.pages).toEqual([
    [
      'Launch plan',
      'We ship on June 3. Read the brief first.',
      'Table of contents',
      'Launch plan 1',
      'Timeline 1',
      'Budget 1',
      'Timeline',
      '1. Freeze features',
      '2. Finish the beta ✓',
      '3. Launch 🎉',
      'Budget',
      'Item Cost',
      'Ads $4,000',
      'Events $2,500',
      "const launch = new Date('2025-06-03');",
    ],
  ]);
  expect(content.links).toEqual(['https://example.com/brief']);
  expect(content.outline).toEqual([
    {
      title: 'Launch plan',
      items: [
        { title: 'Timeline', items: [] },
        { title: 'Budget', items: [] },
      ],
    },
  ]);
  const viewer = await showPdfPage(page.context(), bytes);
  await snap(viewer, 'doc-pdf');
  await viewer.close();

  // Characters that the PDF's fonts don't have can't be shown, so the download says so and suggests printing instead.
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' 東京');
  const again = page.waitForEvent('download');
  await pickMenu(page, ['File', 'Download', 'PDF document (.pdf)']);
  await again;
  const warning = page.getByRole('status').filter({ hasText: 'can’t be shown in the PDF' });
  await expect(warning).toContainText('Some characters (東 京) can’t be shown in the PDF.');
  await expect(warning.getByRole('button', { name: 'Print' })).toBeVisible();
  await snap(page, 'doc-pdf-warning');
  expect(errors).toEqual([]);
});

test('preserves page breaks inside block containers in the PDF', async ({ page }) => {
  const file = await createFile(page, { type: 'doc', title: 'Nested page breaks' });
  await page.goto(`/d/${file.id}`);
  await waitForSync(page);
  const editor = docEditor(page);
  await editor.evaluate((element, html) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  }, `<p>Before quote</p>
    <blockquote><p>Quote before</p><div data-type="page-break"></div><p>Quote after</p></blockquote>
    <p>After quote</p>
    <table><tbody><tr><td><p>Cell before</p><div data-type="page-break"></div><p>Cell after</p></td></tr></tbody></table>
    <p>After table</p>
    <ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Task before</p><div data-type="page-break"></div><p>Task after</p></div></li></ul>
    <p>After task</p>
    <details open><summary>Details</summary><div data-type="detailsContent"><p>Details before</p><div data-type="page-break"></div><p>Details after</p></div></details>
    <p>After details</p>`);

  const download = page.waitForEvent('download');
  await pickMenu(page, ['File', 'Download', 'PDF document (.pdf)']);
  const pdf = await download;
  const content = await readPdf(await readFile(await pdf.path()));
  const pageOf = (text: string) => content.pages.findIndex((lines) => lines.join(' ').includes(text));

  expect(content.pages).toHaveLength(5);
  for (const [before, after, following] of [
    ['Quote before', 'Quote after', 'After quote'],
    ['Cell before', 'Cell after', 'After table'],
    ['Task before', 'Task after', 'After task'],
    ['Details before', 'Details after', 'After details'],
  ]) {
    const beforePage = pageOf(before);
    const afterPage = pageOf(after);
    const followingPage = pageOf(following);
    expect(beforePage).toBeGreaterThanOrEqual(0);
    expect(afterPage).toBe(beforePage);
    expect(followingPage).toBeGreaterThan(afterPage);
  }
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

  let releaseUpload!: () => void;
  let notifyUploadStarted!: () => void;
  const uploadStarted = new Promise<void>((resolve) => {
    notifyUploadStarted = resolve;
  });
  const uploadHeld = new Promise<void>((resolve) => {
    releaseUpload = resolve;
  });
  await page.route('**/api/uploads', async (route) => {
    notifyUploadStarted();
    await uploadHeld;
    await route.continue();
  });
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.items.add(
      new File(
        [
          new Uint8Array([
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4,
            0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100, 96, 0, 2, 0, 0, 5, 0,
            1, 161, 67, 55, 39, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
          ]),
        ],
        'anchor.png',
        { type: 'image/png' },
      ),
    );
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await uploadStarted;
  await page.keyboard.type('typed ');
  releaseUpload();

  await expect(editor.locator('img[alt="anchor"]')).toHaveCount(1);
  expect(
    await editor.evaluate((root) =>
      Array.from(root.children, (child) => (child.querySelector('img') ? 'image' : child.textContent?.trim())),
    ),
  ).toEqual(['alpha typed', 'image', 'omega']);
  await page.unroute('**/api/uploads');
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
