/** Lightweight file-type helpers (kept separate so the heavy importers can be loaded on demand). */

export const DOC_IMPORT_EXTENSIONS = ['docx', 'md', 'markdown', 'html', 'htm', 'txt'];
export const DOC_IMPORT_ACCEPT = DOC_IMPORT_EXTENSIONS.map((extension) => `.${extension}`).join(',');

/** Files over this size are not opened in the code editor (it is meant for source and text files). */
export const MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024;

export const extensionOf = (name: string): string => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
export const stripExtension = (name: string): string => name.replace(/\.[^.]+$/, '') || name;
