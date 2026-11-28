// Child process that runs one bundled snippet in a browser-like environment and
// reports what went wrong. Started by run.mjs, one process per snippet, so every
// snippet gets its own module graph and its own copy of what-core.
//
//   node runner.mjs <bundle entry> '<options json>'  run, answer over IPC
//   node runner.mjs --globals                        print the global names a snippet may use
//
// Nothing a snippet does reaches the network, starts a process or binds a port:
// sockets never connect, servers never listen, fetch never resolves.

import net from 'node:net';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';

const g = globalThis;

net.Server.prototype.listen = function listen() { return this; };
net.Socket.prototype.connect = function connect() { return this; };
dgram.Socket.prototype.bind = function bind() { return this; };
dgram.Socket.prototype.send = function send() {};
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = () => { throw new Error(`the snippet harness does not start processes (${name})`); };
}
syncBuiltinESMExports();

const { dom, window } = installDOM();

// Expose the window's own properties as globals, as a browser does, so a
// snippet can read localStorage or construct an HTMLInputElement by name.
for (const key of Object.getOwnPropertyNames(window)) {
  if (key in g || key === 'undefined') continue;
  let value;
  try { value = window[key]; } catch { continue; }
  const bound = typeof value === 'function' && /^[a-z]/.test(key) ? value.bind(window) : value;
  Object.defineProperty(g, key, { configurable: true, writable: true, value: bound });
}

const pending = () => new Promise(() => {});
class InertEventTarget extends window.EventTarget {}
class InertSocket extends InertEventTarget {
  constructor(url) { super(); this.url = String(url); this.readyState = 0; }
  send() {}
  close() { this.readyState = 3; }
}
Object.assign(InertSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
class InertXHR extends InertEventTarget {
  constructor() { super(); this.readyState = 0; this.status = 0; this.responseText = ''; }
  open() { this.readyState = 1; }
  setRequestHeader() {}
  send() {}
  abort() {}
  getAllResponseHeaders() { return ''; }
  getResponseHeader() { return null; }
}
class InertObserver {
  constructor(callback) { this.callback = callback; }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}
const mediaQueryList = (query) => Object.assign(new InertEventTarget(), {
  matches: false, media: String(query), onchange: null, addListener() {}, removeListener() {},
});

const stubs = {
  fetch: () => pending(),
  WebSocket: InertSocket,
  EventSource: InertSocket,
  XMLHttpRequest: InertXHR,
  IntersectionObserver: InertObserver,
  ResizeObserver: InertObserver,
  matchMedia: mediaQueryList,
  requestIdleCallback: (cb) => setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 50 }), 0),
  cancelIdleCallback: (id) => clearTimeout(id),
  alert: () => {},
  confirm: () => true,
  prompt: () => '',
  scrollTo: () => {},
  scroll: () => {},
  scrollBy: () => {},
};
for (const [key, value] of Object.entries(stubs)) {
  Object.defineProperty(g, key, { configurable: true, writable: true, value });
  Object.defineProperty(window, key, { configurable: true, writable: true, value });
}
window.navigator.sendBeacon = () => true;
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
// jsdom has no canvas. A 2D context that measures every character as 8px
// wide is enough for code that sets a font and measures text.
window.HTMLCanvasElement.prototype.getContext = function getContext(type) {
  if (type !== '2d') return null;
  const noop = () => {};
  return {
    canvas: this, font: '10px sans-serif', fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, textAlign: 'start', textBaseline: 'alphabetic',
    measureText: (text) => ({ width: String(text).length * 8, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    fillText: noop, strokeText: noop, fillRect: noop, clearRect: noop, strokeRect: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, fill: noop, stroke: noop, save: noop, restore: noop, scale: noop, translate: noop,
    rotate: noop, setTransform: noop, drawImage: noop,
  };
};
if (!window.Element.prototype.animate) {
  window.Element.prototype.animate = function animate() {
    return Object.assign(new InertEventTarget(), {
      finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, reverse() {}, onfinish: null,
    });
  };
}

if (process.argv[2] === '--globals') {
  const names = new Set();
  for (let o = g; o; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) names.add(k);
  process.stdout.write(JSON.stringify([...names]), () => process.exit(0));
} else {
  await run();
}

async function run() {
  const [bundlePath, optionsJson] = process.argv.slice(2);
  const options = JSON.parse(optionsJson || '{}');

  const problems = [];
  const record = (kind, value) => {
    const message = value instanceof Error ? (value.stack || String(value)) : String(value);
    problems.push({ kind, message: message.split('\n').slice(0, 6).join('\n'), code: value?.code ?? null });
  };

  const consoleError = console.error;
  console.error = (...args) => {
    const text = args.map((a) => (a instanceof Error ? a.stack || String(a) : String(a))).join(' ');
    // The diagnostics channel prints every error-severity report; the report
    // itself is collected through subscribeDiagnostics.
    if (/^\[what\] ERR_[A-Z0-9_]+ /.test(text)) return;
    record('console.error', args.find((a) => a instanceof Error) || text);
  };
  process.on('uncaughtException', (err) => record('uncaught exception', err));
  process.on('unhandledRejection', (err) => record('unhandled rejection', err));

  // jsdom reports an exception thrown by an event handler as an
  // "unhandled-exception"; everything else it reports (an API jsdom does not
  // implement, a stylesheet it cannot parse) is about jsdom, not the snippet.
  dom.virtualConsole.removeAllListeners('jsdomError');
  dom.virtualConsole.on('jsdomError', (err) => {
    if (err.type === 'unhandled-exception') record('uncaught exception in an event handler', err.cause || err);
  });

  g.__WHAT_DEV__ = true;

  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  let mod = null;

  async function settle() {
    for (let i = 0; i < 2; i++) {
      try { mod?.flushSync(); } catch (err) { record('thrown while flushing effects', err); }
      await tick(10);
    }
  }

  const initialBody = window.document.body.innerHTML;
  const result = { pending: false, mounted: null };

  // A top-level await on the stubbed network never settles; the snippet's
  // synchronous part has run by then, so the run reports what it has.
  try {
    const loading = import(pathToFileURL(bundlePath).href).then((m) => { mod = m; });
    result.pending = await Promise.race([loading.then(() => false), tick(3000).then(() => true)]);
  } catch (err) {
    record('thrown while loading', err);
  }

  if (mod) {
    await settle();
    const target = options.mount && (options.mount === 'default' ? mod.snippet.default : mod.snippet.__snippetMount$);
    if (typeof target === 'function' && window.document.body.innerHTML === initialBody) {
      try {
        mod.mountComponent(target);
        result.mounted = options.mountName;
      } catch (err) {
        record(`thrown while mounting <${options.mountName}>`, err);
      }
      await settle();
    }
    const buttons = Array.from(window.document.querySelectorAll('button')).slice(0, 50);
    for (const button of buttons) {
      if (!button.isConnected) continue;
      button.click();
      await settle();
    }
  }

  result.diagnostics = mod ? mod.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: d.message })) : [];
  result.problems = problems;
  console.error = consoleError;
  process.send(result, () => process.exit(0));
}
