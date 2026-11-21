// Open files as tabs, like Notepad++'s document tabs. The list is kept per browser.
import { Link } from 'react-router';
import { FileCode2, Plus, X } from 'lucide-react';

export interface CodeTab {
  id: string;
  title: string;
}

const MAX_TABS = 20;

export const isCodeTab = (value: unknown): value is CodeTab =>
  !!value && typeof value === 'object' && typeof (value as CodeTab).id === 'string' && typeof (value as CodeTab).title === 'string';

/** Adds a tab (dropping the oldest beyond the limit) or updates its title. */
export function upsertTab(tabs: CodeTab[], tab: CodeTab): CodeTab[] {
  const index = tabs.findIndex((existing) => existing.id === tab.id);
  if (index >= 0) return tabs[index]!.title === tab.title ? tabs : tabs.map((existing) => (existing.id === tab.id ? tab : existing));
  return [...tabs, tab].slice(-MAX_TABS);
}

interface TabsProps {
  tabs: CodeTab[];
  current: string;
  onClose: (id: string) => void;
  onNew: () => void;
}

export function Tabs({ tabs, current, onClose, onNew }: TabsProps) {
  return (
    <nav className="code-tabs no-print" aria-label="Open files" data-testid="code-tabs">
      <ul>
        {tabs.map((tab) => (
          <li key={tab.id} className={`code-tab ${tab.id === current ? 'active' : ''}`}>
            <Link
              to={`/code/${tab.id}`}
              className="code-tab-link"
              aria-current={tab.id === current ? 'page' : undefined}
              title={tab.title}
              onMouseDown={(event) => {
                // Middle-clicking closes the tab instead of scrolling.
                if (event.button === 1) event.preventDefault();
              }}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(tab.id);
              }}
            >
              <FileCode2 size={14} aria-hidden="true" />
              <span className="code-tab-title">{tab.title}</span>
            </Link>
            <button type="button" className="code-tab-close" aria-label={`Close ${tab.title}`} title="Close tab" onClick={() => onClose(tab.id)}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="icon-btn icon-btn-sm code-tab-new" aria-label="New file" title="New file" onClick={onNew} data-testid="code-new-tab">
        <Plus size={16} />
      </button>
    </nav>
  );
}
