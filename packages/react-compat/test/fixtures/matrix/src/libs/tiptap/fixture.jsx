import { useState } from 'react';
import { useEditor, useEditorState, EditorContent, NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer, Node, mergeAttributes } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

// An inline atom drawn by React inside ProseMirror's DOM: a chip that shows a
// mark when it is selected (a child that is there or not: a hole).
function ChipView({ node, selected }) {
  return (
    <NodeViewWrapper as="span" className="chip" data-label={node.attrs.label}>
      {selected ? <b className="chip-sel">*</b> : null}
      {node.attrs.label}
      {false}
    </NodeViewWrapper>
  );
}
const Chip = Node.create({
  name: 'chip',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() { return { label: { default: 'chip' } }; },
  parseHTML() { return [{ tag: 'span[data-chip]' }]; },
  renderHTML({ HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-chip': '' })]; },
  addNodeView() { return ReactNodeViewRenderer(ChipView); },
});

// A block whose content ProseMirror edits, inside a wrapper React draws: an
// icon, a hint while it is empty, then the editable content.
function CalloutView({ node }) {
  return (
    <NodeViewWrapper className="callout">
      <span className="callout-icon" contentEditable={false}>!</span>
      {node.textContent.length === 0 && <i className="callout-empty" contentEditable={false}>empty</i>}
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}
const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'inline*',
  parseHTML() { return [{ tag: 'div[data-callout]' }]; },
  renderHTML({ HTMLAttributes }) { return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '' }), 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

const read = (e) => ({
  text: e.getText(),
  bold: e.isActive('bold'),
  canUndo: e.can().undo(),
  chips: e.$nodes('chip')?.length ?? 0,
  callouts: e.$nodes('callout')?.length ?? 0,
});

export default function Fixture() {
  const [chips, setChips] = useState(0);
  const editor = useEditor({
    extensions: [StarterKit, Chip, Callout],
    content: '<p>Hello</p>',
    // The same first render on a server and in the browser: the editor is
    // made after mounting.
    immediatelyRender: false,
  });
  // The toolbar's state, read again on each transaction (until the first
  // one, useEditorState still has the snapshot from before the editor).
  const state = useEditorState({ editor, selector: ({ editor: e }) => (e ? read(e) : null) }) ?? (editor ? read(editor) : null);
  if (!editor || !state) return <div id="tt-loading">loading</div>;
  return (
    <div>
      <div className="toolbar">
        <button id="tt-bold" aria-pressed={state.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
        <button id="tt-undo" disabled={!state.canUndo} onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().undo().run()}>undo</button>
        <button id="tt-chip" onMouseDown={(e) => e.preventDefault()} onClick={() => { const n = chips + 1; setChips(n); editor.chain().focus().insertContent({ type: 'chip', attrs: { label: 'chip ' + n } }).run(); }}>chip</button>
        <button id="tt-callout" onMouseDown={(e) => e.preventDefault()} onClick={() => editor.chain().focus().insertContent({ type: 'callout' }).run()}>callout</button>
        {state.bold && <span id="tt-bold-on">bold</span>}
      </div>
      <EditorContent editor={editor} id="tt-editor" />
      <output id="tt-text">{state.text}</output>
      <output id="tt-count">{`${state.chips} chips, ${state.callouts} callouts`}</output>
    </div>
  );
}
