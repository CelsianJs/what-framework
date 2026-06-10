// Minimal `process` shim for the browser/worker.
// what-compiler's babel plugin checks `process.env.NODE_ENV` for dev-only
// warnings; bundlers usually replace it statically, but this guarantees the
// plugin never throws a ReferenceError when it doesn't get replaced.
if (typeof globalThis.process === 'undefined') {
  globalThis.process = { env: { NODE_ENV: 'production' } };
} else if (!globalThis.process.env) {
  globalThis.process.env = { NODE_ENV: 'production' };
}
