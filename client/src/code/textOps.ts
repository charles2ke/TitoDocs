// Text transformations for the code editor (Notepad++'s Edit menu and plugin tools).
// Pure functions with no imports, so they can be unit tested with Node.

export type Eol = 'lf' | 'crlf' | 'cr';

export const EOL_CHARS: Record<Eol, string> = { lf: '\n', crlf: '\r\n', cr: '\r' };
export const EOL_LABELS: Record<Eol, string> = { crlf: 'Windows (CR LF)', lf: 'Unix (LF)', cr: 'Macintosh (CR)' };

export const isEol = (value: unknown): value is Eol => value === 'lf' || value === 'crlf' || value === 'cr';

/** The most common line ending in a text, or null when it has no line breaks. */
export function detectEol(text: string): Eol | null {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        crlf += 1;
        index += 1;
      } else {
        cr += 1;
      }
    } else if (code === 10) {
      lf += 1;
    }
  }
  if (!crlf && !lf && !cr) return null;
  if (crlf >= lf && crlf >= cr) return 'crlf';
  return lf >= cr ? 'lf' : 'cr';
}

/** The editor works with "\n" only; the file's line ending is applied when it is downloaded. */
export const normalizeEol = (text: string): string => text.replace(/\r\n?/g, '\n');

export const applyEol = (text: string, eol: Eol): string => (eol === 'lf' ? text : text.replace(/\n/g, EOL_CHARS[eol]));

/**
 * Guesses a file's indentation from its lines: tabs, or spaces with the most common indent step.
 * The tab width of tab-indented files can't be known, so `size` is null for them.
 */
export function detectIndentation(text: string): { useTabs: boolean; size: number | null } | null {
  let tabLines = 0;
  let spaceLines = 0;
  let previous = 0;
  const steps = new Map<number, number>();
  for (const line of text.split(/\r\n?|\n/, 10_000)) {
    if (!line.trim()) continue;
    const indent = /^[ \t]*/.exec(line)![0];
    if (indent.startsWith('\t')) {
      tabLines += 1;
      continue;
    }
    if (indent) spaceLines += 1;
    // Steps of one space are usually comment continuations (" * text"), not indentation.
    const step = Math.abs(indent.length - previous);
    if (step > 1 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1);
    previous = indent.length;
  }
  if (!tabLines && !spaceLines) return null;
  if (tabLines > spaceLines) return { useTabs: true, size: null };
  let size = 0;
  let count = 0;
  for (const [step, seen] of steps) {
    if (seen > count || (seen === count && step < size)) {
      size = step;
      count = seen;
    }
  }
  return { useTabs: false, size: size || null };
}

// ------------------------------------------------------------------ text encodings

export type TextEncodingName = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be';

export const ENCODING_LABELS: Record<TextEncodingName, string> = {
  'utf-8': 'UTF-8',
  'utf-8-bom': 'UTF-8-BOM',
  'utf-16le': 'UTF-16 LE BOM',
  'utf-16be': 'UTF-16 BE BOM',
};

export const isTextEncoding = (value: unknown): value is TextEncodingName =>
  typeof value === 'string' && Object.hasOwn(ENCODING_LABELS, value);

/** Decodes a text file, honouring a byte order mark. Files without one are read as UTF-8. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: TextEncodingName } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' };
  return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8' };
}

/** Encodes text for download in the file's encoding (with a byte order mark where the encoding has one). */
export function encodeText(text: string, encoding: TextEncodingName): Uint8Array<ArrayBuffer> {
  if (encoding === 'utf-8' || encoding === 'utf-8-bom') {
    const body = new TextEncoder().encode(text);
    if (encoding === 'utf-8') return body;
    const bytes = new Uint8Array(body.length + 3);
    bytes.set([0xef, 0xbb, 0xbf]);
    bytes.set(body, 3);
    return bytes;
  }
  const bytes = new Uint8Array(2 + text.length * 2);
  const view = new DataView(bytes.buffer);
  const little = encoding === 'utf-16le';
  view.setUint16(0, 0xfeff, little);
  for (let index = 0; index < text.length; index += 1) view.setUint16(2 + index * 2, text.charCodeAt(index), little);
  return bytes;
}

