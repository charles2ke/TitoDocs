import { createContext } from 'react';

export interface LoopEnv {
  /** Whether the page embedding the components can be edited (so cards can be removed from it). */
  pageEditable: boolean;
  /** The scrolling element around the components, which their floating menus follow. */
  scrollEl: HTMLElement | null;
}

export const LoopContext = createContext<LoopEnv>({ pageEditable: false, scrollEl: null });

// Components created in this tab a moment ago take focus once they have loaded.
const fresh = new Map<string, number>();
const FRESH_MS = 15_000;

export const markFresh = (id: string): void => void fresh.set(id, Date.now());
export const isFresh = (id: string): boolean => Date.now() - (fresh.get(id) ?? 0) < FRESH_MS;
export const clearFresh = (id: string): void => void fresh.delete(id);
