/**
 * What Framework — Vite Error Overlay
 *
 * Custom error overlay injected during dev mode. Shows compiler transform errors
 * and runtime signal errors with What Framework branding and helpful context.
 *
 * This is client-side code that Vite injects into the page during development.
 */

// CSS for the overlay — scoped to avoid style conflicts
const OVERLAY_STYLES = `
  :host {
    position: fixed;
    inset: 0;
    z-index: 99999;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.66);
  }

  .panel {
    position: fixed;
    inset: 2rem;
    overflow: auto;
    background: #1a1a2e;
    border: 1px solid #2a2a4a;
    border-radius: 12px;
    box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
    color: #e0e0e0;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #2a2a4a;
    background: #16163a;
    border-radius: 12px 12px 0 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo {
    width: 28px;
    height: 28px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: 14px;
    color: #fff;
  }

  .brand {
    font-size: 14px;
    font-weight: 600;
    color: #a0a0c0;
  }

  .tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
  }

  .tag-error {
    background: #3b1219;
    color: #f87171;
  }

  .tag-warning {
    background: #3b2f19;
    color: #fbbf24;
  }

  .close-btn {
    background: none;
    border: 1px solid #3a3a5a;
    color: #a0a0c0;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }

  .close-btn:hover {
    background: #2a2a4a;
    color: #fff;
  }

  .body {
    padding: 1.5rem;
  }

  .error-title {
    font-size: 16px;
    font-weight: 700;
    color: #f87171;
    margin: 0 0 0.5rem;
  }

  .error-message {
    font-size: 14px;
    color: #e0e0e0;
    margin: 0 0 1rem;
    line-height: 1.6;
    white-space: pre-wrap;
  }

  .file-path {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 12px;
    color: #818cf8;
    margin-bottom: 1rem;
    padding: 0.25rem 0;
  }

  .code-frame {
    background: #0d0d1a;
    border: 1px solid #2a2a4a;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 1rem;
  }

  .code-line {
    display: flex;
    padding: 0 1rem;
    font-size: 13px;
    line-height: 1.7;
  }

  .code-line.highlight {
    background: rgba(248, 113, 113, 0.1);
  }

  .line-number {
    color: #4a4a6a;
    min-width: 3ch;
    text-align: right;
    margin-right: 1rem;
    user-select: none;
  }

  .line-content {
    white-space: pre;
  }

  .tip {
    margin-top: 1rem;
    padding: 0.75rem 1rem;
    background: #1a2744;
    border: 1px solid #1e3a5f;
    border-radius: 8px;
    font-size: 13px;
    color: #93c5fd;
    line-height: 1.5;
  }

  .tip-label {
    font-weight: 700;
    color: #60a5fa;
  }

  .stack {
    margin-top: 1rem;
    font-size: 12px;
    color: #6a6a8a;
    white-space: pre-wrap;
    line-height: 1.5;
  }
`;

/**
 * Build the overlay HTML for an error
 */
