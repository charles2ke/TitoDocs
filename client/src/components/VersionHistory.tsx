import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Y from 'yjs';
import { ArrowLeft, EllipsisVertical, History } from 'lucide-react';
import type { FileMeta, VersionMeta } from '@shared/types';
import { api, errorMessage } from '../api';
import { formatDateTime } from '../lib/util';
import { ConfirmDialog, PromptDialog } from './Dialog';
import { Dropdown } from './Menu';
import { useToast } from './Toast';
import { Spinner } from './ui';

interface VersionHistoryProps {
  file: FileMeta;
  /** Shows the content of a version (a Yjs document holding the file's saved state). */
  renderPreview: (doc: Y.Doc) => ReactNode;
  /** Replaces the live content with the version's. A "Before restoring" version is saved first. */
  onRestore: (doc: Y.Doc) => void | Promise<void>;
  onClose: () => void;
}

const versionTitle = (version: VersionMeta): string => version.name ?? formatDateTime(version.createdAt);

type Preview = { id: string; doc: Y.Doc } | { id: string; error: string };

/** File ▸ Version history: browse, name and restore saved versions of a file. */
export function VersionHistory({ file, renderPreview, onRestore, onClose }: VersionHistoryProps) {
  const toast = useToast();
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [namedOnly, setNamedOnly] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [naming, setNaming] = useState<VersionMeta | 'current' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    let cancelled = false;
    api.versions(file.id).then(
      ({ versions: list }) => {
        if (cancelled) return;
        setVersions(list);
        setSelected(list[0]?.id ?? null);
      },
      (caught) => {
        if (cancelled) return;
        setVersions([]);
        setError(errorMessage(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPreview(null);
    api.versionState(file.id, selected).then(
      (state) => {
        if (cancelled) return;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, state);
        setPreview({ id: selected, doc });
      },
      (caught) => {
        if (!cancelled) setPreview({ id: selected, error: errorMessage(caught) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [file.id, selected]);

  useEffect(() => () => (preview && 'doc' in preview ? preview.doc.destroy() : undefined), [preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !naming && !confirming && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [naming, confirming, onClose]);

  const shown = (versions ?? []).filter((version) => !namedOnly || version.name);
  const current = versions?.find((version) => version.id === selected) ?? null;

  const restore = async () => {
    if (!current || !preview || !('doc' in preview)) return;
    try {
      await api.saveVersion(file.id, `Before restoring “${versionTitle(current)}”`);
      await onRestore(preview.doc);
      toast.show(`Restored “${versionTitle(current)}”`, { kind: 'success' });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const name = async (value: string) => {
    if (!naming) return;
    const trimmed = value.trim();
    if (naming === 'current') {
      const { version } = await api.saveVersion(file.id, trimmed || undefined);
      setVersions((list) => [version, ...(list ?? [])]);
      setSelected(version.id);
    } else {
      const { versions: list } = await api.renameVersion(file.id, naming.id, trimmed || null);
      setVersions(list);
    }
  };

  return (
    <div className="version-history" role="dialog" aria-modal="true" aria-label="Version history" data-testid="version-history">
      <header className="version-history-header">
        <button ref={closeButton} type="button" className="icon-btn" aria-label="Close version history" title="Close version history" onClick={onClose}>
          <ArrowLeft size={20} />
        </button>
        <div className="version-history-title">
          <h2>{current ? versionTitle(current) : 'Version history'}</h2>
          {current?.name && <span className="muted">{formatDateTime(current.createdAt)}</span>}
        </div>
        <span className="spacer" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!current || !preview || !('doc' in preview)}
          onClick={() => setConfirming(true)}
          data-testid="restore-version"
        >
          Restore this version
        </button>
      </header>
      <div className="version-history-body">
        <div className="version-preview">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {!selected ? (
            versions && (
              <div className="version-empty">
                <History size={40} />
                <p>No versions yet. Versions are saved automatically as you edit, or you can name the current version.</p>
              </div>
            )
          ) : !preview ? (
            <Spinner label="Loading version" />
          ) : 'error' in preview ? (
            <p className="form-error">{preview.error}</p>
          ) : (
            renderPreview(preview.doc)
          )}
        </div>
        <aside className="version-list" aria-label="Versions">
          <div className="version-list-header">
            <h3>Version history</h3>
            <button type="button" className="btn btn-sm" onClick={() => setNaming('current')} data-testid="name-current-version">
              Name current version
            </button>
          </div>
          <label className="checkbox-field version-filter">
            <input type="checkbox" checked={namedOnly} onChange={(event) => setNamedOnly(event.target.checked)} />
            Only show named versions
          </label>
          {!versions ? (
            <Spinner label="Loading versions" />
          ) : (
            <ul>
              {shown.map((version) => (
                <li key={version.id} className={version.id === selected ? 'selected' : ''}>
                  <button type="button" className="version-item" aria-current={version.id === selected} onClick={() => setSelected(version.id)}>
                    <strong>{versionTitle(version)}</strong>
                    <span className="muted">
                      {version.name ? `${formatDateTime(version.createdAt)} · ` : ''}
                      {version.auto ? 'Saved automatically' : (version.createdByName ?? 'Unknown')}
                    </span>
                  </button>
                  <Dropdown
                    align="end"
                    label="Version actions"
                    items={[
                      { label: version.name ? 'Rename version' : 'Name this version', onSelect: () => setNaming(version) },
                      {
                        label: 'Restore this version',
                        onSelect: () => {
                          setSelected(version.id);
                          setConfirming(true);
                        },
                      },
                    ]}
                    trigger={(props) => (
                      <button type="button" className="icon-btn icon-btn-sm" aria-label="More actions" {...props}>
                        <EllipsisVertical size={16} />
                      </button>
                    )}
                  />
                </li>
              ))}
              {!shown.length && <li className="muted version-none">{namedOnly ? 'No named versions.' : 'No versions yet.'}</li>}
            </ul>
          )}
        </aside>
      </div>
      {naming && (
        <PromptDialog
          title={naming === 'current' ? 'Name current version' : 'Name this version'}
          label="Version name"
          initial={naming === 'current' ? '' : (naming.name ?? '')}
          confirmLabel="Save"
          onSubmit={name}
          onClose={() => setNaming(null)}
        />
      )}
      {confirming && current && (
        <ConfirmDialog
          title="Restore this version?"
          message={`The document will be replaced with “${versionTitle(current)}”. The current content is saved as a version first, so you can undo this.`}
          confirmLabel="Restore"
          onConfirm={restore}
          onClose={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
