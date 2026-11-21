import type { JSONContent } from '@tiptap/core';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  LevelFormat,
  LineRuleType,
  Packer,
  PageBreak,
  PageNumber,
  PageOrientation,
  Paragraph,
  ShadingType,
  Tab,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  WidthType,
  convertInchesToTwip,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from 'docx';
import { INDENT_STEP_IN } from '../editor/paragraph-format';
import { fetchSameOrigin } from '../lib/util';
import { PAGE_SIZES, paperSize, type PageSetup } from './pageSetup';

type Block = Paragraph | Table;
type Writable<T> = { -readonly [K in keyof T]: T[K] };

interface LoadedImage {
  data: Uint8Array;
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  width: number;
  height: number;
}

interface Headings {
  list: { level: number; text: string }[];
  index: Map<JSONContent, number>;
}

interface Context {
  /** Left indent in twips, for quotes and content nested in lists or collapsible sections. */
  indent: number;
  listLevel: number;
  /** A numbered list's numbering, which numbered lists nested directly in it continue as deeper levels. */
  numbering?: { reference: string; instance: number };
  quote: boolean;
  /** Width of the enclosing page or table cell, in twips. */
  width: number;
  run?: IRunOptions;
}

const TWIPS_PER_PX = 15;
const LIST_INDENT = 720;
const CELL_MARGIN = 100;
const INDENT_TWIPS = convertInchesToTwip(INDENT_STEP_IN);
/** CSS line height of single-spaced Arial. Word's line spacing is a multiple of it. */
const CSS_SINGLE_LINE = 1.15;
const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];
const ALIGNMENT: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};
const NUMBER_FORMATS = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
const BULLETS = ['●', '○', '■'];
const QUOTE_BORDER = { left: { style: BorderStyle.SINGLE, size: 18, color: 'DADCE0', space: 10 } };
const CODE_SIDE = { style: BorderStyle.SINGLE, size: 4, color: 'E1E4E8', space: 4 };
const DOCX_IMAGE_TYPES: Record<string, LoadedImage['type']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};

const shading = (fill: string) => ({ type: ShadingType.CLEAR, color: 'auto', fill });
const bookmarkName = (index: number) => `heading_${index + 1}`;

const plainText = (node: JSONContent): string =>
  node.type === 'text'
    ? (node.text ?? '')
    : node.type === 'mention'
      ? `@${node.attrs?.label ?? node.attrs?.id ?? ''}`
      : (node.content ?? []).map(plainText).join('');

/** Splits text on tabs, which Word needs as separate tab elements. */
const textChildren = (text: string): (string | Tab)[] =>
  text
    .split('\t')
    .flatMap((part, index) => (index ? [new Tab(), part] : [part]))
    .filter((child) => child !== '');

let colorContext: CanvasRenderingContext2D | null | undefined;

