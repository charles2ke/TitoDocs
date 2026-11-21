import type { Node as PMNode } from '@tiptap/pm/model';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { absoluteUrl, blobToDataUrl, escapeHtml, fetchSameOrigin } from '../lib/util';
import { paperSize, printCss, type PageSetup } from './pageSetup';

interface HeadingInfo {
  level: number;
  text: string;
  id: string;
}

/** Heading anchors compatible with GitHub's Markdown slugs, unique within a document. */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  return (text) => {
    const base =
      text
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
        .replace(/ /g, '-') || 'section';
    let slug = base;
    for (let count = 1; used.has(slug); count++) slug = `${base}-${count}`;
    used.add(slug);
    return slug;
  };
}

const parse = (html: string): Document => new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');

function annotateHeadings(doc: Document): HeadingInfo[] {
  const slug = createSlugger();
  const headings: HeadingInfo[] = [];
  doc.body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6').forEach((element) => {
    const text = element.textContent?.trim() ?? '';
    if (!text) return;
    element.id = slug(text);
    headings.push({ level: Number(element.tagName[1]), text, id: element.id });
  });
  return headings;
}

/** Nested list of links to the headings, mirroring the live table of contents. */
function tocList(doc: Document, headings: HeadingInfo[]): HTMLUListElement {
  const root = doc.createElement('ul');
  const stack: { level: number; list: HTMLElement }[] = [];
  for (const heading of headings) {
    while (stack.length && stack[stack.length - 1]!.level > heading.level) stack.pop();
    let top = stack[stack.length - 1];
    if (!top) {
      top = { level: heading.level, list: root };
      stack.push(top);
    } else if (top.level < heading.level) {
      const parent = top.list.lastElementChild ?? top.list.appendChild(doc.createElement('li'));
      top = { level: heading.level, list: parent.appendChild(doc.createElement('ul')) };
      stack.push(top);
    }
    const link = top.list.appendChild(doc.createElement('li')).appendChild(doc.createElement('a'));
    link.href = `#${heading.id}`;
    link.textContent = heading.text;
  }
  return root;
}

function fillTablesOfContents(doc: Document, headings: HeadingInfo[]): void {
  doc.querySelectorAll('div[data-type="table-of-contents"]').forEach((toc) => {
    if (!headings.length) {
      toc.remove();
      return;
    }
    const title = doc.createElement('p');
    title.className = 'toc-title';
    title.appendChild(doc.createElement('strong')).textContent = 'Table of contents';
    toc.replaceChildren(title, tocList(doc, headings));
  });
}

/** Links and images to this site's pages and uploads need the full URL outside of the app. */
function absolutizeUrls(doc: Document): void {
  doc.querySelectorAll('a[href^="/"]').forEach((link) => link.setAttribute('href', absoluteUrl(link.getAttribute('href')!)));
  doc.querySelectorAll('img[src^="/"]').forEach((image) => image.setAttribute('src', absoluteUrl(image.getAttribute('src')!)));
}

/** Embeds uploaded images so an exported file still shows them without signing in. */
async function inlineImages(doc: Document): Promise<void> {
  await Promise.all(
    [...doc.images].map(async (image) => {
      const src = image.getAttribute('src');
      const blob = src ? await fetchSameOrigin(src) : null;
      if (blob) image.setAttribute('src', await blobToDataUrl(blob));
    }),
  );
}

