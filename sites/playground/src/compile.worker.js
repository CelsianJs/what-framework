// What Framework Playground — JSX Compile Worker
//
// Runs @babel/standalone with the repo's what-compiler babel plugin
// (file:../../packages/compiler) off the main thread. The editor sends raw
// JSX; the worker replies with compiled JS or a diagnostic { message, line, col }.

import './process-shim.js';
import * as Babel from '@babel/standalone';
import whatBabelPlugin from 'what-compiler/babel';

self.onmessage = (event) => {
  const { id, code } = event.data || {};
  if (typeof code !== 'string') return;

  try {
    const result = Babel.transform(code, {
      filename: 'playground.jsx',
      presets: [],
      plugins: [[whatBabelPlugin, {}]],
      parserOpts: { plugins: ['jsx'] },
      sourceMaps: false,
      compact: false,
    });
    self.postMessage({ id, ok: true, code: result.code });
  } catch (err) {
    // Babel parse/transform errors carry a `loc` and a code-frame message —
    // pass them through so the console pane can show file/line diagnostics.
    const loc = err && err.loc ? err.loc : null;
    self.postMessage({
      id,
      ok: false,
      error: {
        // Strip the worker-side filename prefix babel adds ("playground.jsx: ...")
        message: String((err && err.message) || err).replace(/^\/?[\w./-]*playground\.jsx:\s*/, ''),
        line: loc ? loc.line : 0,
        col: loc && typeof loc.column === 'number' ? loc.column + 1 : 0,
      },
    });
  }
};