/** Converts a CSS colour to Word's hex form; undefined for invalid or transparent colours. */
function hexColor(value: unknown): string | undefined {
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

/** CSS font size to Word's half-points. */
function halfPoints(value: unknown): number | undefined {
  const match = /^([\d.]+)\s*(pt|px|em|rem)?$/i.exec(String(value ?? '').trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'px').toLowerCase();
  const points = unit === 'pt' ? amount : unit === 'px' ? amount * 0.75 : amount * 11;
  return points > 0 ? Math.round(points * 2) : undefined;
}

function lineSpacing(value: unknown): IParagraphOptions['spacing'] {
  const match = /^([\d.]+)\s*(%|pt|px)?$/.exec(String(value ?? '').trim());
  const amount = Number(match?.[1]);
  if (!match || !(amount > 0)) return undefined;
  switch (match[2]) {
    case 'pt':
      return { line: Math.round(amount * 20), lineRule: LineRuleType.EXACT };
    case 'px':
      return { line: Math.round(amount * TWIPS_PER_PX), lineRule: LineRuleType.EXACT };
    case '%':
      return { line: Math.round((amount / 100 / CSS_SINGLE_LINE) * 240) };
    default:
      return { line: Math.round((amount / CSS_SINGLE_LINE) * 240) };
  }
}

const fontName = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.split(',')[0]!.trim().replace(/^["']|["']$/g, '') || undefined : undefined;

/** Absolute http(s)/mailto/tel URLs; anything else can't be a link in Word. */
function safeLink(href: unknown): string | null {
  if (typeof href !== 'string' || !href || href.startsWith('#')) return null;
  try {
    const url = new URL(href, window.location.href);
    return /^(https?|mailto|tel):$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function markOptions(marks: JSONContent['marks'] = []): Writable<IRunOptions> {
  const options: Writable<IRunOptions> = {};
  for (const mark of marks) {
    const attrs = mark.attrs ?? {};
    switch (mark.type) {
      case 'bold':
        options.bold = true;
        break;
      case 'italic':
        options.italics = true;
        break;
      case 'underline':
        options.underline = {};
        break;
      case 'strike':
        options.strike = true;
        break;
      case 'subscript':
        options.subScript = true;
        break;
      case 'superscript':
        options.superScript = true;
        break;
      case 'code':
        options.font = 'Consolas';
        options.shading = shading('F1F3F4');
        break;
      case 'highlight':
        options.shading = shading(hexColor(attrs.color) ?? 'FFFF00');
        break;
      case 'textStyle': {
        const color = hexColor(attrs.color);
        const background = hexColor(attrs.backgroundColor);
        const size = halfPoints(attrs.fontSize);
        const font = fontName(attrs.fontFamily);
        if (color) options.color = color;
        if (background) options.shading ??= shading(background);
        if (size) options.size = size;
        if (font) options.font = font;
        break;
      }
    }
  }
  return options;
}

function runs(content: JSONContent[] | undefined, base: IRunOptions = {}): ParagraphChild[] {
  const items: { href: string | null; run: TextRun }[] = [];
  let breaks = 0;
  for (const node of content ?? []) {
    if (node.type === 'hardBreak') {
      breaks += 1;
      continue;
    }
    const text = plainText(node);
    if (!text) continue;
    const href = safeLink(node.marks?.find((mark) => mark.type === 'link')?.attrs?.href);
    const options: IRunOptions = {
      ...base,
      ...markOptions(node.marks),
      ...(href ? { style: 'Hyperlink' } : {}),
      break: breaks || undefined,
      children: textChildren(text),
    };
    items.push({ href, run: new TextRun(options) });
    breaks = 0;
  }
  if (breaks) items.push({ href: null, run: new TextRun({ break: breaks }) });

  // Consecutive runs with the same link become one hyperlink.
  const children: ParagraphChild[] = [];
  for (let start = 0; start < items.length; ) {
    const href = items[start]!.href;
    let end = start + 1;
    while (end < items.length && items[end]!.href === href) end += 1;
    const group = items.slice(start, end).map((item) => item.run);
    if (href) children.push(new ExternalHyperlink({ link: href, children: group }));
    else children.push(...group);
    start = end;
  }
  return children;
}

function collectHeadings(doc: JSONContent): Headings {
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

async function loadImage(src: string): Promise<LoadedImage | null> {
  const blob = await fetchSameOrigin(src);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const element = new Image();
    element.src = url;
    await element.decode();
    const width = element.naturalWidth || 300;
    const height = element.naturalHeight || 150;
    let type = DOCX_IMAGE_TYPES[blob.type];
    let data: Blob | null = blob;
    if (!type) {
      // Word can't show WebP, AVIF or SVG images, so they are converted to PNG.
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

async function loadImages(doc: JSONContent): Promise<Map<string, LoadedImage>> {
  const sources = new Set<string>();
  const visit = (node: JSONContent) => {
    if (node.type === 'image' && typeof node.attrs?.src === 'string') sources.add(node.attrs.src);
    node.content?.forEach(visit);
  };
  visit(doc);
  const images = new Map<string, LoadedImage>();
  await Promise.all(
    [...sources].map(async (src) => {
      const image = await loadImage(src);
      if (image) images.set(src, image);
    }),
  );
  return images;
}

class Converter {
  private instances = 0;
  private readonly numberingStarts = new Set([1]);

  constructor(
    private readonly images: Map<string, LoadedImage>,
    private readonly headings: Headings,
  ) {}

  blocks(nodes: JSONContent[] | undefined, ctx: Context): Block[] {
    return (nodes ?? []).flatMap((node) => this.block(node, ctx));
  }

  numberingConfig() {
    const levels = (bullet: boolean, start: number) =>
      Array.from({ length: 9 }, (_, level) => ({
        level,
        format: bullet ? LevelFormat.BULLET : NUMBER_FORMATS[level % 3]!,
        text: bullet ? BULLETS[level % 3]! : `%${level + 1}.`,
        alignment: AlignmentType.LEFT,
        start: level === 0 ? start : 1,
        style: { paragraph: { indent: { left: LIST_INDENT * (level + 1), hanging: 360 } } },
      }));
    return [
      { reference: 'bullets', levels: levels(true, 1) },
      ...[...this.numberingStarts].map((start) => ({ reference: `numbers-${start}`, levels: levels(false, start) })),
    ];
  }

  private block(node: JSONContent, ctx: Context): Block[] {
    switch (node.type) {
      case 'paragraph':
        return [this.paragraph(node, ctx)];
      case 'heading':
        return [this.heading(node, ctx)];
      case 'bulletList':
      case 'orderedList':
        return this.list(node, ctx);
      case 'taskList':
        return this.taskList(node, ctx);
      case 'blockquote':
        return this.blocks(node.content, {
          ...ctx,
          indent: ctx.indent + 240,
          quote: true,
          run: { ...ctx.run, color: '5F6368' },
        });
      case 'codeBlock':
        return [this.codeBlock(node, ctx)];
      case 'horizontalRule':
        return [
          new Paragraph({
            indent: ctx.indent ? { left: ctx.indent } : undefined,
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DADCE0', space: 1 } },
          }),
        ];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'image':
        return [this.image(node, ctx)];
      case 'table':
        return this.table(node, ctx);
      case 'tableOfContents':
        return this.tableOfContents(ctx);
      case 'details':
        return this.details(node, ctx);
      default:
        return this.blocks(node.content, ctx);
    }
  }

  private paragraph(node: JSONContent, ctx: Context, options: Writable<IParagraphOptions> = {}): Paragraph {
    const attrs = node.attrs ?? {};
    const left = ctx.indent + (Number(attrs.indent) || 0) * INDENT_TWIPS;
    return new Paragraph({
      alignment: ALIGNMENT[attrs.textAlign as string],
      spacing: lineSpacing(attrs.lineHeight),
      indent: left && !options.numbering ? { left } : undefined,
      border: ctx.quote ? QUOTE_BORDER : undefined,
      children: runs(node.content, ctx.run),
      ...options,
    });
  }

  private heading(node: JSONContent, ctx: Context): Paragraph {
    const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1));
    const index = this.headings.index.get(node);
    const children = runs(node.content, ctx.run);
    return this.paragraph(node, ctx, {
      heading: HEADINGS[level - 1],
      // Bookmarks are the targets of the table of contents' links.
      children: index === undefined ? children : [new Bookmark({ id: bookmarkName(index), children })],
    });
  }

  private list(node: JSONContent, ctx: Context): Block[] {
    const level = Math.min(8, ctx.listLevel);
    let numbering = { reference: 'bullets', instance: 0 };
    if (node.type === 'orderedList') {
      const start = Math.max(0, Math.floor(Number(node.attrs?.start ?? 1))) || 1;
      if (ctx.numbering && start === 1) {
        numbering = ctx.numbering;
      } else {
        this.numberingStarts.add(start);
        this.instances += 1;
        numbering = { reference: `numbers-${start}`, instance: this.instances };
      }
    }
    const nested: Context = {
      ...ctx,
      listLevel: ctx.listLevel + 1,
      numbering: node.type === 'orderedList' ? numbering : undefined,
    };
    const out: Block[] = [];
    for (const item of node.content ?? []) {
      (item.content ?? []).forEach((child, index) => {
        if (index === 0 && child.type === 'paragraph') {
          out.push(this.paragraph(child, ctx, { numbering: { ...numbering, level } }));
        } else if (LIST_TYPES.has(child.type ?? '')) {
          out.push(...this.block(child, nested));
        } else {
          // Further paragraphs line up with the item's text.
          out.push(...this.block(child, { ...ctx, indent: LIST_INDENT * (level + 1) }));
        }
      });
    }
    return out;
  }

  private taskList(node: JSONContent, ctx: Context): Block[] {
    const left = ctx.indent + LIST_INDENT * (Math.min(8, ctx.listLevel) + 1);
    const out: Block[] = [];
    for (const item of node.content ?? []) {
      const checked = !!item.attrs?.checked;
      const run: IRunOptions | undefined = checked ? { ...ctx.run, strike: true, color: '80868B' } : ctx.run;
      (item.content ?? []).forEach((child, index) => {
        if (index === 0 && child.type === 'paragraph') {
          out.push(
            this.paragraph(child, ctx, {
              indent: { left, hanging: 360 },
              children: [
                new TextRun({ text: checked ? '☒' : '☐', font: 'Segoe UI Symbol' }),
                new TextRun({ children: [new Tab()] }),
                ...runs(child.content, run),
              ],
            }),
          );
        } else if (LIST_TYPES.has(child.type ?? '')) {
          out.push(...this.block(child, { ...ctx, listLevel: ctx.listLevel + 1, numbering: undefined }));
        } else {
          out.push(...this.block(child, { ...ctx, indent: left, run }));
        }
      });
    }
    return out;
  }

  private codeBlock(node: JSONContent, ctx: Context): Paragraph {
    return new Paragraph({
      indent: ctx.indent ? { left: ctx.indent } : undefined,
      shading: shading('F6F8FA'),
      border: { top: CODE_SIDE, bottom: CODE_SIDE, left: CODE_SIDE, right: CODE_SIDE },
      spacing: { line: 240, after: 160 },
      children: plainText(node)
        .split('\n')
        .map(
          (line, index) =>
            new TextRun({ font: 'Consolas', size: 19, break: index ? 1 : undefined, children: textChildren(line) }),
        ),
    });
  }

  private image(node: JSONContent, ctx: Context): Paragraph {
    const src = String(node.attrs?.src ?? '');
    const alt = String(node.attrs?.alt ?? '');
    const indent = ctx.indent ? { left: ctx.indent } : undefined;
    const image = this.images.get(src);
    if (!image) {
      // Images from other sites can't be downloaded here; link to them instead.
      const label = new TextRun({ text: alt ? `[Image: ${alt}]` : '[Image]', style: 'Hyperlink' });
      const link = safeLink(src);
      return new Paragraph({ indent, children: link ? [new ExternalHyperlink({ link, children: [label] })] : [label] });
    }
    const maxWidth = (ctx.width - ctx.indent) / TWIPS_PER_PX;
    let width = Number(node.attrs?.width) || image.width;
    let height = Number(node.attrs?.height) || (width * image.height) / image.width;
    if (width > maxWidth) {
      height = (height * maxWidth) / width;
      width = maxWidth;
    }
    return new Paragraph({
      indent,
      children: [
        new ImageRun({
          type: image.type,
          data: image.data,
          transformation: { width: Math.round(width), height: Math.round(height) },
          altText: alt ? { name: alt, description: alt } : undefined,
        }),
      ],
    });
  }

  private table(node: JSONContent, ctx: Context): Block[] {
    const rows = (node.content ?? []).filter((row) => row.type === 'tableRow');
    if (!rows.length) return [];
    const span = (cell: JSONContent, key: 'colspan' | 'rowspan') => Math.max(1, Number(cell.attrs?.[key]) || 1);
    const columnCount = Math.max(
      1,
      ...rows.map((row) => (row.content ?? []).reduce((sum, cell) => sum + span(cell, 'colspan'), 0)),
    );

    // Resized columns keep their widths; the others share the remaining space.
    const fixed: number[] = [];
    for (const cell of rows[0]!.content ?? []) {
      const widths: unknown[] = Array.isArray(cell.attrs?.colwidth) ? cell.attrs.colwidth : [];
      for (let i = 0; i < span(cell, 'colspan'); i++) {
        fixed.push(Number(widths[i]) > 0 ? Number(widths[i]) * TWIPS_PER_PX : 0);
      }
    }
    while (fixed.length < columnCount) fixed.push(0);
    fixed.length = columnCount;
    const available = Math.max(ctx.width - ctx.indent, 1440);
    const free = fixed.filter((width) => !width).length;
    const remaining = available - fixed.reduce((sum, width) => sum + width, 0);
    const each = free ? Math.max(Math.floor(remaining / free), 720) : 0;
    let widths = fixed.map((width) => width || each);
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total > available) widths = widths.map((width) => Math.floor((width * available) / total));

    // Rows remaining for each column covered by a cell spanning rows from above.
    const covered = new Array<number>(columnCount).fill(0);
    const tableRows = rows.map((row, rowIndex) => {
      const cells = row.content ?? [];
      let column = 0;
      const children = cells.map((cell) => {
        while (column < columnCount && covered[column]! > 0) column += 1;
        const colspan = span(cell, 'colspan');
        const rowspan = span(cell, 'rowspan');
        const width = widths.slice(column, column + colspan).reduce((sum, value) => sum + value, 0) || 1440;
        for (let i = column; i < Math.min(columnCount, column + colspan); i++) covered[i] = rowspan;
        column += colspan;
        const header = cell.type === 'tableHeader';
        const content = this.blocks(cell.content, {
          indent: 0,
          listLevel: 0,
          quote: false,
          width: Math.max(width - 2 * CELL_MARGIN, 360),
          run: header ? { ...ctx.run, bold: true } : ctx.run,
        });
        // Word requires every cell to end with a paragraph.
        if (!(content[content.length - 1] instanceof Paragraph)) content.push(new Paragraph({}));
        return new TableCell({
          children: content,
          width: { size: width, type: WidthType.DXA },
          columnSpan: colspan > 1 ? colspan : undefined,
          rowSpan: rowspan > 1 ? rowspan : undefined,
          shading: header ? shading('F1F3F4') : undefined,
          margins: { top: 60, bottom: 60, left: CELL_MARGIN, right: CELL_MARGIN },
        });
      });
      for (let i = 0; i < columnCount; i++) covered[i] = Math.max(0, covered[i]! - 1);
      const headerRow = rowIndex === 0 && cells.length > 0 && cells.every((cell) => cell.type === 'tableHeader');
      return new TableRow({ children, tableHeader: headerRow || undefined });
    });

    return [
      new Table({
        rows: tableRows,
        columnWidths: widths,
        width: { size: widths.reduce((sum, width) => sum + width, 0), type: WidthType.DXA },
        indent: ctx.indent ? { size: ctx.indent, type: WidthType.DXA } : undefined,
      }),
    ];
  }

  private tableOfContents(ctx: Context): Block[] {
    const { list } = this.headings;
    if (!list.length) return [];
    const minLevel = Math.min(...list.map((heading) => heading.level));
    return [
      new Paragraph({
        indent: ctx.indent ? { left: ctx.indent } : undefined,
        keepNext: true,
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Table of contents', bold: true })],
      }),
      ...list.map(
        (heading, index) =>
          new Paragraph({
            indent: { left: ctx.indent + 360 * (heading.level - minLevel) },
            spacing: { after: 40 },
            children: [
              new InternalHyperlink({
                anchor: bookmarkName(index),
                children: [new TextRun({ text: heading.text, style: 'Hyperlink' })],
              }),
            ],
          }),
      ),
    ];
  }

  private details(node: JSONContent, ctx: Context): Block[] {
    const summary = node.content?.find((child) => child.type === 'detailsSummary');
    const content = node.content?.find((child) => child.type === 'detailsContent');
    return [
      new Paragraph({
        indent: ctx.indent ? { left: ctx.indent } : undefined,
        border: ctx.quote ? QUOTE_BORDER : undefined,
        keepNext: true,
        children: [new TextRun({ ...ctx.run, text: '▾ ' }), ...runs(summary?.content, { ...ctx.run, bold: true })],
      }),
      ...this.blocks(content?.content, { ...ctx, indent: ctx.indent + 360 }),
    ];
  }
}

const HEADING_HALF_POINTS = [40, 32, 28, 24, 22, 22];

const headingStyle = (level: number) => ({
  run: { font: 'Arial', size: HEADING_HALF_POINTS[level - 1], bold: level < 6, italics: level === 6, color: '202124' },
  paragraph: { spacing: { before: level <= 2 ? 360 : 240, after: 80, line: 240 }, keepNext: true, keepLines: true },
});

/** A Word document with the document's formatting, page setup and (same-site) images. */
export async function exportDocx(json: JSONContent, title: string, setup: PageSetup): Promise<Blob> {
  const contentWidth = convertInchesToTwip(paperSize(setup).width - setup.margins.left - setup.margins.right);
  const converter = new Converter(await loadImages(json), collectHeadings(json));
  const children = converter.blocks(json.content, { indent: 0, listLevel: 0, quote: false, width: contentWidth });
  if (!(children[children.length - 1] instanceof Paragraph)) children.push(new Paragraph({}));
  const size = PAGE_SIZES[setup.size];
  const document = new Document({
    title,
    creator: 'TitoDocs',
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 22, color: '202124' },
          paragraph: { spacing: { line: 276, after: 120 } },
        },
        heading1: headingStyle(1),
        heading2: headingStyle(2),
        heading3: headingStyle(3),
        heading4: headingStyle(4),
        heading5: headingStyle(5),
        heading6: headingStyle(6),
        hyperlink: { run: { color: '1155CC', underline: { type: UnderlineType.SINGLE } } },
      },
    },
    numbering: { config: converter.numberingConfig() },
    sections: [
      {
        properties: {
          page: {
            // docx swaps the width and height of landscape pages itself.
            size: {
              width: convertInchesToTwip(size.width),
              height: convertInchesToTwip(size.height),
              orientation: setup.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
            },
            margin: {
              top: convertInchesToTwip(setup.margins.top),
              right: convertInchesToTwip(setup.margins.right),
              bottom: convertInchesToTwip(setup.margins.bottom),
              left: convertInchesToTwip(setup.margins.left),
            },
          },
        },
        footers: setup.pageNumbers
          ? {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, color: '5F6368' })],
                  }),
                ],
              }),
            }
          : undefined,
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
