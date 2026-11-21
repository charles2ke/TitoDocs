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
