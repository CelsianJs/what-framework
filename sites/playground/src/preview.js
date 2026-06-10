// What Framework Playground — Preview Manager
//
// Compiles editor JSX with the real what-compiler (in a web worker, see
// compiler.js) and executes the compiled output inside a sandboxed iframe.
// The iframe gets an import map pointing `what-framework`,
// `what-framework/render` and `what-compiler/runtime` at a locally-bundled
// copy of the framework (public/vendor/, built from the repo packages), so
// the runtime always matches the compiler version.

import { compile } from './compiler.js';

// Vendor framework bundle URLs (same-origin, stable names — see
// scripts/build-vendor.mjs). Absolute URLs so they resolve inside the iframe.
const BASE = new URL(import.meta.env.BASE_URL || '/', window.location.href);
const FRAMEWORK_URL = new URL('vendor/what-framework.js', BASE).href;
const RENDER_URL = new URL('vendor/what-framework-render.js', BASE).href;

const IMPORT_MAP = {
  imports: {
    'what-framework': FRAMEWORK_URL,
    'what-framework/render': RENDER_URL,
    // The compiler runtime + core are re-exports of the same module graph —
    // map them too so compiled output (and adventurous users) resolve.
    'what-compiler/runtime': FRAMEWORK_URL,
    'what-core': FRAMEWORK_URL,
    'what-core/render': RENDER_URL,
  },
};

/**
 * Create the preview iframe and manage code execution.
 *
 * @param {HTMLElement} container - Where to mount the iframe
 * @param {function} onConsole - Callback for console messages: { type, args, timestamp }
 * @param {function} onError - Callback for errors: { message, line, col }
 * @param {function} [onCompile] - Callback after each compile: { ok, code?, error? }
 * @returns {{ run: function, destroy: function }}
 */
