import type { JSONContent } from '@tiptap/core';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';
import arimoRegular from '@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf?url';
import arimoItalic from '@expo-google-fonts/arimo/400Regular_Italic/Arimo_400Regular_Italic.ttf?url';
import arimoBold from '@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf?url';
import arimoBoldItalic from '@expo-google-fonts/arimo/700Bold_Italic/Arimo_700Bold_Italic.ttf?url';
import cousineRegular from '@expo-google-fonts/cousine/400Regular/Cousine_400Regular.ttf?url';
import cousineItalic from '@expo-google-fonts/cousine/400Regular_Italic/Cousine_400Regular_Italic.ttf?url';
import cousineBold from '@expo-google-fonts/cousine/700Bold/Cousine_700Bold.ttf?url';
import cousineBoldItalic from '@expo-google-fonts/cousine/700Bold_Italic/Cousine_700Bold_Italic.ttf?url';
import notoEmoji from '@expo-google-fonts/noto-emoji/400Regular/NotoEmoji_400Regular.ttf?url';
import tinosRegular from '@expo-google-fonts/tinos/400Regular/Tinos_400Regular.ttf?url';
import tinosItalic from '@expo-google-fonts/tinos/400Regular_Italic/Tinos_400Regular_Italic.ttf?url';
import tinosBold from '@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf?url';
import tinosBoldItalic from '@expo-google-fonts/tinos/700Bold_Italic/Tinos_700Bold_Italic.ttf?url';
import dejaVuSans from 'dejavu-fonts-ttf/ttf/DejaVuSans.ttf?url';
import { fontSizeInPoints } from '../editor/commands';
import { lowlight } from '../editor/extensions';
import { INDENT_STEP_IN, MAX_INDENT } from '../editor/paragraph-format';
import {
  collectHeadings,
  hexColor,
  loadImages,
  plainText,
  safeLink,
  type Headings,
  type LoadedImage,
} from './exportShared';
import { paperSize, type PageSetup } from './pageSetup';

/*
 * A PDF made with pdfmake from the document's JSON. Layout follows the editor's CSS (docs.css and editor.css):
 * sizes are in points, CSS margins collapse as in a browser and text sits in its line box the way CSS places it.
 * Fonts are metric-compatible with Arial, Times New Roman and Courier New, with fallbacks for symbols and emoji.
 */

type Family = 'Sans' | 'Serif' | 'Mono' | 'Symbols' | 'Emoji';
type Variant = 'normal' | 'bold' | 'italics' | 'bolditalics';
type Decoration = 'underline' | 'lineThrough';
/** A pdfmake content node. pdfmake's typings are too strict to build a document piece by piece. */
type PdfNode = Record<string, unknown>;
type LineSpec = { factor: number } | { points: number };
type PdfMake = typeof import('pdfmake/build/pdfmake');
/** What pdfmake's `pageBreakBefore` can ask about the nodes around a node. */
interface PageNodes {
  getFollowingNodesOnPage(): unknown[];
  getNodesOnNextPage(): unknown[];
  getPreviousNodesOnPage(): unknown[];
}

/** A run of text with the same formatting. */
interface Run {
  text: string;
  font: Family;
  fontSize: number;
  /** CSS line height, in points. */
  lineHeight: number;
  bold?: boolean;
  italics?: boolean;
  color?: string;
  background?: string;
  decoration?: Decoration[];
  decorationColor?: string;
  link?: string;
  linkToDestination?: string;
  sup?: boolean;
  sub?: boolean;
  pageReference?: string;
  /** Rendered in its font as is, without font fallback. */
  fixed?: boolean;
}

/** Text formatting inherited from enclosing blocks. */
interface TextStyle {
  font: Family;
  color: string;
  bold?: boolean;
  italics?: boolean;
  decoration?: Decoration[];
  decorationColor?: string;
}

/** A pdfmake node and the CSS spacing around it, which `join` turns into pdfmake margins. */
interface Block {
  node: PdfNode;
  /** CSS margins, which collapse with those of neighbouring blocks. */
  top: number;
  bottom: number;
  /** The part of `bottom` from the block's last child, when the children's margins collapse through the block. */
  innerBottom?: number;
  /**
   * Space to add above the node, and to take away below it, to put its content where CSS would: pdfmake puts all of
   * a line's leading below the text while CSS splits it above and below. Negative values add space below.
   */
  sTop: number;
  sBottom: number;
  left?: number;
  pageBreak?: boolean;
  /**
   * The most the node can take up, for blocks that pdfmake doesn't break across pages (images, rules and code blocks
   * that fit on a page) and for headings, which `keepWithNext` keeps on the same page as such a block after them.
   */
  height?: number;
}

interface Ctx {
  style: TextStyle;
  /** Width available to the block, in points. */
  width: number;
  /** A direct child of the document, where headings are kept with the next block. */
  root: boolean;
  /** In a table or columns, where pdfmake can't break pages. */
  inTable: boolean;
  /** A direct child of a bulleted or numbered list item. */
  inListItem: boolean;
  inTaskList: boolean;
  /** Bulleted (and task) lists and numbered lists around the block. */
  bullets: number;
  numbers: number;
}

const PX = 0.75;
const BASE_SIZE = 11;
const BODY_LINE = 1.3;
const HEADING_LINE = 1.15;
/** `line-height: normal` for Arial. */
const NORMAL_LINE = 1.15;
const HEADING_SIZES = [20, 16, 14, 12, 11, 11];
const PARAGRAPH_AFTER = 6;
const LIST_INDENT = 1.6 * BASE_SIZE;
const LIST_AFTER = 0.6 * BASE_SIZE;
const CODE_SIZE = 0.85 * BASE_SIZE;
const CODE_LINE = 1.55 * CODE_SIZE;
const CODE_PADDING = 0.8 * CODE_SIZE;
/** Inline code is 0.88em. */
const CODE_SCALE = 0.88;
/** pdfmake's size for superscript and subscript text, which it raises or lowers in proportion to that size. */
const SCRIPT_SCALE = 0.58;
/**
 * The size used instead. A browser's (about 0.83em) would look closer, but pdfmake would raise it into the line above.
 */
const SCRIPT_SIZE = 2 / 3;
/** Larger code blocks aren't highlighted, as highlighting them (automatically) is slow. */
const MAX_HIGHLIGHT = 20_000;
/**
 * pdfmake lays out the whole document again for each heading that it moves to the next page, so headings are moved
 * only while the pages laid out in all stay under this.
 */
const RELAYOUT_PAGES = 1000;
const LINE = 0.75;
/** Horizontal padding and border of a table cell. */
const CELL_X = 12 + LINE;
const CHECKBOX = 1.05 * BASE_SIZE;
const TOC_SIZE = 0.95 * BASE_SIZE;

const TEXT = '#202124';
const MUTED = '#5f6368';
const LINK = '#1155cc';
const BORDER = '#dadce0';
const BORDER_STRONG = '#bdc1c6';
const SURFACE_2 = '#f1f4f9';
const SURFACE_3 = '#e7ebf2';
const ACCENT = '#1a73e8';
const ACCENT_SOFT = '#e8f0fe';
const ACCENT_TEXT = '#0b57d0';
const CODE_TEXT = '#24292e';

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);
const BULLET_TYPES = ['disc', 'circle', 'square'];
const NUMBER_TYPES: Record<string, string> = {
  '1': 'decimal',
  a: 'lower-alpha',
  A: 'upper-alpha',
  i: 'lower-roman',
  I: 'upper-roman',
};
/** Formats pdfmake embeds as they are; other images are converted to PNG. */
const PDF_IMAGE_TYPES: Record<string, 'jpeg' | 'png'> = { 'image/jpeg': 'jpeg', 'image/png': 'png' };
/** pdfmake tells formats apart by their first bytes, and fails on anything else. */
const IMAGE_SIGNATURES = [
  [0xff, 0xd8],
  [0x89, 0x50, 0x4e, 0x47],
];
const embeddable = (data: Uint8Array) =>
  IMAGE_SIGNATURES.some((signature) => signature.every((byte, index) => data[index] === byte));

