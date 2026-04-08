// What Framework Playground — Preview Manager
// Executes user code inside a sandboxed iframe

// The What Framework bundle URL — loaded from npm CDN
const FRAMEWORK_CDN = 'https://esm.sh/what-framework@latest';

/**
 * Create the preview iframe and manage code execution.
 *
 * @param {HTMLElement} container - Where to mount the iframe
 * @param {function} onConsole - Callback for console messages: { type, args, timestamp }
 * @param {function} onError - Callback for errors: { message, line, col }
 * @returns {{ run: function, destroy: function }}
 */
export function createPreview(container, onConsole, onError) {
  let iframe = null;
  let debounceTimer = null;
  let messageHandler = null;

  function run(code) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => executeCode(code), 400);
  }

  function executeCode(code) {
    // Clean up previous message handler
    if (messageHandler) {
      window.removeEventListener('message', messageHandler);
    }
    if (iframe) {
      container.removeChild(iframe);
    }

    // Create fresh iframe — no sandbox so module imports work
    iframe = document.createElement('iframe');
    iframe.style.cssText = 'width: 100%; height: 100%; border: none; background: #0a0a0f;';
    container.appendChild(iframe);

    // Set up message listener
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

    // Transform imports to use CDN
    const transformedCode = code.replace(
      /from\s+['"]what-framework['"]/g,
      "from '" + FRAMEWORK_CDN + "'"
    );

    // Build HTML using string concatenation (avoiding template literal issues)
    // We use the <script> splitting trick to prevent premature parser closing
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();

    // Write the head and styles
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
    doc.write(".playground-error { position: fixed; bottom: 16px; left: 16px; right: 16px; background: #2a1215; border: 1px solid #ef4444; border-radius: 10px; padding: 16px 20px; font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #fca5a5; z-index: 9999; max-height: 40vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }");
    doc.write('.playground-error-title { color: #ef4444; font-weight: 600; margin-bottom: 6px; font-size: 14px; }');
    doc.write('</style></head><body><div id="app"></div>');

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

    // Now write the user code as a module script
    // We need to create a blob URL for the module since document.write
    // with <script type="module"> and imports doesn't work well
    doc.write('<scr' + 'ipt>');
    doc.write('var userCode = ' + JSON.stringify(transformedCode) + ';');
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