const EXPORT_CSS = `
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #202124; font: 11pt/1.3 Arial, Helvetica, sans-serif; }
main { margin: 0 auto; padding: 48px 24px; overflow-wrap: break-word; }
p { margin: 0 0 0.6em; }
h1, h2, h3, h4, h5, h6 { font-weight: 600; line-height: 1.25; margin: 1.1em 0 0.4em; }
h1 { font-size: 20pt; } h2 { font-size: 16pt; } h3 { font-size: 14pt; } h4 { font-size: 12pt; } h5, h6 { font-size: 11pt; }
h6 { font-style: italic; font-weight: 500; }
main > :first-child { margin-top: 0; }
a { color: #1155cc; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.6em; }
li > p { margin: 0 0 0.15em; }
ul ul { list-style-type: circle; } ul ul ul { list-style-type: square; }
ol ol { list-style-type: lower-alpha; } ol ol ol { list-style-type: lower-roman; }
ul[data-type="taskList"] { list-style: none; padding-left: 0.2em; }
ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
ul[data-type="taskList"] li > label { flex: none; display: flex; align-items: center; height: 1.3em; }
ul[data-type="taskList"] li > div { flex: 1; min-width: 0; }
ul[data-type="taskList"] li[data-checked="true"] > div { color: #80868b; text-decoration: line-through; }
blockquote { margin: 0 0 0.6em; padding: 0.1em 0 0.1em 1em; border-left: 3px solid #dadce0; color: #5f6368; }
hr { border: none; border-top: 1px solid #dadce0; margin: 1em 0; }
code { font-family: Consolas, 'Courier New', monospace; font-size: 0.9em; background: #f1f3f4; border-radius: 4px; padding: 0.1em 0.3em; }
pre { margin: 0 0 0.8em; padding: 0.8em 1em; background: #f6f8fa; border: 1px solid #e1e4e8; border-radius: 6px; white-space: pre-wrap; }
pre code { background: none; padding: 0; }
mark { border-radius: 2px; padding: 0 1px; color: inherit; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 0 0 0.8em; }
th, td { border: 1px solid #c0c4c8; padding: 4px 8px; vertical-align: top; text-align: left; }
th { background: #f1f3f4; font-weight: 600; }
td > p, th > p { margin: 0; }
.mention { color: #1a73e8; background: #e8f0fe; border-radius: 4px; padding: 0 2px; }
details { margin: 0 0 0.6em; padding: 0.4em 0.8em; border: 1px solid #dadce0; border-radius: 6px; }
summary { font-weight: 600; cursor: pointer; }
.toc { margin: 0 0 0.8em; padding: 0.6em 1em; border: 1px solid #dadce0; border-radius: 6px; }
.toc ul { list-style: none; margin: 0; padding-left: 1.2em; }
.toc > ul { padding-left: 0; }
.toc-title { margin-bottom: 0.3em; }
.page-break { margin: 1.5em 0; border-top: 1px dashed #c0c4c8; }
@media print {
  main { max-width: none !important; padding: 0; }
  .page-break { margin: 0; border: none; break-after: page; }
  details > :not(summary) { display: block; }
}
`;

