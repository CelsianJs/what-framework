// The server of the matrix's server-build run (matrix-browser.mjs --serve=ssr),
// in a process of its own, so that what a library does when it loads in Node
// (timers, globals, an unhandled rejection) stays out of the runner.
//
//   node matrix-ssr-server.mjs <server bundle> <client dist dir> <page file>
//
// A page request (/?lib=<fixture>&variant=<variant>) renders the fixture with
// the server bundle's render(name, variant) and writes the HTML into the built
// client page, followed by a script that records what the browser then does
// to it (window.__hyd). Options in the query:
//   ssr=0    no server render (the client entry mounts instead of hydrating)
//   hold=1   the client entry waits for window.__start(), so a test can type
//            into the server's HTML before the page hydrates
// Prints "listening <port>" when it is up.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [entry, clientDir, pageFile] = process.argv.slice(2);
const RENDER_TIMEOUT = 20000;

// A library's stray rejection or late throw must not take the server down.
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

const logs = [];
for (const level of ['warn', 'error']) {
  console[level] = (...args) => { logs.push(`${level}: ${args.map((a) => (a && a.stack) || String(a)).join(' ').slice(0, 600)}`); };
}

let mod = null;
let loadError = null;
try {
  mod = await import(pathToFileURL(entry).href);
} catch (e) {
  loadError = String((e && e.stack) || e);
}
const page = fs.readFileSync(path.join(clientDir, pageFile), 'utf8');

// What the browser does to the server's HTML: which of its elements are still
// in the page afterwards, how many nodes were added and removed, the fewest
// elements any animation frame saw (fewer than the server wrote: the content
// was gone for a frame), and the layout shift Chromium measured. Also the
// element and text nodes in the page that the server did not write
// (created), and how many of the server's are still there (keptNodes).
const PROBE = `(() => {
  const main = document.getElementById('main');
  const nodes = [...main.querySelectorAll('*')];
  const count = () => main.querySelectorAll('*').length;
  const all = () => { const out = []; const w = document.createTreeWalker(main, 5); for (let n = w.nextNode(); n !== null; n = w.nextNode()) out.push(n); return out; };
  const server = all();
  const p = window.__hyd = { serverElements: nodes.length, serverNodes: server.length, minElements: nodes.length, frames: 0, added: 0, removed: 0, shift: 0, kept: () => nodes.filter((n) => n.isConnected).length, now: count,
    keptNodes: () => server.filter((n) => n.isConnected && main.contains(n)).length,
    created: () => { const seen = new Set(server); return all().filter((n) => !seen.has(n)).length; },
    createdSample: () => { const seen = new Set(server); return all().filter((n) => !seen.has(n)).slice(0, 6).map((n) => (n.nodeType === 3 ? '#text ' + JSON.stringify(n.data.slice(0, 20)) : '<' + n.localName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ')[0] : '') + '>') + ' in <' + (n.parentNode ? n.parentNode.localName : '?') + '>'); } };
  const elements = (list) => { let n = 0; for (const node of list) if (node.nodeType === 1) n += 1 + node.querySelectorAll('*').length; return n; };
  new MutationObserver((list) => { for (const m of list) { p.added += elements(m.addedNodes); p.removed += elements(m.removedNodes); } }).observe(main, { childList: true, subtree: true });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) p.shift += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch {}
  const tick = () => { p.frames++; const n = count(); if (n < p.minElements) p.minElements = n; if (p.frames < 600) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
})();`;

const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const n = Number(url.searchParams.get('n') || 0);
    res.setHeader('content-type', 'application/json');
    setTimeout(() => res.end(JSON.stringify({ path: url.pathname, n, items: [`item-${n}-a`, `item-${n}-b`] })), 30);
    return;
  }
  const file = path.join(clientDir, decodeURIComponent(url.pathname));
  if (file.startsWith(clientDir) && fs.existsSync(file) && fs.statSync(file).isFile() && path.basename(file) !== pageFile) {
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
    return;
  }
  // A page: the fixture's server render inside the client page.
  const name = url.searchParams.get('lib');
  const variant = url.searchParams.get('variant') || 'fixture';
  const info = { rendered: false, error: null, bytes: 0, log: [] };
  let body = '';
  if (name && url.searchParams.get('ssr') !== '0') {
    logs.length = 0;
    try {
      if (loadError !== null) throw new Error(`the server bundle did not load: ${loadError}`);
      body = String(await Promise.race([
        mod.render(name, variant),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`the server render did not finish in ${RENDER_TIMEOUT} ms`)), RENDER_TIMEOUT)),
      ]));
      info.rendered = true;
      info.bytes = body.length;
    } catch (e) {
      body = '';
      info.error = String((e && e.stack) || e).split('\n').slice(0, 4).join(' | ').slice(0, 700);
    }
    info.log = logs.slice(0, 6);
  }
  let html = page.replace('<div id="main"></div>', () => `<div id="main">${body}</div><script>window.__ssr = ${json(info)};${info.rendered ? PROBE : ''}</script>`);
  if (url.searchParams.get('hold') === '1') {
    html = html.replace(/<script type="module"[^>]*\ssrc="([^"]+)"[^>]*><\/script>/, (_, src) => `<script>window.__start = () => import(${json(src)});</script>`);
  }
  res.setHeader('content-type', 'text/html');
  res.end(html);
});
server.listen(0, '127.0.0.1', () => { process.stdout.write(`listening ${server.address().port}\n`); });