/** Syntax colours (GitHub's light theme), as code blocks are light in the PDF, like in the Word download. */
const CODE_COLORS: Record<string, string> = {};
for (const [color, names] of Object.entries({
  '#d73a49': 'keyword doctag template-tag template-variable type',
  '#6f42c1': 'title',
  '#005cc5': 'attr attribute literal meta number operator variable selector-attr selector-class selector-id section',
  '#032f62': 'regexp string',
  '#e36209': 'built_in symbol',
  '#6a737d': 'comment code formula',
  '#22863a': 'name quote selector-tag selector-pseudo addition',
  '#735c0f': 'bullet',
  '#b31d28': 'deletion',
  '#24292e': 'subst',
})) {
  for (const name of names.split(' ')) CODE_COLORS[name] = color;
}

// ------------------------------------------------------------------ fonts

const FONT_FILES: Record<Family, { normal: string } & Partial<Record<Variant, string>>> = {
  Sans: { normal: arimoRegular, bold: arimoBold, italics: arimoItalic, bolditalics: arimoBoldItalic },
  Serif: { normal: tinosRegular, bold: tinosBold, italics: tinosItalic, bolditalics: tinosBoldItalic },
  Mono: { normal: cousineRegular, bold: cousineBold, italics: cousineItalic, bolditalics: cousineBoldItalic },
  Symbols: { normal: dejaVuSans },
  Emoji: { normal: notoEmoji },
};

/** Height of a line of text (ascender to descender) per point of font size, which pdfmake's line height multiplies. */
const FONT_HEIGHT: Record<Family, number> = {
  Sans: 1.1171875,
  Serif: 1.107421875,
  Mono: 1.1328125,
  Symbols: 1.1640625,
  Emoji: 1.171875,
};

const MONO_FONTS = new Set([
  'courier new',
  'courier',
  'consolas',
  'cascadia code',
  'jetbrains mono',
  'fira code',
  'liberation mono',
  'cousine',
  'lucida console',
  'menlo',
  'monaco',
  'ui-monospace',
  'monospace',
]);
const SERIF_FONTS = new Set([
  'times new roman',
  'times',
  'cambria',
  'georgia',
  'garamond',
  'palatino',
  'liberation serif',
  'tinos',
  'caladea',
  'book antiqua',
  'serif',
]);
const SANS_FONTS = new Set(['arial', 'helvetica', 'arimo', 'liberation sans', 'sans-serif', 'system-ui']);

/** The family that stands in for a CSS font-family list; undefined to keep the inherited one. */
function familyOf(value: unknown): Family | undefined {
  if (typeof value !== 'string') return undefined;
  for (const token of value.split(',')) {
    const name = token
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase();
    if (MONO_FONTS.has(name)) return 'Mono';
    if (SERIF_FONTS.has(name)) return 'Serif';
    if (SANS_FONTS.has(name)) return 'Sans';
  }
  return undefined;
}

const fontFiles = new Map<string, Promise<ArrayBuffer>>();
/** Code points each family has glyphs for. */
const coverages = new Map<Family, Set<number>>();

function fetchFont(url: string): Promise<ArrayBuffer> {
  let request = fontFiles.get(url);
  if (!request) {
    request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .catch((error: unknown) => {
        fontFiles.delete(url);
        throw new Error('Couldn’t download the fonts for the PDF. Check your connection and try again.', {
          cause: error,
        });
      });
    fontFiles.set(url, request);
  }
  return request;
}

async function loadCoverage(family: Family): Promise<void> {
  if (!coverages.has(family)) coverages.set(family, cmapCoverage(await fetchFont(FONT_FILES[family].normal)));
}

/** Code points with a glyph in a TrueType font, read from its cmap table (format 12, or else 4). */
function cmapCoverage(buffer: ArrayBuffer): Set<number> {
  const covered = new Set<number>();
  try {
    const view = new DataView(buffer);
    let cmap = -1;
    for (let i = 0, count = view.getUint16(4); i < count; i++) {
      const record = 12 + i * 16;
      if (view.getUint32(record) === 0x636d6170) cmap = view.getUint32(record + 8);
    }
    if (cmap < 0) return covered;
    let format4 = -1;
    let format12 = -1;
    for (let i = 0, count = view.getUint16(cmap + 2); i < count; i++) {
      const record = cmap + 4 + i * 8;
      const platform = view.getUint16(record);
      const encoding = view.getUint16(record + 2);
      if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue;
      const table = cmap + view.getUint32(record + 4);
      const format = view.getUint16(table);
      if (format === 12) format12 = table;
      else if (format === 4) format4 = table;
    }
    if (format12 >= 0) {
      for (let i = 0, count = view.getUint32(format12 + 12); i < count; i++) {
        const group = format12 + 16 + i * 12;
        const start = view.getUint32(group);
        const end = Math.min(view.getUint32(group + 4), 0x10ffff);
        const glyph = view.getUint32(group + 8);
        for (let code = start; code <= end; code++) if (glyph + code - start) covered.add(code);
      }
    } else if (format4 >= 0) {
      const segments = view.getUint16(format4 + 6) / 2;
      const ends = format4 + 14;
      const starts = ends + segments * 2 + 2;
      const deltas = starts + segments * 2;
      const rangeOffsets = deltas + segments * 2;
      for (let i = 0; i < segments; i++) {
        const start = view.getUint16(starts + i * 2);
        const end = view.getUint16(ends + i * 2);
        const delta = view.getUint16(deltas + i * 2);
        const rangeOffset = view.getUint16(rangeOffsets + i * 2);
        for (let code = start; code <= end && code < 0xffff; code++) {
          let glyph = rangeOffset ? view.getUint16(rangeOffsets + i * 2 + rangeOffset + (code - start) * 2) : code;
          if (glyph) glyph = (glyph + delta) & 0xffff;
          if (glyph) covered.add(code);
        }
      }
    }
  } catch {
    // A damaged table: whatever was read is still usable.
  }
  return covered;
}

/** Fonts for pdfmake: every variant of the families used, loading only the variants used. */
async function fontDictionary(used: Map<Family, Set<Variant>>): Promise<TFontDictionary> {
  const variants: Variant[] = ['normal', 'bold', 'italics', 'bolditalics'];
  const entries = await Promise.all(
    [...used].map(async ([family, needed]) => {
      const files = FONT_FILES[family];
      const loaded = new Map<Variant, ArrayBuffer>();
      await Promise.all(
        [...needed].map(async (variant) => loaded.set(variant, await fetchFont(files[variant] ?? files.normal))),
      );
      const fallback = loaded.get('normal') ?? [...loaded.values()][0]!;
      return [family, Object.fromEntries(variants.map((variant) => [variant, loaded.get(variant) ?? fallback]))];
    }),
  );
  return Object.fromEntries(entries) as TFontDictionary;
}

const variantOf = (bold?: boolean, italics?: boolean): Variant =>
  bold ? (italics ? 'bolditalics' : 'bold') : italics ? 'italics' : 'normal';

