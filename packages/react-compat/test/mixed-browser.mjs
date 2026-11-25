// Mixed JSX in a real browser: test/fixtures/mixed with Vite (what-compiler's
// what() plus reactCompat()), loaded in headless Chromium and driven.
//   node packages/react-compat/test/mixed-browser.mjs          production build
//   node packages/react-compat/test/mixed-browser.mjs --dev    dev server
//   node packages/react-compat/test/mixed-browser.mjs --ssr    server render + hydrate (dev server, middleware mode)
//
// recharts comes from the fixture's node_modules (npm install there), or from
// RECHARTS_DIR.
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const fixture = path.join(here, 'fixtures/mixed');
const require = createRequire(path.join(repo, 'package.json'));
const { build, createServer } = await import(require.resolve('vite'));
const what = (await import(path.join(repo, 'packages/compiler/src/vite-plugin.js'))).default;
const { reactCompat } = await import(path.join(repo, 'packages/react-compat/src/vite-plugin.js'));
const { chromium } = require('playwright');

const dev = process.argv.includes('--dev');
const ssr = process.argv.includes('--ssr');
const core = path.join(repo, 'packages/core/src');
const installed = (() => {
  try { return path.dirname(createRequire(path.join(fixture, 'package.json')).resolve('recharts/package.json')); } catch { return null; }
})();
if (!installed && !process.env.RECHARTS_DIR) {
  console.log('SKIP: recharts is not installed in test/fixtures/mixed (npm install there, or set RECHARTS_DIR)');
  process.exit(0);
}

// The workspace's what-core, from source: a production build would otherwise
// pick dist/, which may be stale in a checkout.
const alias = [
  { find: /^what-(framework|core)\/render$/, replacement: path.join(core, 'render.js') },
  { find: /^what-core\/internal$/, replacement: path.join(core, 'entries/internal.js') },
  { find: /^what-(framework|core)$/, replacement: path.join(core, 'index.js') },
];
if (!installed) alias.push({ find: /^recharts$/, replacement: path.join(fs.realpathSync(process.env.RECHARTS_DIR), 'es6/index.js') });
const config = {
  configFile: false, root: fixture, base: './', logLevel: 'error',
  plugins: [what({ prodBundles: false }), reactCompat()],
  resolve: { alias },
  build: { outDir: path.join(fixture, 'dist'), minify: false, modulePreload: false },
  server: { port: 4655, strictPort: false },
  // A dependency found only once the page runs makes the dev server reload
  // the page: optimize the fixture's ones up front.
  cacheDir: path.join(fixture, 'node_modules/.vite-mixed'),
  optimizeDeps: { include: ['react-hook-form'] },
};

