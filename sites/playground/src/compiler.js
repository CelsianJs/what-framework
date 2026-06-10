// What Framework Playground — Compiler Manager
//
// Lazily spins up the compile worker (babel + what-compiler are heavy, so
// they live in a separate worker chunk that is only fetched on first compile)
// and provides a promise-based compile() API.

let worker = null;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./compile.worker.js', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event) => {
      const data = event.data || {};
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
      }
    };
    worker.onerror = (event) => {
      // Worker failed to boot (or crashed) — fail all in-flight compiles.
      const message = event && event.message
        ? `Compiler worker error: ${event.message}`
        : 'Compiler worker failed to load.';
      for (const [id, resolve] of pending) {
        pending.delete(id);
        resolve({ id, ok: false, error: { message, line: 0, col: 0 } });
      }
    };
  }
  return worker;
}

/**
 * Compile playground JSX to runnable JS.
 * @param {string} code - Raw editor code (JSX).
 * @returns {Promise<{ ok: boolean, code?: string, error?: { message, line, col } }>}
 */
export function compile(code) {
  return new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    getWorker().postMessage({ id, code });
  });
}