/** A standalone web page with the document's formatting and embedded images. */
export async function exportHtml(html: string, title: string, setup: PageSetup): Promise<Blob> {
  const doc = parse(html);
  fillTablesOfContents(doc, annotateHeadings(doc));
  doc.querySelectorAll('input[type="checkbox"]').forEach((input) => input.setAttribute('disabled', ''));
  doc.querySelectorAll('details').forEach((details) => details.setAttribute('open', ''));
  await inlineImages(doc);
  absolutizeUrls(doc);
  const width = paperSize(setup).width - setup.margins.left - setup.margins.right;
  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="TitoDocs">
<title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}main { max-width: ${setup.pageless ? '960px' : `calc(${width}in + 48px)`}; }
${printCss(setup)}
</style>
</head>
<body>
<main>
${doc.body.innerHTML}
</main>
</body>
</html>
`;
  return new Blob([page], { type: 'text/html;charset=utf-8' });
}

const PAGE_BREAK_MARKDOWN = '\n\n<div style="page-break-after: always"></div>\n\n';

/** GitHub-flavoured Markdown. Formatting Markdown can't express (colours, fonts, alignment) is dropped. */
export function exportMarkdown(html: string): string {
  const doc = parse(html);
  fillTablesOfContents(doc, annotateHeadings(doc));
  absolutizeUrls(doc);
  doc.querySelectorAll('li[data-type="taskItem"]').forEach((item) => {
    // Keep the checkbox state in the item and unwrap its content so nested lists indent correctly.
    item.querySelector(':scope > label')?.remove();
    const content = item.querySelector(':scope > div');
    content?.replaceWith(...content.childNodes);
  });
  // GFM tables need the header row to be the first thing in the table.
  doc.querySelectorAll('colgroup').forEach((element) => element.remove());
  doc.querySelectorAll('table, th, td').forEach((element) => {
    element.removeAttribute('style');
    element.removeAttribute('colwidth');
  });
  doc.querySelectorAll('details').forEach((details) => {
    const summary = details.querySelector(':scope > summary');
    details.setAttribute('data-summary', summary?.textContent?.trim() || 'Details');
    summary?.remove();
  });

  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
    // Page breaks are empty elements, which Turndown would otherwise drop.
    blankReplacement: (_content, node) =>
      (node as HTMLElement).getAttribute?.('data-type') === 'page-break'
        ? PAGE_BREAK_MARKDOWN
        : (node as unknown as { isBlock: boolean }).isBlock
          ? '\n\n'
          : '',
  });
  service.use(gfm);
  service.keep(['sub', 'sup']);
  service.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && node.getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '\n').replace(/\n/gm, '\n    ');
      return `- [${checked ? 'x' : ' '}] ${body}${node.nextSibling && !body.endsWith('\n') ? '\n' : ''}`;
    },
  });
  // Table cells must stay on one line in GFM.
  service.addRule('tableCellParagraph', {
    filter: (node) => node.nodeName === 'P' && /^T[DH]$/.test(node.parentNode?.nodeName ?? ''),
    replacement: (content, node) => `${node.previousElementSibling ? '<br>' : ''}${content.trim()}`,
  });
  service.addRule('tableCellBreak', {
    filter: (node) => node.nodeName === 'BR' && !!node.closest('td, th'),
    replacement: () => '<br>',
  });
  service.addRule('details', {
    filter: (node) => node.nodeName === 'DETAILS',
    replacement: (content, node) =>
      `\n\n<details>\n<summary>${escapeHtml((node as HTMLElement).getAttribute('data-summary') ?? '')}</summary>\n\n${content.trim()}\n\n</details>\n\n`,
  });
  return `${service.turndown(doc.body).trim()}\n`;
}

/** Plain text, keeping list markers, task states and table cells readable. */
export function exportText(doc: PMNode): string {
  const headings: { level: number; text: string }[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'heading' && node.textContent.trim()) {
      headings.push({ level: node.attrs.level as number, text: node.textContent.trim() });
    }
    return !node.isTextblock;
  });
  const minLevel = Math.min(...headings.map((heading) => heading.level));

  const leafText = (leaf: PMNode): string => {
    switch (leaf.type.name) {
      case 'hardBreak':
        return '\n';
      case 'mention':
        return `@${leaf.attrs.label ?? leaf.attrs.id}`;
      case 'image':
        return leaf.attrs.alt ? `[Image: ${leaf.attrs.alt}]` : '[Image]';
      default:
        return '';
    }
  };

  const children = (node: PMNode): string[] => {
    const lines: string[] = [];
    node.forEach((child) => lines.push(...blockLines(child)));
    return lines;
  };

  const listLines = (list: PMNode): string[] => {
    const lines: string[] = [];
    const start = (list.attrs.start as number | undefined) ?? 1;
    list.forEach((item, _offset, index) => {
      const marker =
        list.type.name === 'orderedList'
          ? `${start + index}. `
          : list.type.name === 'taskList'
            ? item.attrs.checked
              ? '[x] '
              : '[ ] '
            : '• ';
      const itemLines = children(item);
      if (!itemLines.length) lines.push(marker.trimEnd());
      itemLines.forEach((line, lineIndex) => lines.push((lineIndex ? ' '.repeat(marker.length) : marker) + line));
    });
    return lines;
  };

  const blockLines = (node: PMNode): string[] => {
    switch (node.type.name) {
      case 'paragraph':
      case 'heading':
      case 'detailsSummary':
        return node.textBetween(0, node.content.size, '\n', leafText).split('\n');
      case 'codeBlock':
        return node.textContent.split('\n');
      case 'image':
        return [leafText(node)];
      case 'horizontalRule':
        return ['----------'];
      case 'pageBreak':
        return [''];
      case 'tableOfContents':
        return headings.map((heading) => `${'  '.repeat(heading.level - minLevel)}${heading.text}`);
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return listLines(node);
      case 'blockquote':
        return children(node).map((line) => `> ${line}`);
      case 'table': {
        const rows: string[] = [];
        node.forEach((row) => {
          const cells: string[] = [];
          row.forEach((cell) => cells.push(children(cell).join(' ')));
          rows.push(cells.join('\t'));
        });
        return rows;
      }
      default: {
        // Block atoms such as Loop components export the text their extension's renderText gives.
        const toText = node.type.spec.toText as ((props: { node: PMNode }) => string) | undefined;
        return node.isAtom && toText ? [toText({ node })] : children(node);
      }
    }
  };

  return `${children(doc).join('\n')}\n`;
}