// ------------------------------------------------------------------ text

/** Text that the document's fonts always cover. */
const SIMPLE_TEXT = /^[\n\x20-\x7e\u00a0]*$/;
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|\u20E3/u;
const IGNORABLE = /^\p{Default_Ignorable_Code_Point}$/u;
const RTL = /[\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u0008\u000b-\u001f\u007f\u00ad]/g;

const graphemeSegmenter =
  typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

const graphemes = (text: string): string[] =>
  graphemeSegmenter ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment) : Array.from(text);

/** Replaces tabs with spaces up to the next tab stop, counting columns from the last line break. */
function expandTabs(text: string, size: number, position: { column: number }): string {
  let out = '';
  for (const char of text) {
    if (char === '\t') {
      const spaces = size - (position.column % size);
      out += ' '.repeat(spaces);
      position.column += spaces;
    } else {
      out += char;
      position.column = char === '\n' ? 0 : position.column + 1;
    }
  }
  return out;
}

const cssColor = (value: unknown): string | undefined => {
  const hex = hexColor(value);
  return hex ? `#${hex}` : undefined;
};

function cssFontSize(value: unknown, size: number): number | undefined {
  const points = fontSizeInPoints(value);
  if (points) return points;
  const match = /^(\d*\.?\d+)\s*(em|rem|%)$/i.exec(String(value ?? '').trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  const result = unit === '%' ? (amount / 100) * size : unit === 'rem' ? amount * 12 : amount * size;
  return result > 0 ? result : undefined;
}

function lineSpec(value: unknown, size: number): LineSpec | undefined {
  const text = String(value ?? '')
    .trim()
    .toLowerCase();
  if (text === 'normal') return { factor: NORMAL_LINE };
  const match = /^(\d*\.?\d+)\s*(pt|px|em|rem|%)?$/.exec(text);
  const amount = Number(match?.[1]);
  if (!match || !(amount > 0)) return undefined;
  switch (match[2]) {
    case 'pt':
      return { points: amount };
    case 'px':
      return { points: amount * PX };
    case 'em':
      return { points: amount * size };
    case 'rem':
      return { points: amount * 12 };
    case '%':
      return { points: (amount / 100) * size };
    default:
      return { factor: amount };
  }
}

const lineHeightOf = (spec: LineSpec, size: number) => ('points' in spec ? spec.points : spec.factor * size);

/** Arial's (and Arimo's) advance widths in em, to work out how much room list markers take. */
const LOWER_WIDTHS = [
  0.556, 0.556, 0.5, 0.556, 0.556, 0.278, 0.556, 0.556, 0.222, 0.222, 0.5, 0.222, 0.833, 0.556, 0.556, 0.556, 0.556,
  0.333, 0.5, 0.278, 0.556, 0.5, 0.722, 0.5, 0.5, 0.5,
];
const UPPER_WIDTHS = [
  0.667, 0.667, 0.722, 0.722, 0.667, 0.611, 0.778, 0.722, 0.278, 0.5, 0.667, 0.556, 0.833, 0.722, 0.778, 0.667, 0.778,
  0.722, 0.667, 0.611, 0.722, 0.667, 0.944, 0.667, 0.667, 0.611,
];

function markerWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122) width += LOWER_WIDTHS[code - 97]!;
    else if (code >= 65 && code <= 90) width += UPPER_WIDTHS[code - 65]!;
    else width += char === '.' || char === ' ' ? 0.278 : 0.556;
  }
  return width * BASE_SIZE;
}

/** pdfmake's least room for list markers. */
const LIST_GAP = markerWidth('9. ');

function alphabetic(value: number): string {
  let out = '';
  for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    out = String.fromCharCode(97 + ((rest - 1) % 26)) + out;
  }
  return out;
}

const ROMAN: [number, string][] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

function roman(value: number): string {
  if (value <= 0 || value >= 4000) return String(value);
  let out = '';
  let rest = value;
  for (const [amount, numeral] of ROMAN) {
    for (; rest >= amount; rest -= amount) out += numeral;
  }
  return out;
}