// The server's page: the render of entry-server.jsx inside the shell, with
// the client entry that hydrates it.
async function startSsr() {
  const vite = await createServer({ ...config, appType: 'custom', server: { middlewareMode: true, hmr: false } });
  const httpServer = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      try {
        const { render } = await vite.ssrLoadModule('/src/entry-server.jsx');
        // The server's elements, noted before the client entry runs: hydration
        // adopts them (hydrate.js).
        const note = '<script>window.__server = { ob: document.getElementById("ob"), kid: document.getElementById("kid"), counter: document.getElementById("counter"), main: document.getElementById("main").querySelectorAll("*").length };</script>';
        const shell = '<!doctype html><html><head></head><body><div id="main">' + render() + '</div>' + note + '<script type="module" src="/src/entry-client.jsx"></script></body></html>';
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url, shell));
      } catch (e) {
        vite.ssrFixStacktrace(e);
        res.statusCode = 500;
        res.end(String(e.stack || e));
      }
      return;
    }
    vite.middlewares(req, res, () => { res.statusCode = 404; res.end(); });
  });
  await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${httpServer.address().port}/`, close: async () => { httpServer.close(); await vite.close(); } };
}

const browser = await chromium.launch();
let server = null;
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n     ', e.message.split('\n').slice(0, 6).join('\n      ')); }
};
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text().slice(0, 300)); });

  if (ssr) {
    server = await startSsr();
    const served = await (await fetch(server.url)).text();
    // Two texts in a row are separated, as React separates them with <!-- -->,
    // so the browser keeps them as two nodes to adopt (hydrate.js).
    const html = served.replace(/<!--\$--><!--\/\$-->/g, '');
    check('the server renders the React islands', () => {
      assert.match(served, /<button id="ob">n<!--\$--><!--\/\$-->1<!--\$--><!--\/\$--> c<!--\$--><!--\/\$-->0<\/button>/, 'texts in a row are separated');
      assert.match(html, /<button id="ob">n1 c0<\/button>/, 'a React file\'s component');
      assert.match(html, /<i id="kid">hi 1<\/i>/, 'native-file children of a React component');
      assert.match(html, /<span[^>]* id="counter">badge 0 n1:(<!--\$-->)?0(<!--\/\$-->)?<\/span>/, 'a native component a React file renders');
      assert.match(html, /<h2 id="panel-title">Panel 1<\/h2>/, 'a native component inside a React provider');
      assert.match(html, /<span id="label">theme:light c0<\/span>/, 'React context through a native component');
      assert.match(html, /<span id="inner">theme:light c0<\/span>/, 'and into a React island inside it');
      assert.match(html, /class="recharts-wrapper"/, 'recharts renders its sized wrapper (its SVG waits for layout, as with React)');
      assert.match(html, /<!--\[\]--><li>a:0<\/li><!--\/\[\]--><!--\[\]--><li>b:0<\/li><!--\/\[\]-->/, 'React rows of a native keyed list, each bracketed');
    });
    await page.goto(server.url);
  } else if (dev) {
    server = await createServer(config);
    await server.listen();
    await page.goto(server.resolvedUrls.local[0]);
  } else {
    await build(config);
    const dist = path.join(fixture, 'dist');
    const js = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8')).join('\n');
    await page.setContent('<div id="main"></div>');
    await page.addScriptTag({ content: js, type: 'module' });
  }
  await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 }).catch((e) => {
    throw new Error(`the app did not mount: ${errors.join('\n') || e.message}`);
  });
  await page.waitForTimeout(100);

  const read = () => page.evaluate(() => {
    const text = (s) => document.querySelector(s)?.textContent ?? null;
    window.__svg ??= document.querySelector('svg.recharts-surface');
    window.__panel ??= document.querySelector('#panel');
    return {
      native: text('#native'),
      badge: text('#ob'),
      kid: text('#kid'),
      counter: text('#counter'),
      bars: document.querySelectorAll('.recharts-bar-rectangle').length,
      sameSvg: window.__svg === document.querySelector('svg.recharts-surface'),
      gone: text('#gone'),
      panelTitle: text('#panel-title'),
      panelBtn: text('#panel-btn'),
      samePanel: window.__panel === document.querySelector('#panel'),
      label: text('#label'),
      inner: text('#inner'),
      rhf: text('#rhf-out'),
      tags: [...document.querySelectorAll('#tags li')].map((li) => li.textContent).join(' '),
    };
  });
  const settle = () => page.waitForTimeout(80);

  let s = await read();
  check('first render', () => {
    assert.equal(s.native, '1');
    assert.equal(s.badge, 'n1 c0');
    assert.equal(s.kid, 'hi 1');
    assert.equal(s.counter, 'badge 0 n1:0');
    assert.equal(s.bars, 3);
    assert.equal(s.panelTitle, 'Panel 1');
    assert.equal(s.label, 'theme:light c0');
    assert.equal(s.inner, 'theme:light c0');
    assert.equal(s.rhf, 'ada');
  });

  if (ssr) {
    const adopted = await page.evaluate(() => ({ ob: window.__server.ob === document.getElementById('ob'), kid: window.__server.kid === document.getElementById('kid'), counter: window.__server.counter === document.getElementById('counter') }));
    check('hydration adopts the React islands\' elements', () => {
      assert.equal(adopted.ob, true, 'the server\'s <button> of a React file\'s component');
      assert.equal(adopted.kid, true, 'the server\'s native-file children of a React component');
    });
    // Adopted only with a what-core that walks a range of nodes (hydrate.js claimNative).
    console.log(`info a native component a React file renders (#counter): ${adopted.counter ? 'adopted' : 'built again'}`);
  }

  await page.click('#ob'); await page.click('#ob');
  await page.click('#counter');
  await page.click('#panel-btn');
  await page.click('#label');
  await page.click('#inner'); await page.click('#inner');
  await settle();
  s = await read();
  check('state in every layer', () => {
    assert.equal(s.badge, 'n1 c2', 'React state in a React file');
    assert.equal(s.counter, 'badge 2 n1:1', 'native state in a native component a React file renders, with its new props');
    assert.equal(s.panelBtn, 'clicks 1', 'native state in a native component inside a React provider');
    assert.equal(s.label, 'theme:light c1', 'React state in React children a native component places');
    assert.equal(s.inner, 'theme:light c2', 'React state in a React component a native component renders');
  });

  for (let i = 0; i < 5; i++) await page.evaluate(() => window.inc());
  await settle();
  s = await read();
  check('a native signal reaches every layer, and nothing loses state', () => {
    assert.equal(s.native, '6');
    assert.equal(s.badge, 'n6 c2', 'React file prop from a native signal');
    assert.equal(s.kid, 'hi 6', 'native-file children of a React component');
    assert.equal(s.counter, 'badge 2 n6:1', 'native component keeps state and sees new props');
    assert.equal(s.bars, 8, 'recharts data from a native signal');
    assert.equal(s.sameSvg, true, 'the chart was not rebuilt');
    assert.equal(s.panelTitle, 'Panel 6', 'live prop of a native component inside a React provider');
    assert.equal(s.samePanel, true, 'the native panel was not rebuilt');
    assert.equal(s.panelBtn, 'clicks 1');
    assert.equal(s.label, 'theme:dark c1', 'React context reaches React children through a native component');
    assert.equal(s.inner, 'theme:dark c2', 'React context reaches a React component inside a native component');
  });

  await page.click('#pick');
  await settle();
  s = await read();
  check('a React button calls a native handler', () => assert.equal(s.native, '16'));

  await page.fill('#rhf', 'grace');
  await settle();
  s = await read();
  check('react-hook-form in a file that only calls its hook', () => assert.equal(s.rhf, 'grace'));

  await page.click('#tags li:first-child');
  await settle();
  await page.evaluate(() => window.renameTag());
  await settle();
  s = await read();
  check('a React component in a native keyed list shows an updated item and keeps its state', () => assert.equal(s.tags, 'a2:1 b:0'));
  await page.evaluate(() => window.addTag());
  await settle();
  s = await read();
  check('and keeps it when a row is inserted before it', () => assert.equal(s.tags, 'c:0 a2:1 b:0'));

  await page.evaluate(() => window.hide());
  await settle();
  s = await read();
  check('the chart unmounts', () => {
    assert.equal(s.bars, 0);
    assert.equal(s.gone, 'gone');
  });

  if (process.env.DEBUG_MIXED) console.log(errors.join('\n'));
  check('no errors or warnings', () => assert.deepEqual(errors, []));
} finally {
  if (server) await server.close();
  await browser.close();
  fs.rmSync(path.join(fixture, 'dist'), { recursive: true, force: true });
}
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
