// What Framework Playground — Main Entry Point

import { createEditor } from './editor.js';
import { createPreview } from './preview.js';
import { createConsolePanel } from './console.js';
import { examples } from './examples.js';
import { readHash, updateHash, getShareURL, copyToClipboard } from './share.js';
import './styles.css';

// --- State ---
let currentExampleId = 'hello-world';
let currentCode = '';
let isDark = true;
let editor = null;
let preview = null;
let consolePanel = null;
let lastCompiled = null; // { ok, code?, error? } — latest compiler result
let showCompiled = false;

// --- DOM References ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// --- Initialize ---
function init() {
  // Check for shared code in URL
  const hash = readHash();
  if (hash.code) {
    currentCode = hash.code;
    currentExampleId = hash.exampleId || 'custom';
  } else {
    const example = examples.find((e) => e.id === currentExampleId);
    currentCode = example ? example.code : examples[0].code;
  }

  // Check system theme preference
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    isDark = false;
    document.documentElement.setAttribute('data-theme', 'light');
  }

  // Build the example selector
  buildExampleSelector();

  // Set up the code editor
  const editorContainer = $('#editor-container');
  editor = createEditor(editorContainer, currentCode, handleCodeChange, isDark);

  // Set up the preview iframe
  const previewContainer = $('#preview-container');
  consolePanel = createConsolePanel($('#console-panel'));
  preview = createPreview(
    previewContainer,
    (msg) => consolePanel.addMessage(msg),
    (err) => consolePanel.addError(err),
    (result) => {
      lastCompiled = result;
      renderCompiledOutput();
    }
  );

  // Initial run
  preview.run(currentCode);

  // Wire up controls
  setupControls();

  // Set up resizable splitter
  setupSplitter();

  // Highlight active example
  updateActiveExample();

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Cmd/Ctrl+S — run code
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      preview.run(currentCode);
    }
  });
}

function handleCodeChange(code) {
  currentCode = code;
  preview.run(code);
  updateHash(code, currentExampleId);
}

function buildExampleSelector() {
  const selector = $('#example-selector');
  selector.innerHTML = '';

  examples.forEach((example) => {
    const option = document.createElement('option');
    option.value = example.id;
    option.textContent = example.title;
    if (example.id === currentExampleId) {
      option.selected = true;
    }
    selector.appendChild(option);
  });

  selector.addEventListener('change', (e) => {
    loadExample(e.target.value);
  });

  // Also build the mobile tab bar
  const tabBar = $('#example-tabs');
  if (tabBar) {
    tabBar.innerHTML = '';
    examples.forEach((example) => {
      const tab = document.createElement('button');
      tab.className = `example-tab${example.id === currentExampleId ? ' active' : ''}`;
      tab.dataset.id = example.id;
      tab.textContent = example.title;
      tab.title = example.description;
      tab.addEventListener('click', () => loadExample(example.id));
      tabBar.appendChild(tab);
    });
  }
}

function loadExample(id) {
  const example = examples.find((e) => e.id === id);
  if (!example) return;

  currentExampleId = id;
  currentCode = example.code;
  editor.setCode(example.code);
  consolePanel.clear();
  preview.run(example.code);
  updateActiveExample();
  updateHash(example.code, id);

  // Update selector
  const selector = $('#example-selector');
  if (selector) selector.value = id;

  // Update description
  const desc = $('#example-description');
  if (desc) desc.textContent = example.description;
}

function updateActiveExample() {
  $$('.example-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.id === currentExampleId);
  });

  // Update description
  const example = examples.find((e) => e.id === currentExampleId);
  const desc = $('#example-description');
  if (desc && example) {
    desc.textContent = example.description;
  }
}

// --- Compiled output toggle (T5-03) ---
// The ONLY place compiled / h()-style code is shown — clearly labeled.
function renderCompiledOutput() {
  if (!showCompiled) return;
  const codeEl = document.querySelector('#compiled-container code');
  if (!codeEl) return;
  if (!lastCompiled) {
    codeEl.textContent = '// Compiling…';
  } else if (lastCompiled.ok) {
    codeEl.textContent = lastCompiled.code;
  } else {
    const { message, line, col } = lastCompiled.error;
    codeEl.textContent = `// Compile error${line ? ` (playground.jsx:${line}:${col})` : ''}\n// ${message}`;
  }
}

function toggleCompiledView() {
  showCompiled = !showCompiled;
  const pane = $('#pane-editor');
  const btn = $('#btn-compiled');
  const compiledEl = $('#compiled-container');
  const title = $('#editor-pane-title');

  pane.classList.toggle('show-compiled', showCompiled);
  btn.classList.toggle('active', showCompiled);
  compiledEl.hidden = !showCompiled;
  if (title) title.textContent = showCompiled ? 'Compiled output (read-only)' : 'Editor';
  renderCompiledOutput();
}

function setupControls() {
  // Compiled output toggle
  $('#btn-compiled')?.addEventListener('click', toggleCompiledView);

  // Share button
  $('#btn-share')?.addEventListener('click', async () => {
    const url = getShareURL(currentCode, currentExampleId);
    const ok = await copyToClipboard(url);
    const btn = $('#btn-share');
    if (ok) {
      btn.classList.add('copied');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 8 6.5 11.5 13 5"/></svg><span>Copied!</span>`;
      setTimeout(() => {
        btn.innerHTML = originalHTML;
        btn.classList.remove('copied');
      }, 2000);
    }
  });

  // Reset button
  $('#btn-reset')?.addEventListener('click', () => {
    const example = examples.find((e) => e.id === currentExampleId);
    if (example) {
      currentCode = example.code;
      editor.setCode(example.code);
      consolePanel.clear();
      preview.run(example.code);
    }
  });

  // Run button
  $('#btn-run')?.addEventListener('click', () => {
    consolePanel.clear();
    preview.run(currentCode);
  });

  // Theme toggle
  $('#btn-theme')?.addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    // Recreate editor with new theme
    const editorContainer = $('#editor-container');
    const code = currentCode;
    editor.view.destroy();
    editorContainer.innerHTML = '';
    editor = createEditor(editorContainer, code, handleCodeChange, isDark);

    // Update icon
    updateThemeIcon();
  });

  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = $('#btn-theme');
  if (!btn) return;
  btn.innerHTML = isDark
    ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M2.9 2.9l1.4 1.4m7.4 7.4l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 10A7 7 0 016 2a7 7 0 108 8z"/></svg>`;
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

function setupSplitter() {
  const splitter = $('#splitter');
  const editorPane = $('#pane-editor');
  const previewPane = $('#pane-preview');
  const container = $('#split-container');

  if (!splitter || !editorPane || !previewPane || !container) return;

  let isDragging = false;
  let startX = 0;
  let startWidth = 0;

  splitter.addEventListener('mousedown', (e) => {
    isDragging = true;
    startX = e.clientX;
    startWidth = editorPane.getBoundingClientRect().width;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    splitter.classList.add('active');
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const containerWidth = container.getBoundingClientRect().width;
    const newWidth = Math.max(300, Math.min(containerWidth - 300, startWidth + dx));
    const pct = (newWidth / containerWidth) * 100;
    editorPane.style.width = `${pct}%`;
    previewPane.style.width = `${100 - pct}%`;
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      splitter.classList.remove('active');
    }
  });
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', init);
