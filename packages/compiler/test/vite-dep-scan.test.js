// The first `vite` run of an app scans its entry for dependencies to pre-bundle.
// On Vite 8 that scan transforms .jsx with its own options, React's automatic
// runtime unless told otherwise, so a What app's JSX made it look for
// react/jsx-dev-runtime and print "(!) Failed to run dependency scan".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import whatVitePlugin from '../src/vite-plugin.js';

// Outside the repository, where no react package resolves, as in an app.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'what-vite-dep-scan-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const vitePath = createRequire(import.meta.url).resolve('vite');
const { createServer, createLogger, version } = await import(vitePath);

test('the dependency scan of a JSX entry reports nothing missing', { skip: parseInt(version, 10) < 8 && 'Vite 7 scans with esbuild, which takes the esbuild key' }, async () => {
  fs.writeFileSync(path.join(root, 'index.html'), '<div id="app"></div><script type="module" src="/main.jsx"></script>');
  fs.writeFileSync(path.join(root, 'main.jsx'), "function App() { return <p>hi</p>; }\nexport default <App />;\n");
  const logged = [];
  const logger = createLogger('error', { allowClearScreen: false });
  logger.error = (msg) => logged.push(String(msg));
  logger.warn = (msg) => logged.push(String(msg));
  const vite = await createServer({
    root, configFile: false, cacheDir: path.join(root, '.vite'), customLogger: logger,
    server: { middlewareMode: true, hmr: false },
    plugins: [whatVitePlugin({ prodBundles: false, hot: false })],
  });
  try {
    const optimizer = vite.environments.client.depsOptimizer;
    assert.ok(optimizer, 'the client environment runs the dependency optimizer');
    // A middleware-mode server starts the optimizer when asked; listen() would.
    await optimizer.init();
    await optimizer.scanProcessing;
    assert.deepEqual(logged.filter((m) => /dependency scan|jsx-dev-runtime/.test(m)), []);
  } finally {
    await vite.close();
  }
});
