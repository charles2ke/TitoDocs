import * as Y from 'yjs';
import { CODE_FIELD, ITEMS_FIELD, RICH_FIELD, type FileType } from '../shared/types.ts';

const MAX_TEXT = 200_000;

/** Plain-text projection of a file's collaborative content, used for full-text search. */
export function extractText(doc: Y.Doc, type: FileType): string {
  let text = '';
  if (type === 'code') {
    text = doc.getText(CODE_FIELD).toString();
  } else if (type === 'doc' || type === 'page' || type === 'component') {
    const parts: string[] = [];
    collectXmlText(doc.getXmlFragment(RICH_FIELD), parts);
    const items = doc.share.has(ITEMS_FIELD) ? doc.getArray(ITEMS_FIELD).toJSON() : [];
    for (const item of items) collectValues(item, parts);
    text = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  }
  return text.slice(0, MAX_TEXT);
}

function collectXmlText(node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook, parts: string[]): void {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta() as { insert: unknown }[]) {
      if (typeof op.insert === 'string') parts.push(op.insert);
    }
    return;
  }
  if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
    for (const child of node.toArray()) collectXmlText(child as Y.XmlElement, parts);
    if (node instanceof Y.XmlElement && node.nodeName !== 'text') parts.push('\n');
  }
}

function collectValues(value: unknown, parts: string[]): void {
  if (typeof value === 'string') parts.push(value, '\n');
  else if (Array.isArray(value)) value.forEach((entry) => collectValues(entry, parts));
  else if (value && typeof value === 'object') Object.values(value).forEach((entry) => collectValues(entry, parts));
}

/** A short excerpt of `text` around the first occurrence of `query`. */
export function snippet(text: string, query: string, radius = 60): string | null {
  if (!query) return null;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return null;
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}
