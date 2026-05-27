/**
 * Main entry point — wires up editor, compiler, sandbox, and UI controls.
 */
import { createEditor, setEditorContent, getEditorContent } from './editor.js';
import { compile } from './compiler.js';
import { initSandbox, run } from './sandbox.js';
import { examples } from './examples.js';

// DOM refs
const editorContainer = document.getElementById('editor');
const errorsEl = document.getElementById('errors');
const previewPane = document.getElementById('preview-pane');
const exampleSelect = document.getElementById('example-select');
const runBtn = document.getElementById('run-btn');
const statusEl = document.getElementById('status');
const dragHandle = document.getElementById('drag-handle');

// --- Error display ---
function showError(message) {
  errorsEl.innerHTML = `<pre>${escapeHTML(message)}</pre>`;
  errorsEl.classList.add('visible');
  statusEl.textContent = 'Error';
  statusEl.className = 'status error';
}

function clearErrors() {
  errorsEl.innerHTML = '';
  errorsEl.classList.remove('visible');
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- Compile and run pipeline ---
function compileAndRun(code) {
  clearErrors();

  if (!code.trim()) {
    statusEl.textContent = 'Empty';
    statusEl.className = 'status';
    return;
  }

  const result = compile(code);

  if (!result.ok) {
    showError(result.error);
    return;
  }

  // Send compiled code to the sandbox
  run(result.code);

  statusEl.textContent = 'Running';
  statusEl.className = 'status ok';
}

// --- Runtime error handling (from iframe postMessage) ---
function handleRuntimeError(message) {
  showError(`Runtime error: ${message}`);
}

// --- Init sandbox ---
initSandbox(previewPane, handleRuntimeError);

// --- Init editor ---
const defaultExample = examples.counter.code;
createEditor(editorContainer, defaultExample, (code) => {
  compileAndRun(code);
});

// Initial run
compileAndRun(defaultExample);

// --- Example selector ---
exampleSelect.addEventListener('change', (e) => {
  const ex = examples[e.target.value];
  if (ex) {
    setEditorContent(ex.code);
    compileAndRun(ex.code);
  }
});

// --- Run button (manual trigger + keyboard shortcut) ---
runBtn.addEventListener('click', () => {
  compileAndRun(getEditorContent());
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    compileAndRun(getEditorContent());
  }
});

// --- Drag handle for resizable split ---
let isDragging = false;
const split = document.getElementById('split');

dragHandle.addEventListener('mousedown', (e) => {
  isDragging = true;
  dragHandle.classList.add('active');
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const rect = split.getBoundingClientRect();
  const isVertical = window.innerWidth <= 700;

  if (isVertical) {
    const pct = ((e.clientY - rect.top) / rect.height) * 100;
    const clamped = Math.max(15, Math.min(85, pct));
    document.getElementById('editor-pane').style.flex = `0 0 ${clamped}%`;
    previewPane.style.flex = `0 0 ${100 - clamped}%`;
  } else {
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    const clamped = Math.max(15, Math.min(85, pct));
    document.getElementById('editor-pane').style.flex = `0 0 ${clamped}%`;
    previewPane.style.flex = `0 0 ${100 - clamped}%`;
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    dragHandle.classList.remove('active');
  }
});
