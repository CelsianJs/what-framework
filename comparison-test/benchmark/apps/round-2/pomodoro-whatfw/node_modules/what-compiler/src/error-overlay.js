/**
 * What Framework — Vite Error Overlay
 *
 * Custom error overlay injected during dev mode. Shows compiler transform errors
 * and runtime signal errors with What Framework branding and helpful context.
 *
 * This is client-side code that Vite injects into the page during development.
 *
 * Architecture: The overlay HTML template and all helper functions are inlined as
 * string literals into the custom element code. This avoids function-to-string
 * serialization (which is fragile with minifiers and bundlers).
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

  .header-right {
    display: flex;
    align-items: center;
    gap: 0.5rem;
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

  .close-btn, .copy-btn {
    background: none;
    border: 1px solid #3a3a5a;
    color: #a0a0c0;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
    font-family: inherit;
    font-size: 12px;
  }

  .close-btn:hover, .copy-btn:hover {
    background: #2a2a4a;
    color: #fff;
  }

  .copy-btn.copied {
    border-color: #22c55e;
    color: #22c55e;
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
 * Client-side overlay component — injected as a custom element string literal.
 * All helper functions are inlined directly to avoid function.toString() fragility.
 */
const OVERLAY_ELEMENT = `
class WhatErrorOverlay extends HTMLElement {
  constructor(err) {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = '<style>${OVERLAY_STYLES}</style>';
    this._err = err;
    this.show(err);
  }

  // --- Inlined helper: escapeHTML ---
  _escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Inlined helper: cleanStack ---
  _cleanStack(stack) {
    return stack
      .split('\\n')
      .filter(function(line) { return line.indexOf('node_modules') === -1; })
      .slice(0, 10)
      .join('\\n');
  }

  // --- Inlined helper: getTip ---
  _getTip(err) {
    var msg = (err.message || '').toLowerCase();

    if (msg.indexOf('infinite') !== -1 && msg.indexOf('effect') !== -1) {
      return 'An effect is writing to a signal it also reads. Use untrack() to read without subscribing, or move the write to a different effect.';
    }
    if (msg.indexOf('jsx') !== -1 && msg.indexOf('unexpected') !== -1) {
      return 'Make sure your vite.config includes the What compiler plugin: import what from "what-compiler/vite"';
    }
    if (msg.indexOf('not a function') !== -1 && msg.indexOf('signal') !== -1) {
      return 'Signals are functions: call sig() to read, sig(value) to write. Check you are not destructuring a signal.';
    }
    if (msg.indexOf('hydrat') !== -1) {
      return 'Hydration mismatches happen when SSR output differs from client render. Ensure server and client see the same initial state.';
    }
    // New tips for common mistakes
    if (msg.indexOf('signal') !== -1 && msg.indexOf('without') !== -1 && msg.indexOf('call') !== -1) {
      return 'Signals must be called to read their value. Use {count()} in JSX, not {count}. The parentheses trigger the reactive subscription.';
    }
    if (msg.indexOf('innerhtml') !== -1 && msg.indexOf('__html') !== -1) {
      return 'Raw innerHTML is blocked for security. Use innerHTML={{ __html: trustedString }} or dangerouslySetInnerHTML={{ __html: trustedString }} instead.';
    }
    if ((msg.indexOf('innerhtml') !== -1 || msg.indexOf('xss') !== -1) && msg.indexOf('raw string') !== -1) {
      return 'Raw innerHTML is a security risk (XSS). Wrap your HTML in an object: innerHTML={{ __html: yourString }}.';
    }
    if (msg.indexOf('cleanup') !== -1 && (msg.indexOf('effect') !== -1 || msg.indexOf('listener') !== -1)) {
      return 'Effects that add event listeners or timers should return a cleanup function: effect(() => { el.addEventListener(...); return () => el.removeEventListener(...); })';
    }
    if (msg.indexOf('route') !== -1 && (msg.indexOf('not found') !== -1 || msg.indexOf('404') !== -1 || msg.indexOf('no match') !== -1)) {
      return 'No route matched the current URL. Check that your route paths are correct and you have a catch-all or 404 route defined.';
    }
    if (msg.indexOf('key') !== -1 && (msg.indexOf('missing') !== -1 || msg.indexOf('list') !== -1 || msg.indexOf('each') !== -1)) {
      return 'Lists need unique keys for efficient DOM updates. Add a key prop: items.map(item => <Item key={item.id} />)';
    }
    return '';
  }

  // --- Build overlay HTML ---
  _buildHTML(err) {
    var isCompilerError = err._isCompilerError || err.plugin === 'vite-plugin-what';
    var type = isCompilerError ? 'Compiler Error' : 'Runtime Error';
    var tagClass = isCompilerError ? 'tag-error' : 'tag-warning';

    var codeFrame = '';
    var rawFrame = err.frame || err._frame;
    if (rawFrame) {
      var lines = rawFrame.split('\\n');
      var frameLines = '';
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var isHighlight = line.trimStart().startsWith('>');
        var cleaned = line.replace(/^\\s*>\\s?/, ' ').replace(/^\\s{2}/, '');
        var match = cleaned.match(/^(\\s*\\d+)\\s*\\|(.*)$/);
        if (match) {
          frameLines += '<div class="code-line' + (isHighlight ? ' highlight' : '') + '"><span class="line-number">' + match[1].trim() + '</span><span class="line-content">' + this._escapeHTML(match[2]) + '</span></div>';
        } else if (cleaned.trim().startsWith('|')) {
          frameLines += '<div class="code-line highlight"><span class="line-number"></span><span class="line-content" style="color:#f87171">' + this._escapeHTML(cleaned.replace(/^\\s*\\|/, '')) + '</span></div>';
        }
      }
      if (frameLines) {
        codeFrame = '<div class="code-frame">' + frameLines + '</div>';
      }
    }

    var filePath = err.id || (err.loc && err.loc.file) || '';
    var lineNum = (err.loc && err.loc.line != null) ? err.loc.line : '';
    var col = (err.loc && err.loc.column != null) ? err.loc.column : '';
    var location = filePath
      ? '<div class="file-path">' + this._escapeHTML(filePath) + (lineNum ? ':' + lineNum : '') + (col ? ':' + col : '') + '</div>'
      : '';

    var tip = this._getTip(err);
    var tipHTML = tip ? '<div class="tip"><span class="tip-label">Tip: </span>' + this._escapeHTML(tip) + '</div>' : '';

    var stack = (err.stack && !isCompilerError)
      ? '<div class="stack">' + this._escapeHTML(this._cleanStack(err.stack)) + '</div>'
      : '';

    return '<div class="backdrop"></div>'
      + '<div class="panel">'
      +   '<div class="header">'
      +     '<div class="header-left">'
      +       '<div class="logo">W</div>'
      +       '<span class="brand">What Framework</span>'
      +       '<span class="tag ' + tagClass + '">' + type + '</span>'
      +     '</div>'
      +     '<div class="header-right">'
      +       '<button class="copy-btn">Copy Error</button>'
      +       '<button class="close-btn">Dismiss (Esc)</button>'
      +     '</div>'
      +   '</div>'
      +   '<div class="body">'
      +     '<h2 class="error-title">' + this._escapeHTML(err.name || 'Error') + '</h2>'
      +     location
      +     '<pre class="error-message">' + this._escapeHTML(err.message || String(err)) + '</pre>'
      +     codeFrame
      +     tipHTML
      +     stack
      +   '</div>'
      + '</div>';
  }

  show(err) {
    var template = document.createElement('template');
    template.innerHTML = this._buildHTML(err);
    this.root.appendChild(template.content.cloneNode(true));

    // Close handlers
    var self = this;
    var closeBtn = this.root.querySelector('.close-btn');
    if (closeBtn) closeBtn.addEventListener('click', function() { self.close(); });
    var backdrop = this.root.querySelector('.backdrop');
    if (backdrop) backdrop.addEventListener('click', function() { self.close(); });
    document.addEventListener('keydown', this._onKey = function(e) {
      if (e.key === 'Escape') self.close();
    });

    // Copy Error button
    var copyBtn = this.root.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() {
        self._copyError(copyBtn);
      });
    }
  }

  _copyError(btn) {
    var err = this._err;
    var data = {
      name: err.name || 'Error',
      message: err.message || String(err),
      file: err.id || (err.loc && err.loc.file) || null,
      line: (err.loc && err.loc.line != null) ? err.loc.line : null,
      column: (err.loc && err.loc.column != null) ? err.loc.column : null,
      stack: err.stack ? this._cleanStack(err.stack) : null,
      framework: 'What Framework',
      timestamp: new Date().toISOString()
    };

    var text = JSON.stringify(data, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(function() {
          btn.textContent = 'Copy Error';
          btn.classList.remove('copied');
        }, 2000);
      }).catch(function() {
        // Fallback: select text
        prompt('Copy error details:', text);
      });
    } else {
      prompt('Copy error details:', text);
    }
  }

  close() {
    document.removeEventListener('keydown', this._onKey);
    this.remove();
  }
}

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
