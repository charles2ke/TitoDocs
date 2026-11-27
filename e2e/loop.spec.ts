import { readFile } from 'node:fs/promises';
import type { Locator, Page, Route } from '@playwright/test';
import { expect, readPdf, showPdfPage, snap, test, USERS } from './fixtures.ts';

/** Starts a workspace from its template on the home page, which opens the workspace's Welcome page. */
async function newWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /^Workspace/ }).click();
  await expect(page).toHaveURL(/\/w\/[\w-]+\/[\w-]+$/);
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Welcome');
}

/** Clicks below the text of the open page, which puts the cursor on an empty line at its end. */
async function newLineAtEnd(page: Page): Promise<void> {
  await page.getByTestId('page-paper').locator('.page-end').click();
  await expect(page.getByTestId('page-paper').locator('.tiptap')).toBeFocused();
}

const componentCard = (page: Page, type: string): Locator =>
  page.getByTestId('page-paper').locator(`[data-testid="loop-card"][data-component-type="${type}"]`);

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

async function pasteImage(editor: Locator): Promise<void> {
  await editor.evaluate(async (element) => {
    const clipboardData = new DataTransfer();
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    clipboardData.items.add(new File([png!], 'nested-focus.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
}

test('starts a workspace and shares a live task list', async ({ page, openAs }) => {
  await newWorkspace(page);
  const paper = page.getByTestId('page-paper');
  await expect(paper.getByRole('heading', { name: 'Get started' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Welcome' })).toHaveAttribute('aria-current', 'page');

  await newLineAtEnd(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-tasks').click();
  const card = componentCard(page, 'tasks');
  const tasks = card.getByRole('textbox', { name: 'Task' });
  // A new list starts with an empty task, ready to type in.
  await expect(tasks).toBeFocused();
  await page.keyboard.type('Book the venue');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Send the invitations');
  await expect(tasks.nth(0)).toHaveValue('Book the venue');
  await expect(tasks.nth(1)).toHaveValue('Send the invitations');

  await card.getByRole('checkbox', { name: 'Done' }).first().check();
  await expect(card).toContainText('1 of 2 done');

  // Enter right after typing a name picks the person found for that name, not someone from an earlier search.
  const second = card.locator('.task-row').nth(1);
  await second.hover();
  await second.getByRole('button', { name: 'Assign', exact: true }).click();
  const search = second.getByRole('searchbox', { name: 'Search people' });
  await search.fill('vic');
  await search.press('Enter');
  await expect(second.getByRole('button', { name: `Assigned to ${USERS.victor.displayName}. Change assignee` })).toBeVisible();
  await snap(page, 'loop-tasks');

  // Victor opens the component on its own (components are shared with anyone who has the link) and finishes the list.
  const href = await card.getByRole('link', { name: 'Open in full view' }).getAttribute('href');
  expect(href).toMatch(/^\/c\/[\w-]+$/);
  const victor = await openAs('victor');
  await victor.goto(href!);
  await expect(victor.getByText('1 of 2 done')).toBeVisible();
  await expect(victor.getByRole('textbox', { name: 'Task' }).nth(1)).toHaveValue('Send the invitations');
  await victor.getByRole('checkbox', { name: 'Done' }).nth(1).check();
  await expect(card).toContainText('2 of 2 done');
  await snap(victor, 'loop-component-full-view');
});

test('does not refocus the page editor when typing in a nested loop input during upload', async ({ page }) => {
  await newWorkspace(page);
  await newLineAtEnd(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-tasks').click();
  const task = componentCard(page, 'tasks').getByRole('textbox', { name: 'Task' });
  await expect(task).toBeFocused();

  await newLineAtEnd(page);
  const editor = page.getByTestId('page-paper').locator('.tiptap');
  const upload = await holdUploads(page);
  await pasteImage(editor);
  await upload.started;
  await task.fill('Keep focus here');
  await upload.release();

  await expect(editor.locator('img')).toHaveCount(1);
  await expect(task).toBeFocused();
  await expect(task).toHaveValue('Keep focus here');
});

test('votes in a voting table that others open from its link', async ({ page, openAs }) => {
  await newWorkspace(page);
  await newLineAtEnd(page);
  await page.keyboard.type('/vot');
  await page.getByRole('listbox').getByRole('option', { name: /Voting table/ }).click();
  const card = componentCard(page, 'voting');
  // A new voting table starts with two empty options.
  const options = card.getByRole('textbox', { name: 'Option' });
  await expect(options).toHaveCount(2);
  await expect(options.first()).toBeFocused();
  await page.keyboard.type('Pizza');
  await options.nth(1).click();
  await page.keyboard.type('Sushi');
  await expect(options.nth(1)).toHaveValue('Sushi');

  const victor = await openAs('victor');
  await victor.goto((await card.getByRole('link', { name: 'Open in full view' }).getAttribute('href'))!);
  const victorSushi = victor.locator('.vote-row').nth(1);
  await expect(victorSushi.getByRole('textbox', { name: 'Option' })).toHaveValue('Sushi');
  await victorSushi.getByRole('button', { name: 'Vote (0 votes)' }).click();

  const sushi = card.locator('.vote-row').nth(1);
  await expect(card).toContainText('1 vote from 1 person');
  await expect(sushi).toContainText('Leading');
  await sushi.getByRole('button', { name: 'Vote (1 vote)' }).click();
  await expect(card).toContainText('2 votes from 2 people');
  await expect(victorSushi.getByRole('button', { name: 'Remove your vote (2 votes)' })).toBeVisible();
  await snap(page, 'loop-voting');
});

test('adds, trashes and restores pages', async ({ page }) => {
  await newWorkspace(page);
  const tree = page.getByRole('navigation', { name: 'Pages' });
  await tree.getByRole('button', { name: 'New page' }).click();
  const title = page.getByRole('textbox', { name: 'Page title' });
  await expect(title).toBeFocused();
  await title.fill('Agenda');
  await title.press('Enter');
  await expect(tree.getByRole('link', { name: 'Agenda' })).toBeVisible();
  const trashAgenda = async () => {
    // A page's actions show while its row is hovered.
    await tree.getByRole('link', { name: 'Agenda' }).hover();
    await tree.getByRole('button', { name: 'Agenda options' }).click();
    await page.getByTestId('trash-page').click();
    await expect(tree.getByRole('link', { name: 'Agenda' })).toBeHidden();
  };

  // Undo brings the page back where it was, and it can still be edited.
  await trashAgenda();
  await expect(title).toHaveValue('Welcome');
  const toast = page.getByRole('status').filter({ hasText: '“Agenda” was moved to the trash' });
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(tree.getByRole('link', { name: 'Agenda' })).toHaveAttribute('aria-current', 'page');
  await expect(title).toHaveValue('Agenda');
  const editor = page.getByTestId('page-paper').locator('.tiptap');
  await editor.click();
  await page.keyboard.type('Welcome and introductions');
  await expect(editor).toHaveText('Welcome and introductions');

  // Trashed pages can also be restored later, from "Recently deleted".
  await trashAgenda();
  await page.getByRole('button', { name: 'Recently deleted' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recently deleted pages' });
  await expect(dialog).toContainText('Agenda');
  await snap(page, 'loop-recently-deleted');
  await dialog.getByRole('button', { name: 'Restore' }).click();
  await expect(tree.getByRole('link', { name: 'Agenda' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // Reloading shows what the server kept: the text typed after Undo was saved.
  await tree.getByRole('link', { name: 'Agenda' }).click();
  await expect(title).toHaveValue('Agenda');
  await page.reload();
  await expect(editor).toHaveText('Welcome and introductions');
});

test('downloads a page as a PDF, with links to its components', async ({ page }) => {
  await newWorkspace(page);
  await newLineAtEnd(page);
  await page.getByTestId('insert-menu').click();
  await page.getByTestId('insert-tasks').click();
  const card = componentCard(page, 'tasks');
  await expect(card.getByRole('textbox', { name: 'Task' })).toBeFocused();
  const href = await card.getByRole('link', { name: 'Open in full view' }).getAttribute('href');

  const download = page.waitForEvent('download');
  await page.getByTestId('page-options').click();
  await page.getByRole('menu', { name: 'Page options' }).getByRole('menuitem', { name: 'Download' }).click();
  const formats = page.getByRole('menu', { name: 'Download' });
  await expect(formats.getByRole('menuitem')).toHaveText(['PDF document (.pdf)', 'Markdown (.md)', 'Web page (.html)', 'Plain text (.txt)']);
  await snap(page, 'loop-download-menu');
  await formats.getByRole('menuitem', { name: 'PDF document (.pdf)' }).click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toBe('Welcome.pdf');
  const bytes = await readFile(await pdf.path());
  const content = await readPdf(bytes);
  expect(content.title).toBe('Welcome');
  expect(content.pages).toHaveLength(1);
  // The page's title comes first, and components (whose content lives elsewhere) are links.
  expect(content.pages[0]![0]).toBe('Welcome');
  expect(content.pages[0]).toContain('Get started');
  expect(content.pages[0]![content.pages[0]!.length - 1]).toBe('Task list (Loop component)');
  expect(content.links).toEqual([new URL(href!, page.url()).href]);
  const viewer = await showPdfPage(page.context(), bytes);
  await snap(viewer, 'loop-pdf');
  await viewer.close();
});

test('fits a phone screen, with the pages in a drawer', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 800 });
  await newWorkspace(page);
  const sidebar = page.getByRole('complementary', { name: 'Workspace pages' });
  await expect(sidebar).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(400);
  await snap(page, 'loop-mobile');

  await page.getByRole('button', { name: 'Show pages' }).click();
  await expect(sidebar).toBeVisible();
  await snap(page, 'loop-mobile-pages');
  await sidebar.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'New page' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title' })).toBeFocused();
  await expect(sidebar).toBeHidden();
});
