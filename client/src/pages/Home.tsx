import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  Clock,
  Code2,
  Copy,
  ExternalLink,
  FilePlus2,
  FileText,
  FileUp,
  FolderOpen,
  LayoutGrid,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import type { FileMeta, FileType, FileView, SearchResult } from '@shared/types';
import { api, errorMessage } from '../api';
import { useUser } from '../auth';
import { ConfirmDialog, PromptDialog } from '../components/Dialog';
import { Dropdown, separator, type MenuEntry } from '../components/Menu';
import { ShareDialog } from '../components/ShareDialog';
import { useToast } from '../components/Toast';
import { EmptyState, FileTypeIcon, Logo, Spinner } from '../components/ui';
import { UserMenu } from '../components/AppHeader';
import { DOC_IMPORT_ACCEPT, DOC_IMPORT_EXTENSIONS, extensionOf, readTextFile, stripExtension } from '../lib/files';
import { CODE_TEMPLATES, DOC_TEMPLATES, setInitialContent, type InitialContent } from '../lib/templates';
import { TYPE_LABELS, fileUrl, formatTime, pickFile, useDebounced } from '../lib/util';

const VIEWS: { id: FileView; label: string; icon: ReactNode }[] = [
  { id: 'recent', label: 'Recent', icon: <Clock size={18} /> },
  { id: 'mine', label: 'My files', icon: <FolderOpen size={18} /> },
  { id: 'shared', label: 'Shared with me', icon: <Users size={18} /> },
  { id: 'starred', label: 'Starred', icon: <Star size={18} /> },
  { id: 'trash', label: 'Trash', icon: <Trash2 size={18} /> },
];

type Dialogs =
  | { kind: 'rename'; file: FileMeta }
  | { kind: 'share'; file: FileMeta }
  | { kind: 'delete'; file: FileMeta }
  | null;