function counter(value: number, type: string): string {
  switch (type) {
    case 'lower-alpha':
      return alphabetic(value);
    case 'upper-alpha':
      return alphabetic(value).toUpperCase();
    case 'lower-roman':
      return roman(value);
    case 'upper-roman':
      return roman(value).toUpperCase();
    default:
      return String(value);
  }
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const headingId = (index: number) => `heading-${index + 1}`;
const clean = (text: string) => text.replace(UNPRINTABLE, '');

/**
 * About the most lines that a text node's runs can wrap onto: each character is counted as 1em wide, which is more
 * than nearly all are, to make up for the space left at the ends of lines.
 */
function maxLines(text: unknown, width: number): number {
  let lines = 1;
  let x = 0;
  for (const run of Array.isArray(text) ? (text as Run[]) : []) {
    run.text.split('\n').forEach((part, index) => {
      if (index) {
        lines += 1;
        x = 0;
      }
      x += part.length * run.fontSize;
      lines += Math.floor(x / Math.max(1, width));
      x %= Math.max(1, width);
    });
  }
  return lines;
}

// ------------------------------------------------------------------ layout

/** One-cell tables draw boxes: quotes, code blocks, tables of contents and collapsible sections. */
function boxLayout(box: {
  border?: number;
  color?: string;
  fill?: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}): PdfNode {
  const border = box.border ?? 0;
  return {
    hLineWidth: () => border,
    vLineWidth: () => border,
    hLineColor: () => box.color,
    vLineColor: () => box.color,
    fillColor: box.fill ? () => box.fill : undefined,
    paddingLeft: () => box.left,
    paddingRight: () => box.right,
    paddingTop: () => box.top,
    paddingBottom: () => box.bottom,
  };
}

const TABLE_LAYOUT: PdfNode = {
  hLineWidth: () => LINE,
  vLineWidth: () => LINE,
  hLineColor: () => BORDER_STRONG,
  vLineColor: () => BORDER_STRONG,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 3,
  paddingBottom: () => 3,
};

const QUOTE_LAYOUT: PdfNode = {
  hLineWidth: () => 0,
  vLineWidth: (index: number) => (index === 0 ? 3 * PX : 0),
  vLineColor: () => BORDER_STRONG,
  paddingLeft: () => BASE_SIZE,
  paddingRight: () => 0,
  paddingTop: () => 0.1 * BASE_SIZE,
  paddingBottom: () => 0.1 * BASE_SIZE,
};

/**
 * Turns the CSS margins of consecutive blocks into pdfmake margins, which don't collapse. Most of the space between
 * two blocks goes below the first, so that it disappears at the end of a page as it does in a browser.
 *
 * `root` is the document, whose first child's top margin is dropped. In `collapse` mode the first and last children's
 * margins collapse through the container (see `collapse`); in `box` mode the container's padding or border keeps
 * them inside.
 */
function join(blocks: Block[], mode: 'root' | 'collapse' | 'box'): PdfNode[] {
  const list = [...blocks];
  if (mode === 'root') while (list[list.length - 1]?.pageBreak) list.pop();
  const tops = list.map(() => 0);
  const bottoms = list.map(() => 0);
  list.forEach((block, index) => {
    const previous = list[index - 1];
    if (!previous) {
      if (mode === 'root') tops[index] = Math.max(0, block.sTop);
      else if (mode === 'box') tops[index] = Math.max(0, block.top + block.sTop);
    } else if (block.pageBreak) {
      bottoms[index - 1] = 0;
    } else if (previous.pageBreak) {
      // Margins after a forced page break are kept.
      tops[index] = Math.max(0, block.top + block.sTop);
    } else {
      const collapsed = Math.max(previous.bottom, block.top);
      const total = Math.max(0, collapsed + block.sTop - previous.sBottom);
      bottoms[index - 1] = Math.min(total, Math.max(0, collapsed - previous.sBottom));
      tops[index] = total - bottoms[index - 1]!;
    }
  });
  const last = list[list.length - 1];
  if (last && mode === 'box') bottoms[list.length - 1] = Math.max(0, last.bottom - last.sBottom);
  return list.map((block, index) => {
    block.node.margin = [block.left ?? 0, tops[index], 0, bottoms[index]];
    return block.node;
  });
}

/** A container without padding or borders (a list or list item), whose children's margins collapse through it. */
function collapse(children: Block[], node: (content: PdfNode[]) => PdfNode, own = { top: 0, bottom: 0 }): Block {
  const first = children[0];
  const last = children[children.length - 1];
  return {
    node: node(join(children, 'collapse')),
    top: Math.max(own.top, first?.top ?? 0),
    bottom: Math.max(own.bottom, last?.bottom ?? 0),
    innerBottom: last?.bottom ?? 0,
    sTop: first?.sTop ?? 0,
    sBottom: last?.sBottom ?? 0,
  };
}

/** Space inside a box, which doesn't collapse with the margins of its content. */
const box = (node: PdfNode, bottom: number): Block => ({ node, top: 0, bottom, sTop: 0, sBottom: 0 });

/**
 * Keeps headings on the same page as an image, rule or code block right after them, by making them one unbreakable
 * block if that fits on a page. (`pageBreakBefore` keeps other headings with what follows them, but each heading that
 * it moves makes pdfmake lay out the whole document again.) `nodes` are the `blocks` joined at the root.
 */
function keepWithNext(blocks: Block[], nodes: PdfNode[], pageHeight: number): PdfNode[] {
  const result: PdfNode[] = [];
  let start = 0;
  while (start < nodes.length) {
    let end = start;
    while (end < nodes.length && nodes[end]!.headlineLevel) end += 1;
    // Headings from `start` and, at `end`, what comes after them.
    const group = nodes.slice(start, end + 1);
    if (end > start && end < nodes.length && blocks[end]!.height !== undefined) {
      const margins = group.map((node) => node.margin as [number, number, number, number]);
      // The first block's top margin and the last one's bottom margin go outside the group.
      const height = sum(
        group.map((_, index) => {
          const [, top, , bottom] = margins[index]!;
          return blocks[start + index]!.height! + (index > 0 ? top : 0) + (index < group.length - 1 ? bottom : 0);
        }),
      );
      if (height <= pageHeight) {
        const first = margins[0]!;
        const last = margins[group.length - 1]!;
        group[0]!.margin = [first[0], 0, first[2], first[3]];
        group[group.length - 1]!.margin = [last[0], last[1], last[2], 0];
        result.push({ stack: group, unbreakable: true, margin: [0, first[1], 0, last[3]] });
        start = end + 1;
        continue;
      }
    }
    const next = Math.max(end, start + 1);
    result.push(...nodes.slice(start, next));
    start = next;
  }
  return result;
}

function checkbox(checked: boolean): PdfNode[] {
  const y = (1.5 * BASE_SIZE - CHECKBOX) / 2;
  if (!checked) {
    return [
      {
        type: 'rect',
        x: LINE / 2,
        y: y + LINE / 2,
        w: CHECKBOX - LINE,
        h: CHECKBOX - LINE,
        r: 1.5,
        lineWidth: LINE,
        lineColor: '#767676',
        color: '#ffffff',
      },
    ];
  }
  const at = (x: number, top: number) => ({ x: x * CHECKBOX, y: y + top * CHECKBOX });
  return [
    { type: 'rect', x: 0, y, w: CHECKBOX, h: CHECKBOX, r: 1.5, color: ACCENT },
    {
      type: 'polyline',
      points: [at(0.22, 0.52), at(0.42, 0.72), at(0.78, 0.3)],
      lineWidth: 1.5,
      lineColor: '#ffffff',
      lineCap: 'round',
      lineJoin: 'round',
    },
  ];
}

interface HastNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

class Converter {
  /** Text nodes, whose runs get their fonts and line heights once the fonts are known. */
  readonly texts: PdfNode[] = [];
  readonly images: Record<string, Uint8Array> = {};
  readonly used = new Map<Family, Set<Variant>>([['Sans', new Set<Variant>(['normal'])]]);
  private readonly imageKeys = new Map<string, string>();
  private readonly outline: { level: number; id: string }[] = [];

  constructor(
    private readonly loaded: Map<string, LoadedImage<'jpeg' | 'png'>>,
    private readonly headings: Headings,
    /** Height of a page's content area, in points. */
    private readonly pageHeight: number,
  ) {}

  use(family: Family, variant: Variant): void {
    let variants = this.used.get(family);
    if (!variants) this.used.set(family, (variants = new Set()));
    variants.add(variant);
  }

  blocks(nodes: JSONContent[] | undefined, ctx: Ctx): Block[] {
    return (nodes ?? []).flatMap((node) => this.block(node, ctx));
  }

  private inner(ctx: Ctx, changes: Partial<Ctx>): Ctx {
    return { ...ctx, root: false, inListItem: false, ...changes };
  }

  private block(node: JSONContent, ctx: Ctx): Block[] {
    switch (node.type) {
      case 'paragraph':
        return [this.textBlock(node, ctx.style, BASE_SIZE, BODY_LINE, 0, PARAGRAPH_AFTER)];
      case 'heading':
        return [this.heading(node, ctx)];
      case 'bulletList':
      case 'orderedList':
        return [this.list(node, ctx)];
      case 'taskList':
        return [this.taskList(node, ctx)];
      case 'blockquote':
        return [this.blockquote(node, ctx)];
      case 'codeBlock':
        return [this.codeBlock(node, ctx)];
      case 'horizontalRule': {
        // A 1px top border, 2px padding above and below and a 1.2em margin.
        const y = LINE / 2;
        const line = { type: 'line', x1: 0, y1: y, x2: ctx.width, y2: y, lineWidth: LINE, lineColor: BORDER_STRONG };
        return [
          {
            node: { canvas: [line] },
            top: 1.2 * BASE_SIZE,
            bottom: 1.2 * BASE_SIZE,
            sTop: 0,
            sBottom: -(LINE / 2 + 4 * PX),
            height: LINE,
          },
        ];
      }
      case 'pageBreak':
        if (ctx.inTable) return [];
        return [{ node: { canvas: [], pageBreak: 'after' }, top: 0, bottom: 0, sTop: 0, sBottom: 0, pageBreak: true }];
      case 'image':
        return [this.image(node, ctx)];
      case 'table':
        return this.table(node, ctx);
      case 'tableOfContents':
        return this.tableOfContents(ctx);
      case 'details':
        return [this.details(node, ctx)];
      default:
        return this.blocks(node.content, ctx);
    }
  }

  private heading(node: JSONContent, ctx: Ctx): Block {
    const level = Math.min(6, Math.max(1, Math.floor(Number(node.attrs?.level)) || 1));
    const style: TextStyle = { ...ctx.style, bold: level < 6, italics: level === 6 || ctx.style.italics };
    const { lineHeight, ...block } = this.textBlock(
      node,
      style,
      HEADING_SIZES[level - 1]!,
      HEADING_LINE,
      level <= 2 ? 18 : 12,
      4,
    );
    const index = this.headings.index.get(node);
    if (index !== undefined) {
      // A destination for the table of contents' links and an entry in the PDF's bookmarks.
      const id = headingId(index);
      while (this.outline.length && this.outline[this.outline.length - 1]!.level >= level) this.outline.pop();
      const parent = this.outline[this.outline.length - 1];
      const { text } = this.headings.list[index]!;
      Object.assign(block.node, { id, outline: true, outlineText: text, outlineExpanded: true });
      if (parent) block.node.outlineParentId = parent.id;
      this.outline.push({ level, id });
    }
    if (ctx.root) {
      block.node.headlineLevel = level;
      block.height = lineHeight * maxLines(block.node.text, ctx.width - (block.left ?? 0));
    }
    return block;
  }

  /** A paragraph or heading, and the height of its tallest line. */
  private textBlock(
    node: JSONContent,
    style: TextStyle,
    size: number,
    factor: number,
    top: number,
    bottom: number,
  ): Block & { lineHeight: number } {
    const attrs = node.attrs ?? {};
    const spec = lineSpec(attrs.lineHeight, size) ?? { factor };
    const { runs, size: largest, family } = this.runs(node.content, style, size, spec);
    const lineHeight = lineHeightOf(spec, largest);
    let pdf: PdfNode;
    if (runs.length) {
      pdf = { text: runs, preserveLeadingSpaces: true };
      this.texts.push(pdf);
    } else {
      pdf = {
        text: '',
        font: style.font,
        fontSize: size,
        bold: !!style.bold,
        italics: !!style.italics,
        lineHeight: lineHeight / (FONT_HEIGHT[style.font] * size),
      };
      this.use(style.font, variantOf(style.bold, style.italics));
    }
    if (ALIGNMENTS.has(String(attrs.textAlign))) pdf.alignment = attrs.textAlign;
    const indent = Math.min(MAX_INDENT, Math.max(0, Math.floor(Number(attrs.indent) || 0)));
    const halfLeading = (lineHeight - FONT_HEIGHT[family] * largest) / 2;
    const left = indent * INDENT_STEP_IN * 72;
    return { node: pdf, top, bottom, sTop: halfLeading, sBottom: halfLeading, left, lineHeight };
  }

  /** The runs of a paragraph, and the size and family of its largest text, which sets the first line's leading. */
  private runs(
    content: JSONContent[] | undefined,
    style: TextStyle,
    size: number,
    spec: LineSpec,
  ): { runs: Run[]; size: number; family: Family } {
    const runs: Run[] = [];
    let largest = size;
    let family = style.font;
    const position = { column: 0 };
    const nodes = content ?? [];
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        const last = runs[runs.length - 1];
        if (last) last.text += '\n';
        else runs.push(this.run('\n', undefined, style, size, spec));
        position.column = 0;
        continue;
      }
      const mention = node.type === 'mention';
      const text = mention
        ? `@${node.attrs?.label ?? node.attrs?.id ?? ''}`.replace(/ /g, '\u00a0')
        : expandTabs(clean(plainText(node)), 8, position);
      if (!text) continue;
      const run = this.run(text, node.marks, style, size, spec);
      if (mention) {
        run.color = ACCENT_TEXT;
        run.background = ACCENT_SOFT;
      }
      if (!run.sup && !run.sub && run.fontSize > largest) {
        largest = run.fontSize;
        family = run.font;
      }
      runs.push(run);
    }
    if (nodes[nodes.length - 1]?.type === 'hardBreak') {
      // Like a browser, show the empty line after a trailing line break.
      runs.push({ ...this.run('\u200b', undefined, style, size, spec), font: 'Sans', fixed: true });
    }
    return { runs, size: largest, family };
  }

  private run(text: string, marks: JSONContent['marks'], style: TextStyle, size: number, spec: LineSpec): Run {
    const run: Run = {
      text,
      font: style.font,
      fontSize: size,
      lineHeight: 0,
      color: style.color,
      bold: style.bold,
      italics: style.italics,
      decoration: style.decoration,
      decorationColor: style.decorationColor,
    };
    const decorate = (decoration: Decoration) => {
      run.decoration = [...(run.decoration ?? []).filter((item) => item !== decoration), decoration];
    };
    let fontSize = size;
    let code = false;
    let link = false;
    let textColor: string | undefined;
    let highlight: string | undefined;
    let background: string | undefined;
    for (const mark of marks ?? []) {
      const attrs = mark.attrs ?? {};
      switch (mark.type) {
        case 'bold':
          run.bold = true;
          break;
        case 'italic':
          run.italics = true;
          break;
        case 'underline':
          decorate('underline');
          break;
        case 'strike':
          decorate('lineThrough');
          break;
        case 'code':
          code = true;
          break;
        case 'subscript':
          run.sub = true;
          break;
        case 'superscript':
          run.sup = true;
          break;
        case 'highlight':
          highlight = cssColor(attrs.color) ?? '#ffff00';
          break;
        case 'link':
          link = true;
          run.link = safeLink(attrs.href) ?? undefined;
          break;
        case 'textStyle':
          textColor = cssColor(attrs.color) ?? textColor;
          background = cssColor(attrs.backgroundColor) ?? background;
          fontSize = cssFontSize(attrs.fontSize, size) ?? fontSize;
          run.font = familyOf(attrs.fontFamily) ?? run.font;
          break;
      }
    }
    if (link) {
      run.color = LINK;
      decorate('underline');
      run.decorationColor = LINK;
    }
    if (textColor) run.color = textColor;
    run.background = highlight ?? background;
    if (code) {
      run.font = 'Mono';
      run.background = SURFACE_3;
      fontSize *= CODE_SCALE;
    }
    if (run.sup && run.sub) run.sub = false;
    const script = run.sup || run.sub;
    const visible = Math.min(400, Math.max(1, script ? fontSize * SCRIPT_SIZE : fontSize));
    run.fontSize = script ? visible / SCRIPT_SCALE : visible;
    run.lineHeight = 'points' in spec ? spec.points : spec.factor * Math.max(visible, size);
    return run;
  }

  private list(node: JSONContent, ctx: Ctx): Block {
    const ordered = node.type === 'orderedList';
    const items = node.content ?? [];
    const list: PdfNode = { font: 'Sans', fontSize: BASE_SIZE, color: ctx.style.color, markerColor: ctx.style.color };
    let gap = LIST_GAP;
    if (ordered) {
      // Like the editor's styles: the list's own type at the top level, then letters and roman numerals.
      const type =
        ctx.numbers === 0
          ? (NUMBER_TYPES[String(node.attrs?.type)] ?? 'decimal')
          : ctx.numbers === 1
            ? 'lower-alpha'
            : 'lower-roman';
      const start = Math.floor(Number(node.attrs?.start ?? 1));
      const first = Number.isFinite(start) ? start : 1;
      Object.assign(list, { type, start: first });
      items.forEach((_, index) => (gap = Math.max(gap, markerWidth(`${counter(first + index, type)}. `))));
    } else {
      list.type = BULLET_TYPES[Math.min(2, ctx.bullets)];
    }
    // Item content starts 1.6em in, unless the markers need more room.
    const indent = Math.max(LIST_INDENT, gap);
    const inner = this.inner(ctx, {
      width: ctx.width - indent,
      inListItem: true,
      bullets: ctx.bullets + (ordered ? 0 : 1),
      numbers: ctx.numbers + (ordered ? 1 : 0),
    });
    const blocks = items.map((item) => collapse(this.blocks(item.content, inner), (stack) => ({ stack })));
    const block = collapse(blocks, (content) => Object.assign(list, { [ordered ? 'ol' : 'ul']: content }), {
      top: 0,
      bottom: ctx.inListItem ? 0 : LIST_AFTER,
    });
    block.left = indent - gap;
    return block;
  }

  private taskList(node: JSONContent, ctx: Ctx): Block {
    const left = 0.2 * BASE_SIZE;
    const gap = 0.5 * BASE_SIZE;
    const items = (node.content ?? []).map((item) => {
      const checked = !!item.attrs?.checked;
      const style: TextStyle = checked
        ? {
            ...ctx.style,
            color: MUTED,
            decoration: [...(ctx.style.decoration ?? []), 'lineThrough'],
            decorationColor: MUTED,
          }
        : ctx.style;
      const inner = this.inner(ctx, {
        style,
        width: ctx.width - left - CHECKBOX - gap,
        inTable: true,
        inTaskList: true,
        bullets: ctx.bullets + 1,
      });
      // Each item is a flex box, which keeps its content's margins inside.
      return box(
        {
          columns: [
            { width: CHECKBOX, canvas: checkbox(checked) },
            { width: '*', stack: join(this.blocks(item.content, inner), 'box') },
          ],
          columnGap: gap,
        },
        0,
      );
    });
    const nested = ctx.inTaskList || ctx.inListItem;
    const block = collapse(items, (stack) => ({ stack }), { top: 0, bottom: nested ? 0 : LIST_AFTER });
    block.left = left;
    return block;
  }

  private blockquote(node: JSONContent, ctx: Ctx): Block {
    const inner = this.inner(ctx, {
      style: { ...ctx.style, color: MUTED },
      width: ctx.width - 3 * PX - BASE_SIZE,
      inTable: true,
    });
    const body = [[{ stack: join(this.blocks(node.content, inner), 'box') }]];
    return box({ table: { widths: ['*'], body }, layout: QUOTE_LAYOUT }, LIST_AFTER);
  }

  private codeBlock(node: JSONContent, ctx: Ctx): Block {
    const code = expandTabs(clean(plainText(node)), 2, { column: 0 });
    const runs: Run[] = [];
    const push = (text: string, color: string, italics: boolean, bold: boolean) => {
      if (!text) return;
      const last = runs[runs.length - 1];
      if (last && last.color === color && !!last.italics === italics && !!last.bold === bold) last.text += text;
      else runs.push({ text, font: 'Mono', fontSize: CODE_SIZE, lineHeight: CODE_LINE, color, italics, bold });
    };
    const walk = (hast: HastNode, color: string, italics: boolean, bold: boolean) => {
      if (hast.type === 'text') return push(hast.value ?? '', color, italics, bold);
      const classes = Array.isArray(hast.properties?.className) ? hast.properties.className : [];
      for (const name of classes.map((value) => String(value).replace(/^hljs-/, ''))) {
        color = CODE_COLORS[name] ?? color;
        italics ||= name === 'comment' || name === 'emphasis';
        bold ||= name === 'strong';
      }
      hast.children?.forEach((child) => walk(child, color, italics, bold));
    };
    let tree: HastNode | null = null;
    if (code.length <= MAX_HIGHLIGHT) {
      try {
        // Like the editor: the block's language if known, else whichever fits best.
        const language = String(node.attrs?.language ?? '');
        tree = (
          language && lowlight.registered(language) ? lowlight.highlight(language, code) : lowlight.highlightAuto(code)
        ) as unknown as HastNode;
      } catch {
        tree = null;
      }
    }
    if (tree) walk(tree, CODE_TEXT, false, false);
    else push(code, CODE_TEXT, false, false);
    // Keep an empty last line (and an empty block's only line).
    if (!code || code.endsWith('\n')) push(' ', CODE_TEXT, false, false);
    const text: PdfNode = { text: runs, preserveLeadingSpaces: true };
    this.texts.push(text);

    const halfLeading = (CODE_LINE - FONT_HEIGHT.Mono * CODE_SIZE) / 2;
    const layout = boxLayout({
      border: LINE,
      color: '#e1e4e8',
      fill: '#f6f8fa',
      left: BASE_SIZE * 0.85,
      right: BASE_SIZE * 0.85,
      top: CODE_PADDING + halfLeading,
      bottom: CODE_PADDING - halfLeading,
    });
    const table: PdfNode = { table: { widths: ['*'], body: [[text]] }, layout };
    // Like the editor's print styles, avoid breaking code blocks across pages, if they fit on one.
    const perLine = Math.max(1, Math.floor((ctx.width - 2 * LINE - 1.7 * BASE_SIZE) / (0.6 * CODE_SIZE)));
    const lines = sum(code.split('\n').map((line) => Math.max(1, Math.ceil(line.length / perLine))));
    const height = lines * CODE_LINE + 2 * (CODE_PADDING + LINE);
    if (ctx.inTable || height > this.pageHeight) return box(table, CODE_PADDING);
    table.unbreakable = true;
    return { ...box(table, CODE_PADDING), height };
  }

  private image(node: JSONContent, ctx: Ctx): Block {
    const src = String(node.attrs?.src ?? '');
    const alt = clean(String(node.attrs?.alt ?? ''));
    const image = this.loaded.get(src);
    if (!image || !embeddable(image.data)) {
      // Images from other sites can't be downloaded here; link to them instead.
      const style: TextStyle = { ...ctx.style, color: LINK, decoration: ['underline'], decorationColor: LINK };
      const spec = { factor: BODY_LINE };
      const label = this.run(alt ? `[Image: ${alt}]` : '[Image]', undefined, style, BASE_SIZE, spec);
      label.link = safeLink(src) ?? undefined;
      const text: PdfNode = { text: [label] };
      this.texts.push(text);
      const halfLeading = (BODY_LINE * BASE_SIZE - FONT_HEIGHT[style.font] * BASE_SIZE) / 2;
      return { node: text, top: 0, bottom: PARAGRAPH_AFTER, sTop: halfLeading, sBottom: halfLeading };
    }
    let key = this.imageKeys.get(src);
    if (!key) {
      key = `image-${this.imageKeys.size + 1}`;
      this.imageKeys.set(src, key);
      this.images[key] = image.data;
    }
    // The image keeps its aspect ratio (height: auto) and fits the column and the page.
    const aspect = image.height / image.width;
    const attrWidth = Number(node.attrs?.width);
    const attrHeight = Number(node.attrs?.height);
    let width = (attrWidth > 0 ? attrWidth : attrHeight > 0 ? attrHeight / aspect : image.width) * PX;
    width = Math.min(width, ctx.width);
    let height = width * aspect;
    if (height > this.pageHeight) {
      height = this.pageHeight;
      width = height / aspect;
    }
    return { ...box({ image: key, width, height }, LIST_AFTER), height };
  }

  private table(node: JSONContent, ctx: Ctx): Block[] {
    const rows = (node.content ?? []).filter((row) => row.type === 'tableRow');
    if (!rows.length) return [];
    const span = (cell: JSONContent, key: string) => Math.max(1, Math.floor(Number(cell.attrs?.[key])) || 1);

    // Place the cells on a grid, around cells spanning rows from above.
    const taken: boolean[][] = rows.map(() => []);
    const cells: { cell: JSONContent; row: number; column: number; colspan: number; rowspan: number }[] = [];
    rows.forEach((row, rowIndex) => {
      let column = 0;
      for (const cell of row.content ?? []) {
        while (taken[rowIndex]![column]) column += 1;
        const colspan = span(cell, 'colspan');
        const rowspan = Math.min(span(cell, 'rowspan'), rows.length - rowIndex);
        for (let r = rowIndex; r < rowIndex + rowspan; r++) {
          for (let c = column; c < column + colspan; c++) taken[r]![c] = true;
        }
        cells.push({ cell, row: rowIndex, column, colspan, rowspan });
        column += colspan;
      }
    });
    const columnCount = Math.max(1, ...taken.map((row) => row.length));

    // Resized columns keep their widths; the others share the remaining space.
    const fixed = new Array<number>(columnCount).fill(0);
    for (const { cell, column, colspan } of cells.filter((placed) => placed.row === 0)) {
      const widths: unknown[] = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];
      for (let i = 0; i < colspan && column + i < columnCount; i++) {
        fixed[column + i] = Math.max(0, Number(widths[i]) || 0) * PX;
      }
    }
    const free = fixed.filter((width) => !width).length;
    const each = free ? Math.max((ctx.width - sum(fixed)) / free, 36) : 0;
    let widths = fixed.map((width) => width || each);
    const total = sum(widths);
    if (total > ctx.width) widths = widths.map((width) => (width * ctx.width) / total);
    // pdfmake's widths leave out the cells' padding and borders.
    const inner = widths.map((width) => Math.max(1, width - CELL_X - LINE / columnCount));

    const body: PdfNode[][] = rows.map(() => Array.from({ length: columnCount }, (): PdfNode => ({ text: '' })));
    for (const { cell, row, column, colspan, rowspan } of cells) {
      for (let r = row; r < row + rowspan; r++) {
        for (let c = column; c < column + colspan; c++) body[r]![c] = {};
      }
      const header = cell.type === 'tableHeader';
      const content = this.blocks(
        cell.content,
        this.inner(ctx, {
          style: header ? { ...ctx.style, bold: true } : ctx.style,
          width: sum(inner.slice(column, column + colspan)) + (colspan - 1) * CELL_X,
          inTable: true,
        }),
      );
      const pdf: PdfNode = { stack: join(content, 'box') };
      if (colspan > 1) pdf.colSpan = colspan;
      if (rowspan > 1) pdf.rowSpan = rowspan;
      if (header) pdf.fillColor = SURFACE_2;
      body[row]![column] = pdf;
    }

    // Rows of header cells at the top repeat on each page, unless a cell spans rows below them.
    let headerRows = 0;
    while (
      headerRows < rows.length - 1 &&
      rows[headerRows]!.content?.length &&
      rows[headerRows]!.content!.every((cell) => cell.type === 'tableHeader')
    ) {
      headerRows += 1;
    }
    if (cells.some(({ row, rowspan }) => row < headerRows && row + rowspan > headerRows)) headerRows = 0;

    const table: PdfNode = { widths: inner, body };
    if (headerRows) table.headerRows = headerRows;
    return [box({ table, layout: TABLE_LAYOUT }, 0.8 * BASE_SIZE)];
  }

  private tableOfContents(ctx: Ctx): Block[] {
    const { list } = this.headings;
    if (!list.length) return [];
    const textBlock = (runs: Run[], size: number, padding: number, extra: PdfNode = {}): Block => {
      const pdf: PdfNode = { text: runs, ...extra };
      this.texts.push(pdf);
      const halfLeading = (BODY_LINE * size - FONT_HEIGHT.Sans * size) / 2;
      return { node: pdf, top: 0, bottom: 0, sTop: halfLeading + padding, sBottom: halfLeading - padding };
    };
    const plain = (text: string, size: number, extra: Partial<Run> = {}): Run => ({
      text,
      font: 'Sans',
      fontSize: size,
      lineHeight: BODY_LINE * size,
      color: ctx.style.color,
      ...extra,
    });

    const title = textBlock([plain('Table of contents', TOC_SIZE, { bold: true })], TOC_SIZE, 0);
    title.bottom = 6 * PX;
    const entries = list.map((heading, index): Block => {
      const level = Math.min(6, Math.max(1, heading.level));
      const size = level >= 4 ? 0.95 * TOC_SIZE : TOC_SIZE;
      const id = headingId(index);
      const label: PdfNode = {
        width: '*',
        text: [plain(clean(heading.text.replace(/\t/g, ' ')), size, { color: ACCENT_TEXT, linkToDestination: id })],
      };
      const page: PdfNode = {
        width: 'auto',
        alignment: 'right',
        text: [plain('00', size, { color: MUTED, pageReference: id, fixed: true })],
      };
      this.texts.push(label, page);
      const halfLeading = (BODY_LINE * size - FONT_HEIGHT.Sans * size) / 2;
      return {
        node: { columns: [label, page], columnGap: 12 },
        top: 0,
        bottom: 0,
        sTop: halfLeading + PX,
        sBottom: halfLeading - PX,
        left: [0, 0, 1.2, 2.4, 3.6, 3.6, 3.6][level]! * size,
      };
    });
    const layout = boxLayout({ border: LINE, color: BORDER, fill: SURFACE_2, left: 12, right: 12, top: 7.5, bottom: 9 });
    const body = [[{ stack: join([title, ...entries], 'box') }]];
    return [box({ table: { widths: ['*'], body }, layout }, TOC_SIZE)];
  }

  private details(node: JSONContent, ctx: Ctx): Block {
    const summary = node.content?.find((child) => child.type === 'detailsSummary');
    const content = node.content?.find((child) => child.type === 'detailsContent');
    const button = 18;
    const gap = 3;
    const padding = { left: 3.6, right: 7.2, top: 4.8, bottom: 4.8 };
    const inner = this.inner(ctx, {
      width: ctx.width - 2 * LINE - padding.left - padding.right - button - gap,
      inTable: true,
    });
    const blocks = this.blocks(content?.content, inner);
    // The content's last block has a 0.2em bottom margin, though its own children's margins may collapse through it.
    const last = blocks[blocks.length - 1];
    if (last) last.bottom = Math.max(0.2 * BASE_SIZE, last.innerBottom ?? 0);
    if (summary) blocks.unshift(this.textBlock(summary, { ...ctx.style, bold: true }, BASE_SIZE, BODY_LINE, 0, 0));
    // An open disclosure triangle, as the content is always shown.
    const triangle = {
      type: 'polyline',
      points: [
        { x: 6.3, y: 7.25 },
        { x: 11.7, y: 7.25 },
        { x: 9, y: 11.95 },
      ],
      closePath: true,
      color: MUTED,
    };
    const cell = {
      columns: [
        { width: button, canvas: [triangle] },
        { width: '*', stack: join(blocks, 'box') },
      ],
      columnGap: gap,
    };
    const layout = boxLayout({ border: LINE, color: BORDER, ...padding });
    return box({ table: { widths: ['*'], body: [[cell]] }, layout }, 0.8 * BASE_SIZE);
  }
}

