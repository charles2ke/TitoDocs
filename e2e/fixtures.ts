import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
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

export interface PdfOutline {
  title: string;
  items: PdfOutline[];
}

export interface PdfContent {
  /** Each page's lines of text, from the top. */
  pages: string[][];
  /** The first page's width and height, in points. */
  size: number[];
  title: string;
  /** Where the links go, each once, in order. */
  links: string[];
  /** The bookmarks. */
  outline: PdfOutline[];
}

/** Reads a PDF with pdf.js. Pieces of text on a line are joined, with a space where there's a gap between them. */
export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  const { extractLinks, getDocumentProxy, getMeta } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pages: string[][] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    const rows = new Map<number, { x: number; width: number; text: string }[]>();
    for (const item of (await (await pdf.getPage(number)).getTextContent()).items) {
      if (!('str' in item) || !item.str) continue;
      const y = Math.round(item.transform[5]);
      rows.set(y, [...(rows.get(y) ?? []), { x: item.transform[4], width: item.width, text: item.str }]);
    }
    const lines = [...rows]
      .sort(([a], [b]) => b - a)
      .map(([, row]) => {
        row.sort((a, b) => a.x - b.x);
        return row
          .map(({ x, text }, index) => {
            const previous = row[index - 1];
            const gap = previous && x - (previous.x + previous.width) > 2 && !/\s$/.test(previous.text);
            return gap ? ` ${text}` : text;
          })
          .join('')
          .trim();
      });
    pages.push(lines.filter(Boolean));
  }
  const outline = (items: { title: string; items: unknown[] }[] | null): PdfOutline[] =>
    (items ?? []).map((item) => ({ title: item.title, items: outline(item.items as typeof items) }));
  const { info } = await getMeta(pdf);
  return {
    pages,
    size: (await pdf.getPage(1)).view.slice(2),
    title: String(info.Title ?? ''),
    // pdfmake gives each word of a link its own link area.
    links: [...new Set((await extractLinks(pdf)).links.flat())],
    outline: outline(await pdf.getOutline()),
  };
}

/** Opens a page that shows a page of a PDF, drawn by pdf.js, for a screenshot. */
export async function showPdfPage(context: BrowserContext, bytes: Uint8Array, number = 1): Promise<Page> {
  const viewer = await context.newPage();
  const code = await readFile(fileURLToPath(import.meta.resolve('unpdf/pdfjs')), 'utf8');
  await viewer.setContent('<body style="margin: 0">');
  const size = await viewer.evaluate(
    async ({ code, data, number }) => {
      const pdfjs = await import(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
      const pdf = await pdfjs.getDocument({ data: Uint8Array.from(atob(data), (char) => char.charCodeAt(0)) }).promise;
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1.25 });
      const canvas = document.body.appendChild(document.createElement('canvas'));
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.style.display = 'block';
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      return { width: canvas.width, height: canvas.height };
    },
    { code, data: Buffer.from(bytes).toString('base64'), number },
  );
  await viewer.setViewportSize(size);
  return viewer;
}
