import DOMPurify from 'dompurify';
import { api } from '../api';
import { extensionOf } from '../lib/files';
import { escapeHtml } from '../lib/util';

/** Removes scripts, event handlers and other active content from imported HTML. */
export const sanitizeHtml = (html: string): string =>
  DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed'],
  });

/** Parses HTML without running scripts or loading images, which `element.innerHTML` would do. */
const parseInert = (html: string): HTMLElement => new DOMParser().parseFromString(html, 'text/html').body;

export const textToHtml = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');

export async function markdownToHtml(markdown: string): Promise<string> {
  const { marked } = await import('marked');
  const html = await marked.parse(markdown, { gfm: true, breaks: false });
  // GitHub-style task lists ("- [ ] item") become TipTap task items. This runs before sanitising,
  // which strips <input> elements.
  const container = parseInert(html);
  for (const list of container.querySelectorAll('ul')) {
    const items = [...list.children].filter((child) => child.tagName === 'LI');
    if (!items.length || !items.every((item) => item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]'))) continue;
    list.setAttribute('data-type', 'taskList');
    for (const item of items) {
      const checkbox = item.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', String(checkbox.checked));
      checkbox.remove();
    }
  }
  return sanitizeHtml(container.innerHTML);
}

async function docxToHtml(buffer: ArrayBuffer): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      // Upload embedded images instead of inlining them as huge data URLs.
      convertImage: mammoth.images.imgElement(async (image) => {
        try {
          const data = await image.read();
          return { src: await api.upload(new Blob([data as BlobPart], { type: image.contentType })) };
        } catch {
          // Formats the server does not accept (such as EMF) are dropped below.
          return { src: '' };
        }
      }),
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
    },
  );
  const body = parseInert(sanitizeHtml(result.value));
  for (const image of body.querySelectorAll('img:not([src]), img[src=""]')) image.remove();
  return body.innerHTML;
}

/** Converts an uploaded document into HTML that the rich-text editor can load. */
export async function fileToHtml(file: File): Promise<string> {
  const extension = extensionOf(file.name);
  if (extension === 'docx') return docxToHtml(await file.arrayBuffer());
  const text = await file.text();
  if (extension === 'md' || extension === 'markdown') return markdownToHtml(text);
  if (extension === 'html' || extension === 'htm') return sanitizeHtml(parseInert(text).innerHTML);
  return textToHtml(text);
}
