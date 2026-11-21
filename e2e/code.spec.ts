import type { Locator, Page } from '@playwright/test';
import { expect, pickMenu, snap, test, waitForSync } from './fixtures.ts';

const editorLines = (page: Page): Locator => page.getByTestId('code-editor').locator('.cm-line');

async function newCodeFile(page: Page, template: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: template, exact: true }).click();
  await expect(page).toHaveURL(/\/code\/[\w-]+$/);
  await waitForSync(page);
}

test('opens a Python script with syntax highlighting', async ({ page }) => {
  await newCodeFile(page, 'Python script');
  await expect(page.getByRole('textbox', { name: 'File name' })).toHaveValue('main.py');
  await expect(page.getByTestId('status-language')).toHaveText('Python');
  await expect(editorLines(page).first()).toHaveText('def main() -> None:');
  // Highlighted keywords get a span of their own.
  await expect(editorLines(page).first().locator('span', { hasText: /^def$/ })).toBeVisible();
  await snap(page, 'code-python');
});

test('edits text with Notepad++ style line tools, search and tabs', async ({ page }) => {
  await newCodeFile(page, 'Text file');
  const name = page.getByRole('textbox', { name: 'File name' });
  await name.fill('fruits.txt');
  await name.press('Enter');

  const content = page.getByTestId('code-editor').locator('.cm-content');
  await content.click();
  await page.keyboard.insertText('pear\napple\nfig\napple');
  await expect(page.getByTestId('status-size')).toHaveText('Length: 20 · Lines: 4');

  await pickMenu(page, ['Edit', 'Line operations', 'Remove duplicate lines']);
  await expect(editorLines(page)).toHaveText(['pear', 'apple', 'fig']);
  await pickMenu(page, ['Edit', 'Line operations', 'Sort lines lexicographically ascending']);
  await expect(editorLines(page)).toHaveText(['apple', 'fig', 'pear']);
  await content.click();
  await page.keyboard.press('ControlOrMeta+a');
  await pickMenu(page, ['Edit', 'Convert case to', 'UPPERCASE']);
  await expect(editorLines(page)).toHaveText(['APPLE', 'FIG', 'PEAR']);

  await pickMenu(page, ['Search', 'Replace…']);
  const search = page.getByTestId('code-search');
  await search.getByTestId('code-search-mode').selectOption('regexp');
  await search.getByTestId('code-find-input').fill('^\\w{4}$');
  await expect(search.getByTestId('code-find-status')).toHaveText(/^1 (result|of 1)$/);
  await search.getByTestId('code-replace-input').fill('PLUM');
  await snap(page, 'code-search');
  await search.getByTestId('code-replace-all').click();
  await expect(editorLines(page)).toHaveText(['APPLE', 'FIG', 'PLUM']);

  // Files open in tabs, like in Notepad++.
  const tabs = page.getByTestId('code-tabs');
  await expect(tabs.getByRole('link', { name: 'fruits.txt' })).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('code-new-tab').click();
  await expect(tabs.getByRole('link', { name: 'untitled.txt' })).toHaveAttribute('aria-current', 'page');
  await waitForSync(page);
  await expect(page.getByTestId('status-size')).toHaveText('Length: 0 · Lines: 1');
  await tabs.getByRole('link', { name: 'fruits.txt' }).click();
  await expect(editorLines(page)).toHaveText(['APPLE', 'FIG', 'PLUM']);
  await snap(page, 'code-tabs');

  await page.reload();
  await waitForSync(page);
  await expect(editorLines(page)).toHaveText(['APPLE', 'FIG', 'PLUM']);
  await expect(tabs.getByRole('link')).toHaveCount(2);
});

test('keeps keyboard focus in Compare and restores it when closed', async ({ page }) => {
  await newCodeFile(page, 'Text file');
  await pickMenu(page, ['Tools', 'Compare…']);
  await page.getByRole('radio', { name: 'Pasted text' }).check();
  await page.getByTestId('compare-paste').fill('other text');
  await page.getByRole('button', { name: 'Compare', exact: true }).click();

  const compare = page.getByTestId('compare-view');
  await expect(compare).toBeVisible();
  await page.getByTestId('code-editor').locator('.cm-content').evaluate((element) => (element as HTMLElement).focus());
  expect(await compare.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await compare.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await snap(page, 'code-compare');
  await compare.getByRole('button', { name: 'Close compare' }).click();
  await expect(compare).toHaveCount(0);
  await expect(page.getByTestId('code-editor').locator('.cm-content')).toBeFocused();
});

test('ignores stale file metadata when switching tabs quickly', async ({ page }) => {
  await newCodeFile(page, 'Text file');
  const tabs = page.getByTestId('code-tabs');
  const filename = page.getByRole('textbox', { name: 'File name' });
  await filename.fill('first.txt');
  await filename.press('Enter');
  const firstId = new URL(page.url()).pathname.split('/').pop()!;

  await page.getByTestId('code-new-tab').click();
  await expect(page).toHaveURL(/\/code\/[\w-]+$/);
  const secondId = new URL(page.url()).pathname.split('/').pop()!;
  await waitForSync(page);

  let releaseResponse!: () => void;
  let notifyResponseStarted!: () => void;
  const responseStarted = new Promise<void>((resolve) => {
    notifyResponseStarted = resolve;
  });
  const responseHeld = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route((url) => url.pathname === `/api/files/${firstId}`, async (route) => {
    notifyResponseStarted();
    await responseHeld;
    await route.continue();
  });
  await tabs.getByRole('link', { name: 'first.txt' }).click();
  await responseStarted;
  await page.goBack();
  await waitForSync(page);
  releaseResponse();

  await expect(filename).toHaveValue('untitled.txt');
  await waitForSync(page);
  await page.unroute((url) => url.pathname === `/api/files/${firstId}`);
});
