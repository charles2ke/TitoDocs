// Keyboard macros (Notepad++'s Macro menu): record the keys typed in the editor and play them back.
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { isMac } from '../lib/util';

export type MacroStep =
  | { type: 'key'; key: string; code: string; ctrl: boolean; meta: boolean; alt: boolean; shift: boolean }
  /** A typed character (run through input handlers such as bracket closing). */
  | { type: 'char'; text: string }
  | { type: 'paste'; text: string };

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'OS', 'Dead', 'Process']);

/** Ctrl+Shift+R (start/stop recording) and Ctrl+Shift+P (playback) aren't part of the macro. */
export function isMacroShortcut(event: KeyboardEvent): boolean {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return mod && event.shiftKey && !event.altKey && (event.code === 'KeyR' || event.code === 'KeyP');
}

const isCharacter = (key: string): boolean => [...key].length === 1;

function stepFromKey(event: KeyboardEvent): MacroStep | null {
  if (event.isComposing || event.keyCode === 229 || MODIFIERS.has(event.key) || isMacroShortcut(event)) return null;
  const altGraph = event.getModifierState('AltGraph');
  const plain = !event.ctrlKey && !event.metaKey && (!event.altKey || isMac);
  if (isCharacter(event.key) && (plain || altGraph)) return { type: 'char', text: event.key };
  const { key, code, ctrlKey: ctrl, metaKey: meta, altKey: alt, shiftKey: shift } = event;
  return { type: 'key', key, code, ctrl, meta, alt, shift };
}

/** Passes each key typed (and each paste) into the editor to `record`, which ignores them unless a macro is being recorded. */
export const macroRecorder = (record: (step: MacroStep) => void) =>
  EditorView.domEventObservers({
    keydown(event) {
      const step = stepFromKey(event);
      if (step) record(step);
    },
    paste(event) {
      const text = event.clipboardData?.getData('text/plain');
      if (text) record({ type: 'paste', text });
    },
  });

function typeText(view: EditorView, text: string): void {
  const { state } = view;
  if (state.readOnly) return;
  const { from, to } = state.selection.main;
  const insert = () => view.state.update(view.state.replaceSelection(text), { userEvent: 'input.type', scrollIntoView: true });
  if (state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, text, insert))) return;
  view.dispatch(insert());
}

function playStep(view: EditorView, step: MacroStep): void {
  if (step.type === 'char') {
    typeText(view, step.text);
    return;
  }
  if (step.type === 'paste') {
    if (!view.state.readOnly) view.dispatch(view.state.replaceSelection(step.text), { userEvent: 'input.paste', scrollIntoView: true });
    return;
  }
  const event = new KeyboardEvent('keydown', {
    key: step.key,
    code: step.code,
    ctrlKey: step.ctrl,
    metaKey: step.meta,
    altKey: step.alt,
    shiftKey: step.shift,
    bubbles: true,
    cancelable: true,
  });
  if (runScopeHandlers(view, event, 'editor')) return;
  // Cut is done by the browser, not by a key binding; the macro deletes the selection instead.
  const mod = isMac ? step.meta : step.ctrl;
  if (mod && !step.alt && !step.shift && step.code === 'KeyX' && !view.state.readOnly && !view.state.selection.main.empty) {
    view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
  }
}

export function playMacro(view: EditorView, steps: readonly MacroStep[]): void {
  for (const step of steps) playStep(view, step);
}

/** Plays a macro `times` times, or until the cursor reaches the end of the document. Returns how many times it ran. */
export function playMacroRepeatedly(view: EditorView, steps: readonly MacroStep[], times: number | 'end'): number {
  const limit = times === 'end' ? 100_000 : times;
  let runs = 0;
  while (runs < limit) {
    const before = view.state;
    playMacro(view, steps);
    runs += 1;
    if (times !== 'end') continue;
    const after = view.state;
    const stuck = after.doc.eq(before.doc) && after.selection.eq(before.selection);
    if (stuck || after.selection.main.head >= after.doc.length) break;
  }
  return runs;
}

export function describeMacro(steps: readonly MacroStep[]): string {
  const keys = steps.filter((step) => step.type === 'key').length;
  const typed = steps.filter((step) => step.type !== 'key').length;
  return `${steps.length} ${steps.length === 1 ? 'step' : 'steps'} (${keys} ${keys === 1 ? 'key' : 'keys'}, ${typed} typed or pasted)`;
}

export const isMacroStep = (value: unknown): value is MacroStep => {
  if (!value || typeof value !== 'object') return false;
  const step = value as Record<string, unknown>;
  if (step.type === 'char' || step.type === 'paste') return typeof step.text === 'string';
  return step.type === 'key' && typeof step.key === 'string' && typeof step.code === 'string';
};
