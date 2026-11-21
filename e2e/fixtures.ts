import { test as base, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';

export { expect };

export const USERS = {
  maria: { username: 'maria', password: 'correct-horse-42', displayName: 'Maria Garcia' },
  victor: { username: 'victor', password: 'viewer-pass-123', displayName: 'Victor Chen' },
  // Comes before the others in people searches, so a stale search result shows up as the wrong person.
  alex: { username: 'alex', password: 'alphabetical-1', displayName: 'Alex Kim' },
} as const;
export type UserName = keyof typeof USERS;

/** Signed-in browser state saved by auth.setup.ts. Tests run as Maria unless they open another context. */
export const authFile = (name: UserName) => `e2e/.auth/${name}.json`;

export interface FileInfo {
  id: string;
  title: string;
  type: string;
}

interface Fixtures {
  /** Opens a page signed in as someone else, in a browser context of their own. */
  openAs: (name: UserName) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  openAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (name) => {
      const context = await browser.newContext({ storageState: authFile(name) });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

/** Saves a screenshot to the HTML report and to test-results/screenshots (uploaded by CI for pull requests). */
export async function snap(page: Page, name: string): Promise<void> {
  const body = await page.screenshot({ path: `test-results/screenshots/${name}.png` });
  await test.info().attach(name, { body, contentType: 'image/png' });
}

export async function createFile(page: Page, data: Record<string, unknown>): Promise<FileInfo> {
  const response = await page.request.post('/api/files', { data });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()).file;
}

export async function addMember(page: Page, fileId: string, username: UserName, role: 'viewer' | 'commenter' | 'editor'): Promise<void> {
  const response = await page.request.post(`/api/files/${fileId}/members`, { data: { username, role } });
  expect(response.status(), await response.text()).toBe(200);
}

/** Waits until the open file is connected and in sync with the server. */
export async function waitForSync(page: Page): Promise<void> {
  await expect(page.getByTestId('save-status')).toHaveText(/Saved|View only/);
}

/** The rich-text editor of a document. */
export const docEditor = (page: Page): Locator => page.getByTestId('doc-paper').locator('.tiptap');

/** The text of each block of a document, without the name labels of other people's cursors. */
export const docBlocks = (page: Page): Promise<string[]> =>
  docEditor(page).evaluate((root) =>
    Array.from(root.children, (block) => {
      const copy = block.cloneNode(true) as Element;
      copy.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove());
      return copy.textContent ?? '';
    }),
  );

/** Opens a menu-bar menu and picks an entry, following submenus (e.g. `['Edit', 'Line operations', 'Sort …']`). */
export async function pickMenu(page: Page, path: string[]): Promise<void> {
  const [top, ...rest] = path;
  await page.getByRole('menubar').getByRole('menuitem', { name: top, exact: true }).click();
  let menu = page.getByRole('menu', { name: top, exact: true });
  for (const label of rest) {
    const item = menu.getByRole('menuitem', { name: label }).or(menu.getByRole('menuitemcheckbox', { name: label })).first();
    await item.click();
    menu = page.getByRole('menu', { name: label, exact: true });
  }
}