// ------------------------------------------------------------------ font fallback

/**
 * Gives every run its fonts: text the run's font lacks (symbols, emoji) is split off into the fallback fonts that have
 * it, loading them only when needed. Also sets pdfmake's line heights, which depend on the font.
 */
async function applyFonts(texts: PdfNode[], use: (family: Family, variant: Variant) => void): Promise<string | null> {
  type Choice = Family | 'inherit' | null;
  const clusters = new Map<Run, string[]>();
  const pending = new Map<string, { primary: Family; emoji: boolean; required: number[] }>();
  let rtl = false;
  for (const node of texts) {
    for (const run of node.text as Run[]) {
      if (run.fixed || SIMPLE_TEXT.test(run.text)) continue;
      rtl ||= RTL.test(run.text);
      const parts = graphemes(run.text);
      clusters.set(run, parts);
      for (const cluster of parts) {
        const key = `${run.font}:${cluster}`;
        if (SIMPLE_TEXT.test(cluster) || pending.has(key)) continue;
        const required = Array.from(cluster)
          .filter((char) => char !== '\n' && !IGNORABLE.test(char))
          .map((char) => char.codePointAt(0)!);
        pending.set(key, { primary: run.font, emoji: EMOJI.test(cluster), required });
      }
    }
  }

  // Each round loads the fonts that the remaining clusters need checked next.
  const choices = new Map<string, Choice>();
  let open = [...pending.keys()];
  while (open.length) {
    const missing = new Set<Family>();
    open = open.filter((key) => {
      const { primary, emoji, required } = pending.get(key)!;
      if (!required.length) {
        // Invisible characters join the text before them, whose font decides whether to keep them.
        if (!coverages.has(primary)) {
          missing.add(primary);
          return true;
        }
        choices.set(key, 'inherit');
        return false;
      }
      const order: Family[] = emoji ? ['Emoji', 'Symbols', primary] : [primary, 'Symbols', 'Emoji'];
      for (const family of order) {
        const coverage = coverages.get(family);
        if (!coverage) {
          missing.add(family);
          return true;
        }
        if (required.every((code) => coverage.has(code))) {
          choices.set(key, family);
          return false;
        }
      }
      choices.set(key, null);
      return false;
    });
    await Promise.all([...missing].map(loadCoverage));
  }

  const unsupported = new Set<string>();
  const finish = (run: Run, family: Family, text: string): PdfNode => {
    use(family, variantOf(run.bold, run.italics));
    const scale = run.sup || run.sub ? SCRIPT_SCALE : 1;
    const inline: PdfNode = {
      text,
      font: family,
      fontSize: run.fontSize,
      lineHeight: run.lineHeight / (FONT_HEIGHT[family] * run.fontSize * scale),
      bold: run.bold,
      italics: run.italics,
      color: run.color,
      background: run.background,
      decoration: run.decoration?.length ? run.decoration : undefined,
      decorationColor: run.decorationColor,
      link: run.link,
      linkToDestination: run.linkToDestination,
      sup: run.sup,
      sub: run.sub,
      pageReference: run.pageReference,
    };
    return Object.fromEntries(Object.entries(inline).filter(([, value]) => value !== undefined));
  };
  for (const node of texts) {
    node.text = (node.text as Run[]).flatMap((run) => {
      const parts = clusters.get(run);
      if (!parts) return [finish(run, run.font, run.text)];
      const pieces: { family: Family; text: string }[] = [];
      for (const cluster of parts) {
        let family = run.font;
        let text = cluster;
        if (!SIMPLE_TEXT.test(cluster)) {
          const choice = choices.get(`${run.font}:${cluster}`);
          if (choice === 'inherit') family = pieces[pieces.length - 1]?.family ?? run.font;
          else if (choice) family = choice;
          else if (choice === null) unsupported.add(cluster);
          // Drop invisible characters (joiners, variation selectors…) that the font would show as boxes.
          const coverage = coverages.get(family);
          if (coverage) {
            text = Array.from(cluster)
              .filter((char) => !IGNORABLE.test(char) || coverage.has(char.codePointAt(0)!))
              .join('');
          }
        }
        const last = pieces[pieces.length - 1];
        if (last?.family === family) last.text += text;
        else pieces.push({ family, text });
      }
      return pieces.filter((piece) => piece.text).map((piece) => finish(run, piece.family, piece.text));
    });
  }

  const problems: string[] = [];
  if (unsupported.size) {
    problems.push(`Some characters (${[...unsupported].slice(0, 3).join(' ')}) can’t be shown in the PDF.`);
  }
  if (rtl) problems.push('Right-to-left text may appear in the wrong order in the PDF.');
  return problems.length ? `${problems.join(' ')} To keep them, print the document and choose “Save as PDF”.` : null;
}

