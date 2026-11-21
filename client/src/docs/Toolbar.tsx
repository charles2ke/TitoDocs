import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  ArrowUpDown,
  Bold,
  Eye,
  Highlighter,
  ImagePlus,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  PaintRoller,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RemoveFormatting,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
} from 'lucide-react';
import { Dropdown } from '../components/Menu';
import { ToolButton, ToolDivider, ToolDropdown } from '../components/Toolbar';
import { ColorPalette } from '../editor/ColorPalette';
import { clearFormatting, FONT_FAMILIES, fontStack, MAX_FONT_SIZE, MIN_FONT_SIZE, stepFontSize } from '../editor/commands';
import { shortcut } from '../lib/util';
import {
  ALIGNMENTS,
  LINE_SPACINGS,
  PARAGRAPH_STYLES,
  readFormatState,
  ZOOM_LEVELS,
  type Alignment,
  type DocMode,
} from './formatting';

export const ALIGNMENT_ICONS: Record<Alignment, typeof TextAlignStart> = {
  left: TextAlignStart,
  center: TextAlignCenter,
  right: TextAlignEnd,
  justify: TextAlignJustify,
};

function FontSizeControl({ editor, size }: { editor: Editor; size: number }) {
  const [draft, setDraft] = useState(String(size));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(size));
  }, [size, focused]);

  const apply = (value: number) => {
    const clamped = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value * 2) / 2));
    editor.chain().focus().setFontSize(`${clamped}pt`).run();
  };

  return (
    <div className="font-size-control">
      <ToolButton
        label="Decrease font size"
        keys="Mod-Shift-,"
        icon={<Minus size={16} />}
        disabled={size <= MIN_FONT_SIZE}
        onClick={() => apply(stepFontSize(size, -1))}
      />
      <input
        className="font-size-input"
        aria-label="Font size"
        title="Font size"
        inputMode="decimal"
        value={draft}
        onFocus={(event) => {
          setFocused(true);
          event.target.select();
        }}
        onBlur={() => setFocused(false)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            const value = Number(draft.replace(',', '.'));
            if (Number.isFinite(value) && value > 0) apply(value);
            else {
              setDraft(String(size));
              editor.commands.focus();
            }
          } else if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(String(size));
            editor.commands.focus();
          }
        }}
        data-testid="font-size-input"
      />
      <ToolButton
        label="Increase font size"
        keys="Mod-Shift-."
        icon={<Plus size={16} />}
        disabled={size >= MAX_FONT_SIZE}
        onClick={() => apply(stepFontSize(size, 1))}
      />
    </div>
  );
}

export interface ToolbarProps {
  editor: Editor;
  /** The user may edit the document (they can switch between editing and viewing). */
  canEditFile: boolean;
  canComment: boolean;
  mode: DocMode;
  onModeChange: (mode: DocMode) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  painterActive: boolean;
  onPainter: () => void;
  onPrint: () => void;
  onLink: () => void;
  onComment: () => void;
  onUploadImage: () => void;
  onImageUrl: () => void;
}

