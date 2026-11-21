import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileMeta, FileType } from '@shared/types';

export function fileUrl(file: Pick<FileMeta, 'id' | 'type' | 'workspaceId'>): string {
  switch (file.type) {
    case 'doc':
      return `/d/${file.id}`;
    case 'code':
      return `/code/${file.id}`;
    case 'workspace':
      return `/w/${file.id}`;
    case 'page':
      return `/w/${file.workspaceId}/${file.id}`;
    case 'component':
      return `/c/${file.id}`;
  }
}

export const absoluteUrl = (path: string): string => new URL(path, window.location.origin).toString();

export const TYPE_LABELS: Record<FileType, string> = {
  doc: 'Document',
  code: 'Code file',
  workspace: 'Workspace',
  page: 'Page',
  component: 'Loop component',
};

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), 'day');
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export const formatDateTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function useLocalStorage<T>(key: string, initial: T): [T, (value: T | ((previous: T) => T)) => void] {
  const storageKey = `titodocs:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T | ((previous: T) => T)) => {
      setValue((previous) => {
        const resolved = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
        try {
          localStorage.setItem(storageKey, JSON.stringify(resolved));
        } catch {
          // Storage may be full or disabled; the value still applies for this session.
        }
        return resolved;
      });
    },
    [storageKey],
  );
  return [value, update];
}

export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Calls `onDismiss` for clicks outside of the referenced element (and Escape) while `active`. */
export function useDismiss<T extends HTMLElement>(active: boolean, onDismiss: () => void) {
  const ref = useRef<T>(null);
  const callback = useRef(onDismiss);
  useEffect(() => {
    callback.current = onDismiss;
  });
  useEffect(() => {
    if (!active) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) callback.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') callback.current();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [active]);
  return ref;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Fetches a same-origin resource such as an uploaded image (which requires the session cookie).
 * Other origins resolve to null: the content security policy only allows connections to this server.
 */
export async function fetchSameOrigin(src: string): Promise<Blob | null> {
  let url: URL;
  try {
    url = new URL(src, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);

/** Makes a string safe to use as a file name. */
export const safeFileName = (title: string, fallback = 'untitled'): string =>
  title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 120) || fallback;

/** Opens the browser's file picker and resolves with the chosen file (or null when cancelled). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Formats a shortcut like "Mod-Shift-z" for display. */
export const shortcut = (keys: string): string =>
  keys
    .split('-')
    .map((key) =>
      key === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : key === 'Alt' && isMac ? '⌥' : key === 'Shift' && isMac ? '⇧' : key.length === 1 ? key.toUpperCase() : key,
    )
    .join(isMac ? '' : '+');
