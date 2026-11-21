import type { FileMeta } from '@shared/types';

export interface PageNode {
  page: FileMeta;
  depth: number;
  children: PageNode[];
}

/** A change to a page's place in the tree, sent as `PATCH /files/:id`. */
export interface PageMove {
  id: string;
  parentId: string | null;
  position: number;
}

export const comparePages = (a: FileMeta, b: FileMeta): number => a.position - b.position || a.createdAt - b.createdAt;

/** The parent used for display: pages whose parent is missing (e.g. in the trash) are shown at the top level. */
const parentOf = (page: FileMeta, ids: Set<string>): string | null => (page.parentId && ids.has(page.parentId) ? page.parentId : null);

/** The parent a page is shown under (null for the top level). */
export function parentIdOf(pages: FileMeta[], id: string): string | null {
  const page = pages.find((candidate) => candidate.id === id);
  return page ? parentOf(page, new Set(pages.map((candidate) => candidate.id))) : null;
}

export function siblingsOf(pages: FileMeta[], parentId: string | null): FileMeta[] {
  const ids = new Set(pages.map((page) => page.id));
  return pages.filter((page) => parentOf(page, ids) === parentId).sort(comparePages);
}

/** Nests a workspace's pages under their parents, in position order. */
export function buildTree(pages: FileMeta[]): PageNode[] {
  const ids = new Set(pages.map((page) => page.id));
  const byParent = new Map<string | null, FileMeta[]>();
  for (const page of [...pages].sort(comparePages)) {
    const parent = parentOf(page, ids);
    byParent.set(parent, [...(byParent.get(parent) ?? []), page]);
  }
  const build = (parent: string | null, depth: number): PageNode[] =>
    (byParent.get(parent) ?? []).map((page) => ({ page, depth, children: build(page.id, depth + 1) }));
  return build(null, 0);
}

/** The pages above `id`, from the top level down to its parent. */
export function ancestors(pages: FileMeta[], id: string): FileMeta[] {
  const byId = new Map(pages.map((page) => [page.id, page]));
  const chain: FileMeta[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current && byId.has(current) && !chain.some((page) => page.id === current)) {
    const page = byId.get(current)!;
    chain.unshift(page);
    current = page.parentId;
  }
  return chain;
}

/** Whether `id` is `ancestorId` or one of its descendants. */
export const isWithin = (pages: FileMeta[], id: string, ancestorId: string): boolean =>
  id === ancestorId || ancestors(pages, id).some((page) => page.id === ancestorId);

/** A position strictly between two neighbours, or null when floating point precision has run out. */
export function positionBetween(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  const middle = (before + after) / 2;
  return middle > before && middle < after ? middle : null;
}

/**
 * The moves that put `pageId` at `index` among the children of `parentId` (the index ignores the page itself).
 * Usually a single move; the siblings are renumbered when there is no room between the neighbours.
 */
export function planMove(pages: FileMeta[], pageId: string, parentId: string | null, index: number): PageMove[] {
  const siblings = siblingsOf(pages, parentId).filter((page) => page.id !== pageId);
  const at = Math.max(0, Math.min(index, siblings.length));
  const position = positionBetween(siblings[at - 1]?.position, siblings[at]?.position);
  if (position !== null) return [{ id: pageId, parentId, position }];
  const order = [...siblings.slice(0, at).map((page) => page.id), pageId, ...siblings.slice(at).map((page) => page.id)];
  return order.map((id, i) => ({ id, parentId, position: i + 1 }));
}

/** Applies moves locally, so the tree updates before the server confirms them. */
export const applyMoves = (pages: FileMeta[], moves: PageMove[]): FileMeta[] =>
  pages.map((page) => {
    const move = moves.find((candidate) => candidate.id === page.id);
    return move ? { ...page, parentId: move.parentId, position: move.position } : page;
  });
