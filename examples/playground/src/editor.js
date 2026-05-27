/**
 * CodeMirror 6 editor setup with JSX highlighting, dark theme, and
 * debounced change callback.
 */
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

let editorView = null;
let debounceTimer = null;

/**
 * Create and mount the editor.
 *
 * @param {HTMLElement} parent - Container element
 * @param {string} initialCode - Starting code
 * @param {(code: string) => void} onChange - Debounced callback when code changes
 * @param {number} [debounceMs=300] - Debounce delay in ms
 * @returns {EditorView}
 */
export function createEditor(parent, initialCode, onChange, debounceMs = 300) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        onChange(update.state.doc.toString());
      }, debounceMs);
    }
  });

  editorView = new EditorView({
    state: EditorState.create({
      doc: initialCode,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        foldGutter(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        javascript({ jsx: true }),
        oneDark,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        updateListener,
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });

  return editorView;
}

/**
 * Replace the editor content programmatically (e.g., when switching examples).
 */
export function setEditorContent(code) {
  if (!editorView) return;
  editorView.dispatch({
    changes: {
      from: 0,
      to: editorView.state.doc.length,
      insert: code,
    },
  });
}

/**
 * Get the current editor content.
 */
export function getEditorContent() {
  if (!editorView) return '';
  return editorView.state.doc.toString();
}