export function Home() {
  const user = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS.some((entry) => entry.id === params.get('view')) ? params.get('view') : 'recent') as FileView;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const query = useDebounced(search.trim(), 250);
  const [typeFilter, setTypeFilter] = useState<FileType | ''>('');
  const [files, setFiles] = useState<(FileMeta | SearchResult)[] | null>(null);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = query ? await api.search(query, typeFilter || undefined) : await api.listFiles(view, typeFilter || undefined);
      setFiles(result.files);
    } catch (error) {
      toast.error(error);
      setFiles([]);
    }
  }, [query, view, typeFilter, toast]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  useEffect(() => {
    document.title = 'TitoDocs';
  }, []);

  const create = async (input: Parameters<typeof api.createFile>[0], initial?: InitialContent) => {
    setBusy(true);
    try {
      const { file } = await api.createFile(input);
      if (initial) setInitialContent(file.id, initial);
      if (file.type === 'workspace') {
        const { file: page } = await api.createFile({ type: 'page', workspaceId: file.id, title: 'Welcome', icon: '👋' });
        navigate(fileUrl(page));
      } else {
        navigate(fileUrl(file));
      }
    } catch (error) {
      toast.error(error);
    } finally {
      setBusy(false);
    }
  };

  /** Opens a local file: rich documents become docs, anything else opens in the code editor. */
  const importFile = async (file: File) => {
    setBusy(true);
    try {
      const extension = extensionOf(file.name);
      if (DOC_IMPORT_EXTENSIONS.includes(extension) && extension !== 'txt') {
        const { fileToHtml } = await import('../docs/importers');
        await create({ type: 'doc', title: stripExtension(file.name) }, { kind: 'html', html: await fileToHtml(file) });
      } else {
        const { text, encoding } = await readTextFile(file);
        await create({ type: 'code', title: file.name }, { kind: 'text', text, encoding });
      }
    } catch (error) {
      toast.show(`Could not open ${file.name}: ${errorMessage(error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const importDocument = async () => {
    const file = await pickFile(DOC_IMPORT_ACCEPT);
    if (!file) return;
    if (extensionOf(file.name) !== 'txt') return importFile(file);
    // From "Import document", plain text becomes a document rather than a code file.
    const { fileToHtml } = await import('../docs/importers');
    await create({ type: 'doc', title: stripExtension(file.name) }, { kind: 'html', html: await fileToHtml(file) });
  };

  const openTextFile = async () => {
    const file = await pickFile('*/*');
    if (file) await importFile(file);
  };

  const newMenu: MenuEntry[] = [
    { label: 'Document', icon: <FileText size={16} className="type-doc" />, onSelect: () => create({ type: 'doc' }), testId: 'new-doc' },
    {
      label: 'Code / text file',
      icon: <Code2 size={16} className="type-code" />,
      onSelect: () => create({ type: 'code' }),
      testId: 'new-code',
    },
    {
      label: 'Workspace (Loop)',
      icon: <LayoutGrid size={16} className="type-workspace" />,
      onSelect: () => create({ type: 'workspace', icon: '🚀' }),
      testId: 'new-workspace',
    },
    separator,
    { label: 'Import document (.docx, .md, .html, .txt)…', icon: <FileUp size={16} />, onSelect: importDocument },
    { label: 'Open text or code file…', icon: <Upload size={16} />, onSelect: openTextFile },
  ];

  const fileActions = (file: FileMeta): MenuEntry[] => {
    if (file.trashedAt) {
      return [
        {
          label: 'Restore',
          icon: <RotateCcw size={16} />,
          onSelect: async () => {
            await api.restore(file.id).catch((error) => toast.error(error));
            toast.show(`Restored “${file.title}”`);
            void load();
          },
        },
        {
          label: 'Delete forever',
          icon: <Trash2 size={16} />,
          danger: true,
          onSelect: () => setDialog({ kind: 'delete', file }),
        },
      ];
    }
    const editable = file.role === 'owner' || file.role === 'editor';
    return [
      { label: 'Open in new tab', icon: <ExternalLink size={16} />, onSelect: () => window.open(fileUrl(file), '_blank', 'noopener') },
      { label: 'Rename', icon: <Pencil size={16} />, disabled: !editable, onSelect: () => setDialog({ kind: 'rename', file }) },
      { label: 'Share', icon: <Share2 size={16} />, onSelect: () => setDialog({ kind: 'share', file }) },
      {
        label: 'Make a copy',
        icon: <Copy size={16} />,
        disabled: file.type !== 'doc' && file.type !== 'code',
        onSelect: async () => {
          try {
            const { file: copy } = await api.duplicate(file.id);
            toast.show(`Created “${copy.title}”`, { action: { label: 'Open', onClick: () => navigate(fileUrl(copy)) } });
            void load();
          } catch (error) {
            toast.error(error);
          }
        },
      },
      {
        label: file.starred ? 'Remove from starred' : 'Add to starred',
        icon: <Star size={16} />,
        onSelect: async () => {
          await api.star(file.id, !file.starred).catch((error) => toast.error(error));
          void load();
        },
      },
      separator,
      {
        label: 'Move to trash',
        icon: <Trash2 size={16} />,
        danger: true,
        disabled: file.ownerId !== user.id,
        onSelect: async () => {
          try {
            await api.trash(file.id);
            toast.show(`Moved “${file.title}” to trash`, {
              action: {
                label: 'Undo',
                onClick: () => void api.restore(file.id).then(load),
              },
            });
            void load();
          } catch (error) {
            toast.error(error);
          }
        },
      },
    ];
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const [file] = event.dataTransfer.files;
    if (file) void importFile(file);
  };

  const heading = query ? `Results for “${query}”` : VIEWS.find((entry) => entry.id === view)!.label;

  return (
    <div className="home">
      <header className="home-header">
        <Link to="/" className="home-brand" onClick={() => setSearch('')}>
          <Logo size={34} />
          <span>TitoDocs</span>
        </Link>
        <div className="search-box">
          <Search size={18} aria-hidden />
          <input
            type="search"
            aria-label="Search files and their contents"
            placeholder="Search files and their contents"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button className="icon-btn icon-btn-sm" aria-label="Clear search" onClick={() => setSearch('')}>
              <X size={16} />
            </button>
          )}
        </div>
        <UserMenu />
      </header>

      <div className="home-body">
        <nav className="home-nav" aria-label="File views">
          <Dropdown
            label="New"
            items={newMenu}
            trigger={(props) => (
              <button className="btn btn-new" disabled={busy} data-testid="new-button" {...props}>
                <Plus size={20} /> New
              </button>
            )}
          />
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              className={`nav-item ${view === entry.id && !query ? 'active' : ''}`}
              aria-current={view === entry.id && !query ? 'page' : undefined}
              onClick={() => {
                setSearch('');
                setParams(entry.id === 'recent' ? {} : { view: entry.id });
              }}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </nav>

        <main
          className={`home-main ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              setDragging(true);
            }
          }}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setDragging(false);
          }}
          onDrop={onDrop}
        >
          {view === 'recent' && !query && (
            <section className="templates" aria-labelledby="templates-title">
              <h2 id="templates-title">Start something new</h2>
              <div className="template-row">
                {DOC_TEMPLATES.map((make) => {
                  const template = make();
                  return (
                    <button
                      key={template.id}
                      className="template-card"
                      data-testid={`template-${template.id}`}
                      disabled={busy}
                      onClick={() =>
                        create(
                          { type: 'doc', title: template.title },
                          template.html ? { kind: 'html', html: template.html } : undefined,
                        )
                      }
                    >
                      <div className={`template-thumb template-${template.id}`} aria-hidden>
                        {template.id === 'blank' ? <FilePlus2 size={36} /> : <TemplateLines />}
                      </div>
                      <strong>{template.name}</strong>
                      <span className="muted">{template.description}</span>
                    </button>
                  );
                })}
                <button
                  className="template-card"
                  disabled={busy}
                  onClick={() => create({ type: 'workspace', title: 'Team workspace', icon: '🚀' })}
                >
                  <div className="template-thumb template-workspace" aria-hidden>
                    <LayoutGrid size={36} />
                  </div>
                  <strong>Workspace</strong>
                  <span className="muted">Loop-style pages &amp; live components</span>
                </button>
              </div>
              <div className="code-templates">
                <span className="muted">Code &amp; text:</span>
                {CODE_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    className="chip"
                    disabled={busy}
                    onClick={() =>
                      create({ type: 'code', title: template.title }, template.text ? { kind: 'text', text: template.text } : undefined)
                    }
                  >
                    <Code2 size={14} /> {template.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="file-section" aria-labelledby="files-title">
            <div className="file-section-header">
              <h2 id="files-title">{heading}</h2>
              <select aria-label="Filter by type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as FileType | '')}>
                <option value="">All types</option>
                <option value="doc">Documents</option>
                <option value="code">Code files</option>
                <option value="workspace">Workspaces</option>
                {query && <option value="page">Pages</option>}
              </select>
            </div>
            {view === 'trash' && !query && (
              <p className="hint">Files in the trash can be restored. Deleting them forever cannot be undone.</p>
            )}
            {files === null ? (
              <Spinner />
            ) : files.length === 0 ? (
              <EmptyState icon={<FolderOpen size={40} />} title={query ? 'No matching files' : 'Nothing here yet'}>
                {!query && view === 'recent' && <p>Create a document above, or drop files here to import them.</p>}
              </EmptyState>
            ) : (
              <table className="file-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="col-owner">Owner</th>
                    <th className="col-date">{view === 'trash' ? 'Trashed' : 'Last modified'}</th>
                    <th className="col-actions">
                      <span className="visually-hidden">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => (
                    <tr key={file.id} className="file-row">
                      <td>
                        {file.trashedAt ? (
                          <span className="file-name">
                            <FileTypeIcon type={file.type} icon={file.icon} />
                            <span>{file.title}</span>
                          </span>
                        ) : (
                          <Link to={fileUrl(file)} className="file-name">
                            <FileTypeIcon type={file.type} icon={file.icon} />
                            <span>
                              {file.title}
                              {'snippet' in file && file.snippet && <span className="snippet">{file.snippet}</span>}
                            </span>
                            {file.starred && <Star size={14} className="starred-mark" aria-label="Starred" />}
                            {file.linkAccess !== 'none' && <Users size={14} className="muted" aria-label="Shared by link" />}
                          </Link>
                        )}
                        <span className="type-label">{TYPE_LABELS[file.type]}</span>
                      </td>
                      <td className="col-owner">{file.ownerId === user.id ? 'me' : file.ownerName}</td>
                      <td className="col-date">
                        {formatTime(file.trashedAt ?? file.updatedAt)}
                        {!file.trashedAt && file.updatedByName && <span className="muted"> · {file.updatedByName}</span>}
                      </td>
                      <td className="col-actions">
                        <Dropdown
                          align="end"
                          label={`Actions for ${file.title}`}
                          items={() => fileActions(file)}
                          trigger={(props) => (
                            <button className="icon-btn" aria-label={`More actions for ${file.title}`} {...props}>
                              <MoreVertical size={18} />
                            </button>
                          )}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          {dragging && (
            <div className="drop-overlay">
              <Upload size={40} />
              <p>Drop to import (.docx, .md and .html become documents; other text files open in the code editor)</p>
            </div>
          )}
        </main>
      </div>

      {dialog?.kind === 'rename' && (
        <PromptDialog
          title="Rename"
          label="New name"
          initial={dialog.file.title}
          confirmLabel="Rename"
          onClose={() => setDialog(null)}
          onSubmit={async (title) => {
            try {
              await api.updateFile(dialog.file.id, { title });
              void load();
            } catch (error) {
              toast.error(error);
            }
          }}
        />
      )}
      {dialog?.kind === 'share' && <ShareDialog file={dialog.file} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete forever?"
          message={`“${dialog.file.title}” will be deleted permanently. You can't undo this.`}
          confirmLabel="Delete forever"
          danger
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            try {
              await api.deleteForever(dialog.file.id);
              void load();
            } catch (error) {
              toast.error(error);
            }
          }}
        />
      )}
    </div>
  );
}

function TemplateLines() {
  return (
    <svg viewBox="0 0 60 70" width="60" height="70" aria-hidden>
      <rect x="8" y="8" width="44" height="6" rx="2" fill="currentColor" opacity="0.7" />
      {[20, 27, 34, 41, 48, 55].map((y) => (
        <rect key={y} x="8" y={y} width={y % 2 ? 36 : 44} height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      ))}
    </svg>
  );
}
