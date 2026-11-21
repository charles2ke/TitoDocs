import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention';
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import type { PublicUser } from '@shared/types';
import { api } from '../api';
import { Avatar } from '../components/ui';

// ------------------------------------------------------------------ popup list

export interface SuggestionListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

interface SuggestionListProps<T> {
  items: T[];
  command: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T) => string;
  getGroup?: (item: T) => string | undefined;
  empty: string;
  loading?: boolean;
  label: string;
  ref?: Ref<SuggestionListHandle>;
}

export function SuggestionList<T>({ items, command, renderItem, getKey, getGroup, empty, loading, label, ref }: SuggestionListProps<T>) {
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [items]);

  useImperativeHandle(ref, () => ({
    onKeyDown(event) {
      if (!items.length) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSelected((index) => (index + step + items.length) % items.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = items[selected];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));

  useEffect(() => {
    document.querySelector('.suggestion-popup [aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div className="suggestion-list" role="listbox" aria-label={label}>
      {items.length === 0 && <div className="suggestion-empty">{loading ? 'Searching…' : empty}</div>}
      {items.map((item, index) => {
        const group = getGroup?.(item);
        const showGroup = group && group !== (index > 0 ? getGroup?.(items[index - 1]!) : undefined);
        return (
          <div key={getKey(item)}>
            {showGroup && <div className="suggestion-group">{group}</div>}
            <button
              type="button"
              role="option"
              aria-selected={index === selected}
              className={`suggestion-item ${index === selected ? 'selected' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => command(item)}
            >
              {renderItem(item)}
            </button>
          </div>
        );
      })}
    </div>
  );
}

type ListConfig<T> = Omit<SuggestionListProps<T>, 'items' | 'command' | 'loading' | 'ref'>;

/** Renders suggestion results in a popup positioned next to the cursor. */
function popupRenderer<T, S = T>(config: ListConfig<T>, toSelected: (item: T) => S): SuggestionOptions<T, S>['render'] {
  return () => {
    let renderer: ReactRenderer<SuggestionListHandle, SuggestionListProps<T>> | null = null;
    let unmount: (() => void) | null = null;
    const toProps = (props: SuggestionProps<T, S>): SuggestionListProps<T> => ({
      ...config,
      items: props.items,
      command: (item) => props.command(toSelected(item)),
      loading: props.loading,
    });
    return {
      onStart(props) {
        renderer = new ReactRenderer(SuggestionList as (props: SuggestionListProps<T>) => ReactNode, {
          props: toProps(props),
          editor: props.editor,
          className: 'suggestion-popup',
        });
        unmount = props.mount(renderer.element as HTMLElement);
      },
      onUpdate(props) {
        renderer?.updateProps(toProps(props));
      },
      onKeyDown({ event }) {
        return renderer?.ref?.onKeyDown(event) ?? false;
      },
      onExit() {
        unmount?.();
        renderer?.destroy();
        renderer = null;
        unmount = null;
      },
    };
  };
}

// ------------------------------------------------------------------ slash commands

export interface SlashItem {
  id: string;
  title: string;
  description?: string;
  icon: ReactNode;
  group: string;
  keywords?: string;
  run: (editor: Editor) => void;
}

export const matchesQuery = (item: Pick<SlashItem, 'title' | 'keywords'>, query: string): boolean => {
  const haystack = `${item.title} ${item.keywords ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
};

const slashList: ListConfig<SlashItem> = {
  label: 'Insert block',
  empty: 'No matching blocks',
  getKey: (item) => item.id,
  getGroup: (item) => item.group,
  renderItem: (item) => (
    <>
      <span className="suggestion-icon">{item.icon}</span>
      <span className="suggestion-text">
        <span>{item.title}</span>
        {item.description && <small>{item.description}</small>}
      </span>
    </>
  ),
};

export interface SlashCommandsOptions {
  items: (editor: Editor) => SlashItem[];
}

/** Type "/" to insert blocks (headings, lists, tables, Loop components, …). */
export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: 'slashCommands',

  addOptions() {
    return { items: () => [] };
  },

  addProseMirrorPlugins() {
    const { items } = this.options;
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommands'),
        char: '/',
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          return !$from.parent.type.spec.code && $from.parent.type.name !== 'heading';
        },
        items: ({ query, editor }) => items(editor).filter((item) => matchesQuery(item, query)).slice(0, 30),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range as Range).run();
          props.run(editor);
        },
        render: popupRenderer(slashList, (item) => item),
      }),
    ];
  },
});

// ------------------------------------------------------------------ @mentions

const mentionList: ListConfig<PublicUser> = {
  label: 'Mention someone',
  empty: 'No matching people',
  getKey: (user) => user.id,
  renderItem: (user) => (
    <>
      <Avatar user={{ name: user.displayName, color: user.color }} size={24} />
      <span className="suggestion-text">
        <span>{user.displayName}</span>
        <small>@{user.username}</small>
      </span>
    </>
  ),
};

const mentionSuggestion: Partial<SuggestionOptions<PublicUser, MentionNodeAttrs>> = {
  char: '@',
  pluginKey: new PluginKey('userMention'),
  debounce: 150,
  items: async ({ query, signal }) => {
    try {
      const { users } = await api.searchUsers(query);
      return signal.aborted ? [] : users.slice(0, 8);
    } catch {
      return [];
    }
  },
  command: ({ editor, range, props }) => {
    // Add a space after the mention, unless one follows already.
    const nodeAfter = editor.view.state.selection.$to.nodeAfter;
    if (nodeAfter?.text?.startsWith(' ')) range.to += 1;
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: 'mention', attrs: { id: props.id, label: props.label } },
        { type: 'text', text: ' ' },
      ])
      .run();
  },
  render: popupRenderer(mentionList, (user): MentionNodeAttrs => ({ id: user.id, label: user.displayName })),
};

/** "@name" mentions of other TitoDocs users. */
export const UserMention = Mention.configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  suggestion: mentionSuggestion,
});