export function createPreview(container, onConsole, onError, onCompile) {
  let iframe = null;
  let debounceTimer = null;
  let messageHandler = null;
  let runSeq = 0;

  function run(code) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => compileAndExecute(code), 400);
  }

  async function compileAndExecute(code) {
    const seq = ++runSeq;
    const result = await compile(code);
    // A newer run superseded this one while the worker was busy — drop it.
    if (seq !== runSeq) return;

    if (onCompile) onCompile(result);

    if (!result.ok) {
      const { message, line, col } = result.error;
      onError({
        message: `Compile error: ${message}`,
        line,
        col,
      });
      renderCompileError(result.error);
      return;
    }

    executeCode(result.code);
  }

  function freshIframe() {
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
      messageHandler = null;
    }
    if (iframe) {
      container.removeChild(iframe);
    }
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: #0a0a0f;';
    container.appendChild(iframe);
    return iframe.contentDocument || iframe.contentWindow.document;
  }

  function writeHead(doc) {
    doc.write('<!DOCTYPE html><html lang="en"><head>');
    doc.write('<meta charset="UTF-8">');
    doc.write('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    doc.write('<link rel="preconnect" href="https://fonts.googleapis.com">');
    doc.write('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>');
    doc.write('<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">');
    doc.write('<style>');
    doc.write('*, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }');
    doc.write("html, body { font-family: 'Inter', -apple-system, system-ui, sans-serif; background: #0a0a0f; color: #ececef; line-height: 1.6; -webkit-font-smoothing: antialiased; }");
    doc.write('#app { padding: 24px; min-height: 100vh; }');
    doc.write('@keyframes spin { to { transform: rotate(360deg); } }');
    doc.write('::-webkit-scrollbar { width: 6px; height: 6px; }');
    doc.write('::-webkit-scrollbar-track { background: transparent; }');
    doc.write('::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }');
    doc.write('::-webkit-scrollbar-thumb:hover { background: #555; }');
    doc.write(".playground-error { position: fixed; bottom: 16px; left: 16px; right: 16px; background: #2a1215; border: 1px solid #ef4444; border-radius: 10px; padding: 16px 20px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #fca5a5; z-index: 9999; max-height: 40vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); white-space: pre-wrap; }");
    doc.write('.playground-error-title { color: #ef4444; font-weight: 600; margin-bottom: 6px; font-size: 14px; }');
    doc.write('</style>');
    // Import map MUST come before any module script.
    doc.write('<scr' + 'ipt type="importmap">' + JSON.stringify(IMPORT_MAP) + '</scr' + 'ipt>');
    doc.write('</head><body><div id="app"></div>');
  }

  // Show a compile diagnostic inside the preview pane (the console pane gets
  // the structured error separately via onError).
  function renderCompileError(error) {
    const doc = freshIframe();
    doc.open();
    writeHead(doc);
    doc.write('<div class="playground-error"><div class="playground-error-title">Compile Error' +
      (error.line ? ' — playground.jsx:' + error.line + (error.col ? ':' + error.col : '') : '') +
      '</div><div>' + escapeHTML(error.message) + '</div></div>');
    doc.write('</body></html>');
    doc.close();
  }

  function executeCode(compiledCode) {
    const doc = freshIframe();

    // Set up message listener for this iframe
    messageHandler = (event) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || !data.__playground) return;

      if (data.type === 'console') {
        onConsole({
          type: data.level,
          args: data.args,
          timestamp: Date.now(),
        });
      } else if (data.type === 'error') {
        onError({
          message: data.message,
          line: data.line,
          col: data.col,
        });
      }
    };
    window.addEventListener('message', messageHandler);

    doc.open();
    writeHead(doc);

    // Write the console capture script (regular, non-module)
    doc.write('<scr' + 'ipt>');
    doc.write('var origConsole={log:console.log,warn:console.warn,error:console.error,info:console.info};');
    doc.write('function sendConsole(l,a){var s=[];for(var i=0;i<a.length;i++){try{if(typeof a[i]==="object"&&a[i]!==null)s.push(JSON.stringify(a[i],null,2));else s.push(String(a[i]))}catch(e){s.push(String(a[i]))}}window.parent.postMessage({__playground:true,type:"console",level:l,args:s},"*")}');
    doc.write('console.log=function(){origConsole.log.apply(console,arguments);sendConsole("log",Array.from(arguments))};');
    doc.write('console.warn=function(){origConsole.warn.apply(console,arguments);sendConsole("warn",Array.from(arguments))};');
    doc.write('console.error=function(){origConsole.error.apply(console,arguments);sendConsole("error",Array.from(arguments))};');
    doc.write('console.info=function(){origConsole.info.apply(console,arguments);sendConsole("info",Array.from(arguments))};');
    doc.write('window.onerror=function(m,s,l,c,e){var el=document.createElement("div");el.className="playground-error";el.innerHTML=\'<div class="playground-error-title">Runtime Error<\\/div><div>\'+(m||"Unknown error")+\'<\\/div>\';document.body.appendChild(el);window.parent.postMessage({__playground:true,type:"error",message:String(m),line:l,col:c},"*")};');
    doc.write('window.addEventListener("unhandledrejection",function(ev){var m=(ev.reason&&ev.reason.message)||String(ev.reason);var el=document.createElement("div");el.className="playground-error";el.innerHTML=\'<div class="playground-error-title">Unhandled Promise Rejection<\\/div><div>\'+m+\'<\\/div>\';document.body.appendChild(el);window.parent.postMessage({__playground:true,type:"error",message:m,line:0,col:0},"*")});');
    doc.write('</scr' + 'ipt>');

    // Load the compiled code as a module via a blob URL. Bare specifiers in
    // blob modules resolve through the document's import map (above).
    doc.write('<scr' + 'ipt>');
    doc.write('var userCode = ' + JSON.stringify(compiledCode) + ';');
    doc.write('var blob = new Blob([userCode], {type: "text/javascript"});');
    doc.write('var url = URL.createObjectURL(blob);');
    doc.write('var s = document.createElement("script");');
    doc.write('s.type = "module";');
    doc.write('s.src = url;');
    doc.write('s.onerror = function(e) {');
    doc.write('  var el = document.createElement("div");');
    doc.write('  el.className = "playground-error";');
    doc.write('  el.innerHTML = \'<div class="playground-error-title">Module Error<\\/div><div>Failed to load module. Check your imports.<\\/div>\';');
    doc.write('  document.body.appendChild(el);');
    doc.write('};');
    doc.write('document.head.appendChild(s);');
    doc.write('</scr' + 'ipt>');

    doc.write('</body></html>');
    doc.close();
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function destroy() {
    clearTimeout(debounceTimer);
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
      messageHandler = null;
    }
    if (iframe) {
      container.removeChild(iframe);
      iframe = null;
    }
  }

  return { run, destroy };
}
