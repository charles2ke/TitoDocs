/** Lightweight file-type helpers (kept separate so the heavy importers can be loaded on demand). */
import { decodeText, type TextEncodingName } from '../code/textOps';

export const DOC_IMPORT_EXTENSIONS = ['docx', 'md', 'markdown', 'html', 'htm', 'txt'];
export const DOC_IMPORT_ACCEPT = DOC_IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(',');

/** Files over this size are not opened in the code editor (it is meant for source and text files). */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

export const extensionOf = (name: string): string => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '') || name;

/** Reads a local text file for the code editor, detecting UTF-8 and UTF-16 byte order marks. */
export async function readTextFile(file: File): Promise<{ text: string; encoding: TextEncodingName }> {
  if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('This file is too large to open (the limit is 5 MB).');
  const decoded = decodeText(new Uint8Array(await file.arrayBuffer()));
  // Text never contains NUL characters (UTF-16 text is decoded by now, so its zero bytes are gone).
  if (decoded.text.slice(0, 8000).includes('\0')) throw new Error('This looks like a binary file, which cannot be opened as text.');
  return decoded;
}
