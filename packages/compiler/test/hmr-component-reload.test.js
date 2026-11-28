import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { createServer } from 'vite';
import what from '../src/vite-plugin.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function hotCallback(window) {
  const plugin = what({ production: false });
  plugin.configResolved({ root, command: 'serve' });
  const { code } = plugin.transform('export default function Counter() { return <h1>Counter</h1>; }', join(root, 'Counter.jsx'));
  const boundary = code.slice(code.indexOf('// --- What Framework HMR Boundary ---'));
  let callback;
  runInNewContext(boundary.replaceAll('import.meta.hot', 'hot'), {
    window,
    hot: { accept(fn) { callback = fn; } },
  });
  return callback;
}

test('component update reloads when no replacement runtime is installed', () => {
  let reloads = 0;
  const callback = hotCallback({ location: { reload() { reloads++; } } });
  callback({ default() {} });
  assert.equal(reloads, 1);
  callback(undefined);
  assert.equal(reloads, 1, 'a removed module is left to Vite invalidation');
});

test('an installed component replacement hook is preserved', () => {
  const updates = [];
  const module = { default() {} };
  const callback = hotCallback({
    __WHAT_HMR_ACCEPT__(file, next) { updates.push([file, next]); },
    location: { reload() { assert.fail('the custom runtime owns replacement'); } },
  });
  callback(module);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][0], join(root, 'Counter.jsx'));
  assert.equal(updates[0][1], module);
});

const browserAvailable = await chromiumLaunches(chromium);

test('editing an imported component updates the visible app without a manual refresh', {
  skip: !browserAvailable,
  timeout: 60_000,
}, async () => {
  // Vite keys its module graph by canonical paths. On macOS tmpdir() goes
  // through /var -> /private/var; use the same path for writes and watching.
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'what-hmr-component-')));
  let server;
  let browser;
  try {
    await writeFile(join(fixture, 'index.html'), '<div id="app"></div><script type="module" src="/main.jsx"></script>');
    await writeFile(join(fixture, 'main.jsx'), "import { mount } from 'what-framework'; import Counter from './Counter.jsx'; mount(<Counter />, '#app');");
    const component = join(fixture, 'Counter.jsx');
    await writeFile(component, 'export default function Counter() { return <h1>HMR baseline</h1>; }');
    server = await createServer({
      root: fixture,
      configFile: false,
      logLevel: 'silent',
      plugins: [what({ production: false })],
      resolve: { alias: [
        { find: /^what-framework\/render$/, replacement: join(root, 'packages/core/src/render.js') },
        { find: /^what-framework$/, replacement: join(root, 'packages/core/src/index.js') },
      ] },
      server: { host: '127.0.0.1', port: 0, fs: { allow: [root, fixture] } },
    });
    await server.listen();
    browser = await chromium.launch();
    const page = await browser.newPage();
    const errors = [];
    const updates = [];
    // The server's answer to the edit, as the page receives it.
    let answered;
    const answer = new Promise((resolve) => { answered = resolve; });
    server.watcher.on('change', file => updates.push(`change: ${file}`));
    page.on('websocket', socket => socket.on('framereceived', (frame) => {
      const payload = String(frame.payload);
      updates.push(payload);
      if (/"type":"(update|full-reload)"/.test(payload)) answered(payload);
    }));
    page.on('console', message => updates.push(message.text()));
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) updates.push(`navigate: ${frame.url()}`); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'HMR baseline');
    // The edit, and the watcher's report of it. On a loaded machine FSEvents
    // reports a write late or not at all (rounds 6 and 11 saw the page
    // connect and no change arrive in ten seconds of writes). The watcher is
    // Vite's, not what this tests: when it has not reported the write within
    // a second, the test delivers the change it would have, so what is tested
    // is the plugin's update and the page's replacement of the component.
    const reported = new Promise((resolve) => server.watcher.on('change', (file) => { if (file === component) resolve('the watcher'); }));
    await writeFile(component, 'export default function Counter() { return <h1>HMR updated</h1>; }');
    const timers = [];
    const by = await Promise.race([reported, new Promise((resolve) => timers.push(setTimeout(resolve, 1000, 'the test')))]);
    if (by === 'the test') server.watcher.emit('change', component);
    // Each wait is on an event; the deadline is only there to report what
    // happened before the test's own timeout would.
    const deadline = Date.now() + 45_000;
    const late = (what) => new Promise((resolve, reject) => timers.push(setTimeout(() => reject(new Error(`no ${what}`)), Math.max(0, deadline - Date.now()))));
    try {
      await Promise.race([answer, late('update message from the server')]);
      await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'HMR updated', null, { timeout: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      assert.fail(`${error.message}\nThe change was delivered by ${by}.\nHMR events: ${JSON.stringify(updates)}\nPage errors: ${JSON.stringify(errors)}`);
    } finally {
      // A pending deadline would hold the process open for its full 45 s.
      for (const timer of timers) clearTimeout(timer);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(fixture, { recursive: true, force: true });
  }
});
