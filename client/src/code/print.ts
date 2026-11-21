// File ▸ Print: the file with syntax highlighting (and line numbers), laid out for paper by code.css.
import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { classHighlighter, highlightCode } from '@lezer/highlight';

/** Builds the printed copy of the file; it is added to the page while printing only. */
export function buildPrintout(state: EditorState, { title, lineNumbers }: { title: string; lineNumbers: boolean }): HTMLElement {
  const root = document.createElement('div');
  root.className = `code-print ${lineNumbers ? 'numbered' : ''}`;
  root.setAttribute('aria-hidden', 'true');
  const heading = document.createElement('div');
  heading.className = 'code-print-title';
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'code-print-body';
  body.style.tabSize = String(state.tabSize);
  root.append(heading, body);

  const newLine = () => {
    const line = document.createElement('div');
    line.className = 'code-print-line';
    return line;
  };
  let line = newLine();
  const putText = (text: string, classes: string) => {
    if (!classes) {
      line.append(text);
      return;
    }
    const span = document.createElement('span');
    span.className = classes;
    span.textContent = text;
    line.append(span);
  };
  const putBreak = () => {
    body.append(line);
    line = newLine();
  };

  const text = state.doc.toString();
  // If parsing takes over a second (very large files), the file is printed without highlighting.
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  if (tree) {
    highlightCode(text, tree, classHighlighter, putText, putBreak);
  } else {
    text.split('\n').forEach((content, index) => {
      if (index) putBreak();
      putText(content, '');
    });
  }
  body.append(line);
  return root;
}