// ------------------------------------------------------------------ export

async function loadPdfMake(): Promise<PdfMake> {
  // pdfmake's browser build is a UMD bundle, which may come as the module's default export.
  const loaded = (await import('pdfmake/build/pdfmake')) as PdfMake & { default?: PdfMake };
  return loaded.default ?? loaded;
}

/**
 * A PDF with the document's formatting, page setup and (same-site) images, plus bookmarks for its headings. Returns a
 * warning if some of the text can't be shown as it is in the editor.
 */
export async function exportPdf(
  json: JSONContent,
  title: string,
  setup: PageSetup,
): Promise<{ blob: Blob; warning: string | null }> {
  const paper = paperSize(setup);
  const margins = setup.margins;
  const [left, top, right, bottom] = [margins.left, margins.top, margins.right, margins.bottom].map(
    (inches) => inches * 72,
  ) as [number, number, number, number];
  const width = paper.width * 72;
  const height = paper.height * 72;

  const [pdfMake, images] = await Promise.all([loadPdfMake(), loadImages(json, PDF_IMAGE_TYPES)]);
  const converter = new Converter(images, collectHeadings(json), height - top - bottom);
  const blocks = converter.blocks(json.content, {
    style: { font: 'Sans', color: TEXT },
    width: width - left - right,
    root: true,
    inTable: false,
    inListItem: false,
    inTaskList: false,
    bullets: 0,
    numbers: 0,
  });
  const content = keepWithNext(blocks, join(blocks, 'root'), height - top - bottom);
  const warning = await applyFonts(converter.texts, (family, variant) => converter.use(family, variant));
  const fonts = await fontDictionary(converter.used);
  let layouts = 1;

  const definition = {
    info: { title, creator: 'TitoDocs', producer: 'TitoDocs' },
    displayTitle: true,
    pageSize: { width, height },
    pageOrientation: setup.orientation,
    pageMargins: [left, top, right, bottom],
    defaultStyle: { font: 'Sans', fontSize: BASE_SIZE, color: TEXT },
    images: converter.images,
    content,
    // Page numbers are 10pt and centred in the bottom margin, as when printing.
    footer:
      setup.pageNumbers && bottom >= 12
        ? (page: number) => ({
            text: String(page),
            font: 'Sans',
            fontSize: 10,
            color: MUTED,
            alignment: 'center',
            margin: [left, (bottom - FONT_HEIGHT.Sans * 10) / 2, right, 0],
          })
        : undefined,
    // Keep other headings with what follows them too (see keepWithNext), while laying out the document again for each
    // one moved to the next page doesn't take too long.
    pageBreakBefore: (node: { headlineLevel?: unknown; pages: number }, nodes: PageNodes) => {
      const move =
        !!node.headlineLevel &&
        (layouts + 1) * node.pages <= RELAYOUT_PAGES &&
        nodes.getFollowingNodesOnPage().length === 0 &&
        nodes.getNodesOnNextPage().length > 0 &&
        nodes.getPreviousNodesOnPage().length > 0;
      if (move) layouts += 1;
      return move;
    },
  };
  pdfMake.setUrlAccessPolicy(() => false);
  pdfMake.setFonts(fonts);
  const blob = await pdfMake.createPdf(definition as unknown as TDocumentDefinitions).getBlob();
  return { blob, warning };
}