/** The Google Docs-style formatting toolbar. */
export function Toolbar(props: ToolbarProps) {
  const { editor } = props;
  const state = useEditorState({ editor, selector: ({ editor: current }) => readFormatState(current) });
  const chain = () => editor.chain().focus();
  const AlignIcon = ALIGNMENT_ICONS[state.align];

  return (
    <div className="app-toolbar no-print" role="toolbar" aria-label="Formatting" data-testid="doc-toolbar">
      {state.editable && (
        <>
          <ToolButton label="Undo" keys="Mod-z" icon={<Undo2 size={18} />} disabled={!state.canUndo} onClick={() => chain().undo().run()} />
          <ToolButton label="Redo" keys="Mod-Shift-z" icon={<Redo2 size={18} />} disabled={!state.canRedo} onClick={() => chain().redo().run()} />
        </>
      )}
      <ToolButton label="Print" keys="Mod-p" icon={<Printer size={18} />} onClick={props.onPrint} />
      {state.editable && (
        <ToolButton
          label="Paint format"
          icon={<PaintRoller size={18} />}
          active={props.painterActive}
          onClick={props.onPainter}
          testId="paint-format"
        />
      )}
      <ToolDropdown
        label="Zoom"
        className="tool-zoom"
        items={() => ZOOM_LEVELS.map((level) => ({ label: `${level}%`, checked: props.zoom === level, onSelect: () => props.onZoomChange(level) }))}
      >
        {props.zoom}%
      </ToolDropdown>

      {state.editable && (
        <>
          <ToolDivider />
          <ToolDropdown
            label="Styles"
            className="tool-style"
            testId="paragraph-style"
            items={() =>
              PARAGRAPH_STYLES.map((style) => ({
                label: style.label,
                checked: state.headingLevel === style.level && state.styleLabel !== 'Code block',
                style: { fontSize: `${Math.max(11, style.size)}pt`, fontWeight: style.level ? 700 : 400, lineHeight: 1.2 },
                shortcut: shortcut(`Mod-Alt-${style.level}`),
                onSelect: () => (style.level ? chain().setHeading({ level: style.level }).run() : chain().setParagraph().run()),
              }))
            }
          >
            <span className="tool-label">{state.styleLabel}</span>
          </ToolDropdown>
          <ToolDivider />
          <ToolDropdown
            label="Font"
            className="tool-font"
            testId="font-family"
            items={() =>
              FONT_FAMILIES.map((name) => ({
                label: name,
                style: { fontFamily: fontStack(name) },
                checked: state.fontFamily === name,
                onSelect: () => chain().setFontFamily(fontStack(name)).run(),
              }))
            }
          >
            <span className="tool-label">{state.fontFamily}</span>
          </ToolDropdown>
          <ToolDivider />
          <FontSizeControl editor={editor} size={state.fontSize} />
          <ToolDivider />
          <ToolButton label="Bold" keys="Mod-b" icon={<Bold size={18} />} active={state.bold} onClick={() => chain().toggleBold().run()} testId="tool-bold" />
          <ToolButton label="Italic" keys="Mod-i" icon={<Italic size={18} />} active={state.italic} onClick={() => chain().toggleItalic().run()} />
          <ToolButton
            label="Underline"
            keys="Mod-u"
            icon={<Underline size={18} />}
            active={state.underline}
            onClick={() => chain().toggleUnderline().run()}
          />
          <Dropdown
            label="Text color"
            items={[
              {
                type: 'custom',
                render: (close) => (
                  <ColorPalette
                    label="Text color"
                    value={state.color}
                    resetLabel="Default color"
                    onReset={() => {
                      close();
                      chain().unsetColor().run();
                    }}
                    onPick={(color, final) => {
                      if (!final) {
                        editor.chain().setColor(color).run();
                        return;
                      }
                      close();
                      chain().setColor(color).run();
                    }}
                  />
                ),
              },
            ]}
            trigger={(triggerProps) => (
              <button type="button" className="tool-btn tool-color" aria-label="Text color" title="Text color" data-testid="text-color" {...triggerProps}>
                <span className="tool-color-letter">A</span>
                <span className="tool-color-bar" style={{ background: state.color ?? 'currentColor' }} />
              </button>
            )}
          />
          <Dropdown
            label="Highlight color"
            items={[
              {
                type: 'custom',
                render: (close) => (
                  <ColorPalette
                    label="Highlight color"
                    value={state.highlight}
                    resetLabel="None"
                    onReset={() => {
                      close();
                      chain().unsetHighlight().run();
                    }}
                    onPick={(color, final) => {
                      if (!final) {
                        editor.chain().setHighlight({ color }).run();
                        return;
                      }
                      close();
                      chain().setHighlight({ color }).run();
                    }}
                  />
                ),
              },
            ]}
            trigger={(triggerProps) => (
              <button type="button" className="tool-btn tool-color" aria-label="Highlight color" title="Highlight color" {...triggerProps}>
                <Highlighter size={16} />
                <span className="tool-color-bar" style={{ background: state.highlight ?? 'transparent' }} />
              </button>
            )}
          />
          <ToolDivider />
          <ToolButton label="Insert link" keys="Mod-k" icon={<Link size={18} />} active={state.link} onClick={props.onLink} testId="tool-link" />
        </>
      )}
      {props.canComment && (
        <ToolButton label="Add comment" keys="Mod-Alt-m" icon={<MessageSquarePlus size={18} />} onClick={props.onComment} testId="tool-comment" />
      )}
      {state.editable && (
        <>
          <Dropdown
            label="Insert image"
            items={[
              { label: 'Upload from computer', onSelect: props.onUploadImage },
              { label: 'By URL…', onSelect: props.onImageUrl },
            ]}
            trigger={(triggerProps) => (
              <button type="button" className="tool-btn" aria-label="Insert image" title="Insert image" {...triggerProps}>
                <ImagePlus size={18} />
              </button>
            )}
          />
          <ToolDivider />
          <ToolDropdown
            label="Align"
            items={() =>
              ALIGNMENTS.map((alignment) => {
                const Icon = ALIGNMENT_ICONS[alignment.value];
                return {
                  label: alignment.label,
                  icon: <Icon size={16} />,
                  shortcut: shortcut(alignment.keys),
                  checked: state.align === alignment.value,
                  onSelect: () => chain().setTextAlign(alignment.value).run(),
                };
              })
            }
          >
            <AlignIcon size={18} />
          </ToolDropdown>
          <ToolDropdown
            label="Line spacing"
            items={() =>
              LINE_SPACINGS.map((spacing) => ({
                label: spacing.label,
                checked: state.lineHeight === spacing.value,
                onSelect: () => chain().setLineHeight(spacing.value).run(),
              }))
            }
          >
            <ArrowUpDown size={18} />
          </ToolDropdown>
          <ToolButton
            label="Checklist"
            keys="Mod-Shift-9"
            icon={<ListChecks size={18} />}
            active={state.taskList}
            onClick={() => chain().toggleTaskList().run()}
          />
          <ToolButton
            label="Bulleted list"
            keys="Mod-Shift-8"
            icon={<List size={18} />}
            active={state.bulletList}
            onClick={() => chain().toggleBulletList().run()}
          />
          <ToolButton
            label="Numbered list"
            keys="Mod-Shift-7"
            icon={<ListOrdered size={18} />}
            active={state.orderedList}
            onClick={() => chain().toggleOrderedList().run()}
          />
          <ToolButton label="Decrease indent" keys="Mod-[" icon={<IndentDecrease size={18} />} onClick={() => chain().outdent().run()} />
          <ToolButton label="Increase indent" keys="Mod-]" icon={<IndentIncrease size={18} />} onClick={() => chain().indent().run()} />
          <ToolButton
            label="Clear formatting"
            keys={'Mod-\\'}
            icon={<RemoveFormatting size={18} />}
            onClick={() => {
              editor.commands.focus();
              clearFormatting(editor);
            }}
          />
        </>
      )}
      <span className="spacer" />
      {props.canEditFile && (
        <ToolDropdown
          label="Mode"
          className="tool-mode"
          align="end"
          testId="mode-switch"
          items={[
            {
              label: 'Editing',
              icon: <Pencil size={16} />,
              checked: props.mode === 'editing',
              onSelect: () => props.onModeChange('editing'),
            },
            {
              label: 'Viewing',
              icon: <Eye size={16} />,
              checked: props.mode === 'viewing',
              onSelect: () => props.onModeChange('viewing'),
            },
          ]}
        >
          {props.mode === 'editing' ? <Pencil size={16} /> : <Eye size={16} />}
          <span className="tool-label">{props.mode === 'editing' ? 'Editing' : 'Viewing'}</span>
        </ToolDropdown>
      )}
    </div>
  );
}
