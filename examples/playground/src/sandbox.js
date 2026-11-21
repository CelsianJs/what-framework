/**
 * Sandbox manager — creates, monitors, and controls the preview iframe.
 *
 * Security model:
 *  - iframe sandbox="allow-scripts" (no allow-same-origin, no allow-popups, etc.)
 *  - CSP via meta tag blocks network access and restricts script sources
 *  - User code runs in a blob URL loaded into the iframe
 *  - Watchdog kills the iframe if it stops responding (infinite loop protection)
 */
import frameworkIIFE from 'virtual:what-framework-iife';

const WATCHDOG_TIMEOUT = 3000; // ms before we consider the iframe stuck
const CSP = "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none';";

let iframe = null;
let container = null;
let watchdogTimer = null;
let onError = null;

/**
 * Initialise the sandbox with a container element and an error callback.
 */
export function initSandbox(containerEl, errorCallback) {
  container = containerEl;
  onError = errorCallback;
  recreateIframe();
  window.addEventListener('message', handleMessage);
}

/**
 * Run compiled code inside the sandbox.
 *
 * @param {string} compiledCode - Output from the Babel transform
 * @param {string} [css=''] - Optional user CSS
 */
export function run(compiledCode, css = '') {
  // Kill any existing watchdog
  clearWatchdog();

  // Recreate iframe to get a clean state (prevents leaking state between runs)
  recreateIframe();

  // The compiled code imports from 'what-framework' and 'what-framework/render';
  // we rewrite those to use the globals provided by the IIFE bundle.
  // The babel plugin outputs: import { insert as _$insert, ... } from "what-framework/render";
  // We strip those imports and prepend destructuring from the __What global.
  const processedCode = rewriteImports(compiledCode);

  const html = buildHTML(processedCode, css);

  // Use srcdoc instead of blob URL — blob URLs don't work in sandboxed
  // iframes without allow-same-origin (the opaque origin can't load them).
  iframe.srcdoc = html;

  // Start watchdog — if iframe doesn't ack within WATCHDOG_TIMEOUT, kill it
  startWatchdog();
}

function buildHTML(code, css) {
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  ${css}
</style>
</head>
<body>
<div id="app"></div>
<script>
// Inject What Framework runtime as globals
${frameworkIIFE}

// Expose framework APIs as top-level variables for user code
var signal = __What.signal;
var computed = __What.computed;
var effect = __What.effect;
var batch = __What.batch;
var onMount = __What.onMount;
var onCleanup = __What.onCleanup;
var h = __What.h;
var mount = __What.mount;
var Fragment = __What.Fragment;
var template = __What.render.template;
var _$template = __What.render._$template;
var insert = __What.render.insert;
var spread = __What.render.spread;
var setProp = __What.render.setProp;
var delegateEvents = __What.render.delegateEvents;
var on = __What.render.on;
var classList = __What.render.classList;
var mapArray = __What.render.mapArray;
var memo = __What.memo;
var lazy = __What.lazy;
var Show = __What.Show;
var For = __What.For;
var Switch = __What.Switch;
var Match = __What.Match;
var _$createComponent = __What.render._$createComponent;
var createRoot = __What.createRoot;
var untrack = __What.untrack;

// Heartbeat responder for the watchdog
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'ping') {
    e.source.postMessage({ type: 'pong' }, '*');
  }
});

// Forward errors to parent
window.addEventListener('error', function(e) {
  parent.postMessage({
    type: 'runtime-error',
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
  }, '*');
});

window.addEventListener('unhandledrejection', function(e) {
  parent.postMessage({
    type: 'runtime-error',
    message: 'Unhandled promise rejection: ' + (e.reason?.message || e.reason || 'unknown'),
  }, '*');
});

// Signal ready after a microtask so framework is initialized
Promise.resolve().then(function() {
  parent.postMessage({ type: 'pong' }, '*');
});
</script>
<script>
// User code (compiled)
try {
  ${code}
} catch(e) {
  parent.postMessage({
    type: 'runtime-error',
    message: e.message,
    stack: e.stack,
  }, '*');
}
</script>
</body>
</html>`;
}

/**
 * Rewrite ES module imports from what-framework / what-core to use global destructuring.
 * The babel plugin emits:
 *   import { _$template, insert as _$insert, ... } from "what-framework/render";
 * We convert these to:
 *   const { _$template, insert: _$insert, ... } = __What.render;
 */
function rewriteImports(code) {
  // Match import statements from what-core or what-framework (including subpaths)
  // The [^}] needs the `s` (dotAll) flag to match across newlines inside braces
  return code.replace(
    /import\s*\{([\s\S]*?)\}\s*from\s*["'](what-core(?:\/[\w-]+)?|what-framework(?:\/[\w-]+)?|what-compiler\/runtime)["']\s*;?/g,
    (_, specifiers, source) => {
      // Parse specifiers: "template as _$template, insert" -> destructuring
      const parts = specifiers.split(',').map(s => s.trim()).filter(Boolean);
      const destructured = parts.map(part => {
        // Handle "X as Y" -> "X: Y" for destructuring
        const asMatch = part.match(/^(\S+)\s+as\s+(\S+)$/);
        if (asMatch) return `${asMatch[1]}: ${asMatch[2]}`;
        return part;
      }).join(', ');
      return `const { ${destructured} } = ${source.endsWith('/render') ? '__What.render' : '__What'};`;
    }
  );
}

function recreateIframe() {
  if (iframe) {
    iframe.remove();
  }
  iframe = document.createElement('iframe');
  iframe.id = 'preview';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.style.cssText = 'width:100%;height:100%;border:none;background:white;';
  container.appendChild(iframe);
}

function startWatchdog() {
  watchdogTimer = setTimeout(() => {
    // Iframe didn't respond in time — likely an infinite loop
    recreateIframe();
    if (onError) {
      onError('Execution timed out (possible infinite loop). The preview has been reset.');
    }
  }, WATCHDOG_TIMEOUT);

  // Send a ping — if the iframe responds, clear the watchdog
  // (the iframe's message listener sends a pong back)
}

function clearWatchdog() {
  if (watchdogTimer) {
    clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

function handleMessage(e) {
  if (!e.data || typeof e.data !== 'object') return;

  switch (e.data.type) {
    case 'pong':
      clearWatchdog();
      break;
    case 'runtime-error':
      if (onError) {
        onError(e.data.message || 'Unknown runtime error');
      }
      break;
  }
}

export function destroy() {
  clearWatchdog();
  window.removeEventListener('message', handleMessage);
  if (iframe) iframe.remove();
}
