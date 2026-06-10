// What Framework Playground — CodeMirror 6 Editor Setup

import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, rectangularSelection, highlightSpecialChars } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';

// Custom theme to match What Framework brand colors
const whatTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: '#0a0a0f',
  },
  '.cm-content': {
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    caretColor: '#8b5cf6',
    padding: '12px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#8b5cf6',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(139, 92, 246, 0.06)',
  },
  '.cm-gutters': {
    backgroundColor: '#0a0a0f',
    color: '#3a3a4a',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 8px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 4px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(139, 92, 246, 0.2)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    outline: '1px solid rgba(139, 92, 246, 0.4)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    outline: '1px solid rgba(245, 158, 11, 0.4)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(245, 158, 11, 0.35)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: true });

// Light theme variant
const whatLightTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: '#ffffff',
  },
  '.cm-content': {
    fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
    caretColor: '#8b5cf6',
    padding: '12px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#8b5cf6',
    borderLeftWidth: '2px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(139, 92, 246, 0.04)',
  },
  '.cm-gutters': {
    backgroundColor: '#fafafa',
    color: '#b0b0b0',
    border: 'none',
    borderRight: '1px solid #e8e8ec',
    paddingLeft: '8px',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 12px 0 8px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(139, 92, 246, 0.1)',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    outline: '1px solid rgba(139, 92, 246, 0.3)',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
}, { dark: false });

/**
 * Create a CodeMirror 6 editor instance.
 *
 * @param {HTMLElement} parent - DOM container
 * @param {string} initialCode - Starting code
 * @param {function} onChange - Called with new code on every edit
 * @param {boolean} isDark - Theme
 * @returns {{ view: EditorView, setCode: function, setTheme: function }}
 */
export function createEditor(parent, initialCode, onChange, isDark = true) {
  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      onChange(update.state.doc.toString());
    }
  });

  const extensions = [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    rectangularSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    javascript({ jsx: true }),
    isDark ? whatTheme : whatLightTheme,
    isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
    updateListener,
    EditorView.lineWrapping,
    EditorState.tabSize.of(2),
  ];

  const state = EditorState.create({
    doc: initialCode,
    extensions,
  });

  const view = new EditorView({
    state,
    parent,
  });

  function setCode(code) {
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: code,
      },
    });
  }

  function setTheme(dark) {
    // Recreate the editor with the new theme
    const code = view.state.doc.toString();
    view.destroy();
    const newExtensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      rectangularSelection(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
      javascript({ jsx: true }),
      dark ? whatTheme : whatLightTheme,
      dark ? oneDark : syntaxHighlighting(defaultHighlightStyle),
      updateListener,
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
    ];

    const newState = EditorState.create({
      doc: code,
      extensions: newExtensions,
    });

    const newView = new EditorView({
      state: newState,
      parent,
    });

    // Swap the view reference
    editorInstance.view = newView;
  }

  const editorInstance = { view, setCode, setTheme };
  return editorInstance;
}
