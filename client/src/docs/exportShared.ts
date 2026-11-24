import type { JSONContent } from '@tiptap/core';
import { fetchSameOrigin } from '../lib/util';

/** Helpers shared by the Word and PDF exporters. */

export interface LoadedImage<T extends string> {
  data: Uint8Array;
  type: T | 'png';
  /** Natural size in CSS pixels. */
  width: number;
  height: number;
}

/** Headings with text, in document order; the targets of a table of contents. */
export interface Headings {
  list: { level: number; text: string }[];
  index: Map<JSONContent, number>;
}

export const plainText = (node: JSONContent): string =>
  node.type === 'text'
    ? (node.text ?? '')
    : node.type === 'mention'
      ? `@${node.attrs?.label ?? node.attrs?.id ?? ''}`
      : (node.content ?? []).map(plainText).join('');

let colorContext: CanvasRenderingContext2D | null | undefined;

/** Converts a CSS colour to upper-case hex without `#`; undefined for invalid or transparent colours. */
export function hexColor(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  colorContext ??= document.createElement('canvas').getContext('2d');
  if (!colorContext) return undefined;
  const sentinel = '#010203';
  colorContext.fillStyle = sentinel;
  colorContext.fillStyle = value;
  const normalized = String(colorContext.fillStyle);
  if (normalized === sentinel && value.trim().toLowerCase() !== sentinel) return undefined;
  if (normalized.startsWith('#')) return normalized.slice(1).toUpperCase();
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(normalized);
  if (!match || Number(match[4] ?? 1) === 0) return undefined;
  return match
    .slice(1, 4)
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Absolute http(s)/mailto/tel URLs; anything else can't be a link in an exported file. */
export function safeLink(href: unknown): string | null {
  if (typeof href !== 'string' || !href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, window.location.href);
    return /^(https?|mailto|tel):$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function collectHeadings(doc: JSONContent): Headings {
  const headings: Headings = { list: [], index: new Map() };
  const visit = (node: JSONContent) => {
    if (node.type === 'heading') {
      const text = plainText(node).trim();
      if (text) {
        headings.index.set(node, headings.list.length);
        headings.list.push({ level: Number(node.attrs?.level) || 1, text });
      }
      return;
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return headings;
}

async function loadImage<T extends string>(src: string, types: Record<string, T>): Promise<LoadedImage<T> | null> {
  const blob = await fetchSameOrigin(src);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    const width = element.naturalWidth || 300;
    const height = element.naturalHeight || 150;
    let type: T | 'png' | undefined = types[blob.type];
    let data: Blob | null = blob;
    if (!type) {
      // Other formats (e.g. WebP, AVIF or SVG) are converted to PNG.
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(element, 0, 0, width, height);
      data = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      type = 'png';
    }
    return data ? { data: new Uint8Array(await data.arrayBuffer()), type, width, height } : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The document's same-site images by `src`; those whose MIME type isn't in `types` are converted to PNG. */
export async function loadImages<T extends string>(
  doc: JSONContent,
  types: Record<string, T>,
): Promise<Map<string, LoadedImage<T>>> {
  const sources = new Set<string>();
  const visit = (node: JSONContent) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') sources.add(node.attrs.src);
    node.content?.forEach(visit);
  };
  visit(doc);
  const images = new Map<string, LoadedImage<T>>();
  await Promise.all(
    [...sources].map(async (src) => {
      const image = await loadImage(src, types);
      if (image) images.set(src, image);
    }),
  );
  return images;
}
