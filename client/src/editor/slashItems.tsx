import type { Editor } from '@tiptap/core';
import {
  AtSign,
  CalendarDays,
  ChevronRight,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Pilcrow,
  Quote,
  Scissors,
  Table,
} from 'lucide-react';
import type { SlashItem } from './suggestions';

export interface SlashOptions {
  /** Opens the image picker. */
  onImage?: (editor: Editor) => void;
  /** Documents only: page breaks and tables of contents. */
  documentBlocks?: boolean;
}

const ICON = 18;

export const today = (): string =>
  new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

/** Blocks offered by the "/" menu in documents and Loop pages. */
export function basicSlashItems({ onImage, documentBlocks = false }: SlashOptions = {}): SlashItem[] {
  const basic = 'Basic blocks';
  const insert = 'Insert';
  const items: SlashItem[] = [
    {
      id: 'text',
      title: 'Text',
      description: 'Plain paragraph',
      icon: <Pilcrow size={ICON} />,
      group: basic,
      keywords: 'paragraph normal',
      run: (editor) => editor.chain().focus().setParagraph().run(),
    },
    {
      id: 'h1',
      title: 'Heading 1',
      description: 'Large section heading',
      icon: <Heading1 size={ICON} />,
      group: basic,
      keywords: 'title h1',
      run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      id: 'h2',
      title: 'Heading 2',
      description: 'Medium section heading',
      icon: <Heading2 size={ICON} />,
      group: basic,
      keywords: 'subtitle h2',
      run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      id: 'h3',
      title: 'Heading 3',
      description: 'Small section heading',
      icon: <Heading3 size={ICON} />,
      group: basic,
      keywords: 'h3',
      run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      id: 'bullets',
      title: 'Bulleted list',
      icon: <List size={ICON} />,
      group: basic,
      keywords: 'unordered ul',
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
    },
    {
      id: 'numbers',
      title: 'Numbered list',
      icon: <ListOrdered size={ICON} />,
      group: basic,
      keywords: 'ordered ol',
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      id: 'checklist',
      title: 'Checklist',
      description: 'Track tasks with checkboxes',
      icon: <ListChecks size={ICON} />,
      group: basic,
      keywords: 'todo task checkbox',
      run: (editor) => editor.chain().focus().toggleTaskList().run(),
    },
    {
      id: 'quote',
      title: 'Quote',
      icon: <Quote size={ICON} />,
      group: basic,
      keywords: 'blockquote citation',
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      id: 'code',
      title: 'Code block',
      description: 'With syntax highlighting',
      icon: <Code2 size={ICON} />,
      group: basic,
      keywords: 'snippet pre',
      run: (editor) => editor.chain().focus().setCodeBlock().run(),
    },
    {
      id: 'details',
      title: 'Collapsible section',
      description: 'Content that can be expanded',
      icon: <ChevronRight size={ICON} />,
      group: basic,
      keywords: 'toggle details summary accordion',
      run: (editor) => editor.chain().focus().setDetails().run(),
    },
    {
      id: 'table',
      title: 'Table',
      description: '3 × 3 with a header row',
      icon: <Table size={ICON} />,
      group: insert,
      keywords: 'grid',
      run: (editor) => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'divider',
      title: 'Divider',
      description: 'Horizontal line',
      icon: <Minus size={ICON} />,
      group: insert,
      keywords: 'hr rule separator line',
      run: (editor) => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      id: 'date',
      title: "Today's date",
      icon: <CalendarDays size={ICON} />,
      group: insert,
      keywords: 'time now day',
      run: (editor) => editor.chain().focus().insertContent(today()).run(),
    },
    {
      id: 'mention',
      title: 'Mention a person',
      description: 'Notify someone with @',
      icon: <AtSign size={ICON} />,
      group: insert,
      keywords: 'person user people @',
      run: (editor) => editor.chain().focus().insertContent('@').run(),
    },
  ];
  if (onImage) {
    items.splice(10, 0, {
      id: 'image',
      title: 'Image',
      description: 'Upload from your computer',
      icon: <ImageIcon size={ICON} />,
      group: insert,
      keywords: 'picture photo upload',
      run: onImage,
    });
  }
  if (documentBlocks) {
    items.push(
      {
        id: 'toc',
        title: 'Table of contents',
        description: 'Updates as you add headings',
        icon: <ListTree size={ICON} />,
        group: insert,
        keywords: 'toc outline index',
        run: (editor) => editor.chain().focus().insertTableOfContents().run(),
      },
      {
        id: 'page-break',
        title: 'Page break',
        description: 'Start a new page when printing',
        icon: <Scissors size={ICON} />,
        group: insert,
        keywords: 'new page',
        run: (editor) => editor.chain().focus().setPageBreak().run(),
      },
    );
  }
  return items;
}
