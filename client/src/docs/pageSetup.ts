import { useEffect, useState } from 'react';
import type * as Y from 'yjs';

export type PageSize = 'letter' | 'legal' | 'a4' | 'a5';
export type Orientation = 'portrait' | 'landscape';

export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Page settings for a document, synced to all collaborators. Lengths are in inches. */
export interface PageSetup {
  size: PageSize;
  orientation: Orientation;
  margins: Margins;
  /** Pageless: content flows across the window width instead of a sheet of paper. */
  pageless: boolean;
  /** Print page numbers at the bottom of each page. */
  pageNumbers: boolean;
}

export const PAGE_SIZES: Record<PageSize, { label: string; width: number; height: number }> = {
  letter: { label: 'Letter (8.5 × 11 in)', width: 8.5, height: 11 },
  legal: { label: 'Legal (8.5 × 14 in)', width: 8.5, height: 14 },
  a4: { label: 'A4 (21 × 29.7 cm)', width: 8.27, height: 11.69 },
  a5: { label: 'A5 (14.8 × 21 cm)', width: 5.83, height: 8.27 },
};

export const DEFAULT_PAGE_SETUP: PageSetup = {
  size: 'letter',
  orientation: 'portrait',
  margins: { top: 1, right: 1, bottom: 1, left: 1 },
  pageless: false,
  pageNumbers: false,
};

const PAGE_KEY = 'page';
const MAX_MARGIN = 3;

const clampMargin = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(MAX_MARGIN, Math.max(0, value)) : fallback;

/** Reads the page setup, falling back to defaults for anything missing or invalid. */
export function readPageSetup(meta: Y.Map<unknown>): PageSetup {
  const raw = meta.get(PAGE_KEY) as Partial<PageSetup> | undefined;
  if (!raw || typeof raw !== 'object') return DEFAULT_PAGE_SETUP;
  const margins = (raw.margins ?? {}) as Partial<Margins>;
  const defaults = DEFAULT_PAGE_SETUP;
  return {
    size: raw.size && raw.size in PAGE_SIZES ? raw.size : defaults.size,
    orientation: raw.orientation === 'landscape' ? 'landscape' : 'portrait',
    margins: {
      top: clampMargin(margins.top, defaults.margins.top),
      right: clampMargin(margins.right, defaults.margins.right),
      bottom: clampMargin(margins.bottom, defaults.margins.bottom),
      left: clampMargin(margins.left, defaults.margins.left),
    },
    pageless: !!raw.pageless,
    pageNumbers: !!raw.pageNumbers,
  };
}

export function writePageSetup(meta: Y.Map<unknown>, setup: PageSetup): void {
  meta.set(PAGE_KEY, setup);
}

export function usePageSetup(meta: Y.Map<unknown> | null): PageSetup {
  const [setup, setSetup] = useState(() => (meta ? readPageSetup(meta) : DEFAULT_PAGE_SETUP));
  useEffect(() => {
    if (!meta) return;
    const update = () => setSetup(readPageSetup(meta));
    update();
    meta.observe(update);
    return () => meta.unobserve(update);
  }, [meta]);
  return setup;
}

/** Paper width and height in inches, taking the orientation into account. */
export function paperSize(setup: PageSetup): { width: number; height: number } {
  const { width, height } = PAGE_SIZES[setup.size];
  return setup.orientation === 'landscape' ? { width: height, height: width } : { width, height };
}

/** The @page rule used when printing (and saving as PDF from the print dialog). */
export function printCss(setup: PageSetup): string {
  const { width, height } = paperSize(setup);
  const { top, right, bottom, left } = setup.margins;
  const pageNumber = setup.pageNumbers
    ? '@bottom-center { content: counter(page); font: 10pt Arial, sans-serif; color: #5f6368; }'
    : '';
  return `@page { size: ${width}in ${height}in; margin: ${top}in ${right}in ${bottom}in ${left}in; ${pageNumber} }`;
}