// ------------------------------------------------------------------ line operations

export type SortMode =
  | 'asc'
  | 'desc'
  | 'ascIgnoreCase'
  | 'descIgnoreCase'
  | 'numberAsc'
  | 'numberDesc'
  | 'lengthAsc'
  | 'lengthDesc';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The number a line starts with (ignoring leading spaces), or null. */
function leadingNumber(line: string): number | null {
  const match = /^\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?)/i.exec(line);
  return match ? Number(match[1]) : null;
}

/** Sorts lines. Numeric sorts keep lines that don't start with a number at the end, in their original order. */
export function sortLines(lines: string[], mode: SortMode): string[] {
  const sorted = [...lines];
  switch (mode) {
    case 'asc':
      return sorted.sort(compareText);
    case 'desc':
      return sorted.sort((a, b) => compareText(b, a));
    case 'ascIgnoreCase':
      return sorted.sort((a, b) => compareText(a.toLowerCase(), b.toLowerCase()) || compareText(a, b));
    case 'descIgnoreCase':
      return sorted.sort((a, b) => compareText(b.toLowerCase(), a.toLowerCase()) || compareText(b, a));
    case 'numberAsc':
    case 'numberDesc': {
      const sign = mode === 'numberAsc' ? 1 : -1;
      return sorted.sort((a, b) => {
        const x = leadingNumber(a);
        const y = leadingNumber(b);
        if (x === null || y === null) return x === null ? (y === null ? 0 : 1) : -1;
        return (x - y) * sign;
      });
    }
    case 'lengthAsc':
      return sorted.sort((a, b) => a.length - b.length);
    case 'lengthDesc':
      return sorted.sort((a, b) => b.length - a.length);
  }
}

export const reverseLines = (lines: string[]): string[] => [...lines].reverse();

export function shuffleLines(lines: string[], random: () => number = Math.random): string[] {
  const shuffled = [...lines];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

/** Removes repeated lines, keeping the first occurrence. */
export const removeDuplicateLines = (lines: string[]): string[] => [...new Set(lines)];

export const removeConsecutiveDuplicateLines = (lines: string[]): string[] =>
  lines.filter((line, index) => index === 0 || line !== lines[index - 1]);

/** Removes empty lines; with `blank`, lines holding only spaces and tabs go too. */
export const removeEmptyLines = (lines: string[], blank = false): string[] =>
  lines.filter((line) => (blank ? line.trim() !== '' : line !== ''));

/** Joins lines with single spaces, dropping the indentation of the joined lines. */
export const joinLines = (lines: string[]): string[] => [
  lines.map((line, index) => (index === 0 ? line.replace(/\s+$/, '') : line.trim())).filter((line, index) => index === 0 || line).join(' '),
];

export const trimTrailing = (lines: string[]): string[] => lines.map((line) => line.replace(/[ \t]+$/, ''));
export const trimLeading = (lines: string[]): string[] => lines.map((line) => line.replace(/^[ \t]+/, ''));
export const trimBoth = (lines: string[]): string[] => lines.map((line) => line.replace(/^[ \t]+|[ \t]+$/g, ''));

/** Expands tabs to spaces, up to the next tab stop. */
export function tabsToSpaces(line: string, tabSize: number): string {
  let result = '';
  for (const char of line) {
    if (char === '\t') result += ' '.repeat(tabSize - (result.length % tabSize));
    else result += char;
  }
  return result;
}

/** Converts the spaces in each line's indentation to tabs (leftover spaces are kept). */
export function leadingSpacesToTabs(line: string, tabSize: number): string {
  const indent = /^[ \t]*/.exec(line)![0];
  const width = tabsToSpaces(indent, tabSize).length;
  return '\t'.repeat(Math.floor(width / tabSize)) + ' '.repeat(width % tabSize) + line.slice(indent.length);
}

// ------------------------------------------------------------------ case conversion

export type CaseMode = 'upper' | 'lower' | 'proper' | 'sentence' | 'invert' | 'random';

export function convertCase(text: string, mode: CaseMode, random: () => number = Math.random): string {
  switch (mode) {
    case 'upper':
      return text.toUpperCase();
    case 'lower':
      return text.toLowerCase();
    case 'proper':
      // Apostrophes belong to the word: "don't" becomes "Don't", not "Don'T".
      return text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
    case 'sentence':
      return text.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase());
    case 'invert':
      return Array.from(text, (char) => {
        const upper = char.toUpperCase();
        return char === upper ? char.toLowerCase() : upper;
      }).join('');
    case 'random':
      return Array.from(text, (char) => (random() < 0.5 ? char.toLowerCase() : char.toUpperCase())).join('');
  }
}