function buildOverlayHTML(err) {
  const isCompilerError = err._isCompilerError || err.plugin === 'vite-plugin-what';
  const type = isCompilerError ? 'Compiler Error' : 'Runtime Error';
  const tagClass = isCompilerError ? 'tag-error' : 'tag-warning';

  let codeFrame = '';
  if (err.frame || err._frame) {
    const frame = err.frame || err._frame;
    const lines = frame.split('\n');
    codeFrame = `<div class="code-frame">${
      lines.map(line => {
        const isHighlight = line.trimStart().startsWith('>');
        const cleaned = line.replace(/^\s*>\s?/, ' ').replace(/^\s{2}/, '');
        const match = cleaned.match(/^(\s*\d+)\s*\|(.*)$/);
        if (match) {
          return `<div class="code-line${isHighlight ? ' highlight' : ''}"><span class="line-number">${match[1].trim()}</span><span class="line-content">${escapeHTML(match[2])}</span></div>`;
        }
        // Caret line (^^^)
        if (cleaned.trim().startsWith('|')) {
          return `<div class="code-line highlight"><span class="line-number"></span><span class="line-content" style="color:#f87171">${escapeHTML(cleaned.replace(/^\s*\|/, ''))}</span></div>`;
        }
        return '';
      }).join('')
    }</div>`;
  }

  const filePath = err.id || err.loc?.file || '';
  const line = err.loc?.line ?? '';
  const col = err.loc?.column ?? '';
  const location = filePath
    ? `<div class="file-path">${escapeHTML(filePath)}${line ? `:${line}` : ''}${col ? `:${col}` : ''}</div>`
    : '';

  const tip = getTip(err);
  const tipHTML = tip ? `<div class="tip"><span class="tip-label">Tip: </span>${escapeHTML(tip)}</div>` : '';

  const stack = err.stack && !isCompilerError
    ? `<div class="stack">${escapeHTML(cleanStack(err.stack))}</div>`
    : '';

  return `
    <div class="backdrop"></div>
    <div class="panel">
      <div class="header">
        <div class="header-left">
          <div class="logo">W</div>
          <span class="brand">What Framework</span>
          <span class="tag ${tagClass}">${type}</span>
        </div>
        <button class="close-btn">Dismiss (Esc)</button>
      </div>
      <div class="body">
        <h2 class="error-title">${escapeHTML(err.name || 'Error')}</h2>
        ${location}
        <pre class="error-message">${escapeHTML(err.message || String(err))}</pre>
        ${codeFrame}
        ${tipHTML}
        ${stack}
      </div>
    </div>
  `;
}

/**
 * Context-aware tips for common What Framework errors
 */
function getTip(err) {
  const msg = (err.message || '').toLowerCase();

  if (msg.includes('infinite') && msg.includes('effect')) {
    return 'An effect is writing to a signal it also reads. Use untrack() to read without subscribing, or move the write to a different effect.';
  }
  if (msg.includes('jsx') && msg.includes('unexpected')) {
    return 'Make sure your vite.config includes the What compiler plugin: import what from "what-compiler/vite"';
  }
  if (msg.includes('not a function') && msg.includes('signal')) {
    return 'Signals are functions: call sig() to read, sig(value) to write. Check you\'re not destructuring a signal.';
  }
  if (msg.includes('hydrat')) {
    return 'Hydration mismatches happen when SSR output differs from client render. Ensure server and client see the same initial state.';
  }
  return '';
}

function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanStack(stack) {
  return stack
    .split('\n')
    .filter(line => !line.includes('node_modules'))
    .slice(0, 10)
    .join('\n');
}

/**
 * Client-side overlay component — injected as a custom element
 * to avoid style conflicts with the user's application.
 */
const OVERLAY_ELEMENT = `
class WhatErrorOverlay extends HTMLElement {
  constructor(err) {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = \`<style>${OVERLAY_STYLES}</style>\`;
    this.show(err);
  }

  show(err) {
    const template = document.createElement('template');
    template.innerHTML = (${buildOverlayHTML.toString()})(err);
    this.root.appendChild(template.content.cloneNode(true));

    // Close handlers
    this.root.querySelector('.close-btn')?.addEventListener('click', () => this.close());
    this.root.querySelector('.backdrop')?.addEventListener('click', () => this.close());
    document.addEventListener('keydown', this._onKey = (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  close() {
    document.removeEventListener('keydown', this._onKey);
    this.remove();
  }
}

// Helper functions bundled into the overlay element
${escapeHTML.toString()}
${cleanStack.toString()}
${getTip.toString()}

if (!customElements.get('what-error-overlay')) {
  customElements.define('what-error-overlay', WhatErrorOverlay);
}
`;

/**
 * Generate the client-side error overlay injection script.
 * Called by the Vite plugin to inject into the dev server.
 */
export function getErrorOverlayCode() {
  return OVERLAY_ELEMENT;
}

/**
 * Create the error overlay middleware for Vite's dev server.
 * Intercepts Vite's error events and shows a custom What-branded overlay.
 */
export function setupErrorOverlay(server) {
  // Listen for Vite errors and enrich with What Framework context
  const origSend = server.ws.send.bind(server.ws);
  server.ws.send = function (payload) {
    if (payload?.type === 'error') {
      // Tag compiler errors
      if (payload.err?.plugin === 'vite-plugin-what') {
        payload.err._isCompilerError = true;
      }
    }
    return origSend(payload);
  };
}