// ------------------------------------------------------------------ encoders and formatters

/** Base64 of the UTF-8 bytes of a text. */
export function base64Encode(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64Decode(text: string): string {
  let binary: string;
  try {
    binary = atob(text.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new Error('The text is not valid Base64.');
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('The decoded data is not UTF-8 text.');
  }
}

export const urlEncode = (text: string): string => encodeURIComponent(text);

export function urlDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    throw new Error('The text contains an invalid %-escape.');
  }
}

/** Describes a JSON parse error with a line and column where the engine reports a position. */
function jsonError(text: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const position = /position (\d+)/.exec(message);
  if (position) {
    const before = text.slice(0, Number(position[1]));
    const line = before.split('\n').length;
    const column = before.length - before.lastIndexOf('\n');
    return new Error(`Invalid JSON at line ${line}, column ${column}.`);
  }
  return new Error(`Invalid JSON: ${message}`);
}

export function formatJson(text: string, indent: string | number = 2): string {
  try {
    return JSON.stringify(JSON.parse(text), null, indent);
  } catch (error) {
    throw jsonError(text, error);
  }
}

export function minifyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch (error) {
    throw jsonError(text, error);
  }
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

export const escapeHtmlText = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

export const unescapeHtmlText = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });

export type HashAlgorithm = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

/** Hex digest of the UTF-8 bytes of a text. */
export async function hashText(text: string, algorithm: HashAlgorithm): Promise<string> {
  const digest = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ column editor

export interface NumberSequence {
  initial: number;
  step: number;
  /** How many times each number repeats before the next one. */
  repeat: number;
  base: 2 | 8 | 10 | 16;
  /** Pad numbers to the same width with zeros or spaces. */
  pad: 'none' | 'zeros' | 'spaces';
}

/** The numbers inserted by Edit ▸ Column editor, one per line. */
export function numberSequence(count: number, { initial, step, repeat, base, pad }: NumberSequence): string[] {
  const values = Array.from({ length: count }, (_, index) => initial + Math.floor(index / Math.max(1, repeat)) * step);
  const texts = values.map((value) => (value < 0 ? '-' : '') + Math.abs(value).toString(base).toUpperCase());
  if (pad === 'none') return texts;
  const width = Math.max(...texts.map((text) => text.replace('-', '').length));
  return texts.map((text) => {
    const negative = text.startsWith('-');
    const digits = negative ? text.slice(1) : text;
    return pad === 'zeros' ? (negative ? '-' : '') + digits.padStart(width, '0') : text.padStart(width + (negative ? 1 : 0), ' ');
  });
}

// ------------------------------------------------------------------ statistics

export interface TextSummary {
  characters: number;
  /** Characters other than spaces, tabs and line breaks. */
  nonBlank: number;
  words: number;
  lines: number;
}

export function summarize(text: string): TextSummary {
  return {
    characters: [...text.replace(/\n/g, '')].length,
    nonBlank: [...text.replace(/\s/g, '')].length,
    words: text.match(/[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*/gu)?.length ?? 0,
    lines: text === '' ? 1 : text.split('\n').length,
  };
}

/** Smallest single replacement turning `before` into `after`, so collaborators' cursors and undo stay precise. */
export function minimalChange(before: string, after: string): { from: number; to: number; insert: string } | null {
  if (before === after) return null;
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  // Don't split a surrogate pair.
  if (start > 0 && /[\ud800-\udbff]/.test(before[start - 1]!)) start -= 1;
  if (endBefore < before.length && /[\udc00-\udfff]/.test(before[endBefore]!)) {
    endBefore += 1;
    endAfter += 1;
  }
  return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}
