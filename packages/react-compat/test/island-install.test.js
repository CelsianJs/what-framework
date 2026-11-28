// Island hydration is installed before a module's own code runs. what-react's
// Vite plugin adds `import 'what-react/hydrate-islands'` to every module
// what-compiler compiles for hydration: an import is evaluated before the
// module's body, so a native entry that defines its page and calls hydrate()
// at its top level, in the same module, hydrates its islands by adopting the
// server's HTML. A call to the install added at the end of the module ran
// after that hydrate(), which had already replaced the island: the focused
// input the user had typed in was a new node, with the server's text and no
// focus (React keeps the node, the text and the focus).
//
// Production builds through Vite (a server build that renders the page, a
// client build of the entry), the client bundle run in jsdom on the server's
// HTML.
// Run: node --test packages/react-compat/test/island-install.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { reactCompat } from '../src/vite-plugin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const what = (await import(path.join(REPO, 'packages/compiler/src/vite-plugin.js'))).default;
const FRAMEWORK = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server', 'what-react': 'react-compat' };

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-install-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const root = path.join(scratch, 'app');
for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
  for (const entry of ['package.json', 'src']) {
    fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
  }
}
const files = {
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
  // A React file: an input whose default the island adopts.
  'src/Field.jsx': "import { useState } from 'react';\nexport function Field() {\n  const [text] = useState('initial');\n  return <input defaultValue={text} />;\n}\n",
  // A native entry that defines its page and hydrates it, in one module.
  'src/main.jsx': "import { hydrate } from 'what-framework';\nimport { Field } from './Field.jsx';\nfunction Page() {\n  return <main><Field /></main>;\n}\nhydrate(<Page />, document.getElementById('app'));\n",
  // The same page in a module of its own, and an entry that hydrates it.
  'src/Page.jsx': "import { Field } from './Field.jsx';\nexport function Page() {\n  return <main><Field /></main>;\n}\n",
  'src/boot.jsx': "import { hydrate } from 'what-framework';\nimport { Page } from './Page.jsx';\nhydrate(<Page />, document.getElementById('app'));\n",
  'src/entry-server.js': "import { h } from 'what-framework';\nimport { renderToHydratableString } from 'what-framework/server';\nimport { Page } from './Page.jsx';\nexport function render() { return renderToHydratableString(h(Page)); }\n",
};
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

async function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

async function clientBuild(entry, options = {}) {
  const outDir = path.join(root, `dist-${entry}${options.hydrateIslands === false ? '-claim' : ''}`);
  await quiet(() => build({
    root, configFile: false, logLevel: 'silent',
    plugins: [what({ hydratable: true, prodBundles: false }), reactCompat(options)],
    // From the packages' source (the copies here have no dist): the client
    // conditions without `production` and `module` (bundle.test.js).
    resolve: { conditions: ['browser'] },
    build: { outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: path.join(root, 'src', `${entry}.jsx`) } },
  }));
  const assets = path.join(outDir, 'assets');
  return path.join(assets, fs.readdirSync(assets).find((f) => f.startsWith(`${entry}-`) && f.endsWith('.js')));
}

// The server's HTML, rendered before there is a document.
const serverDir = path.join(root, 'dist-server');
await quiet(() => build({
  root, configFile: false, logLevel: 'silent', plugins: [what(), reactCompat()],
  build: { ssr: 'src/entry-server.js', outDir: serverDir, emptyOutDir: true },
}));
const { render } = await import(pathToFileURL(path.join(serverDir, fs.readdirSync(serverDir).find((f) => /^entry-server\.m?js$/.test(f)))).href);
const html = render();
const bundles = { main: await clientBuild('main'), boot: await clientBuild('boot'), claim: await clientBuild('main', { hydrateIslands: false }) };

const { installDOM } = await import(path.join(REPO, 'test-utils/dom.js'));
installDOM();
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

// The user typed into the server's input and it has focus; then the entry runs.
async function hydrateWithTyping(bundle) {
  document.body.innerHTML = `<div id="app">${html}</div>`;
  const input = document.querySelector('input');
  input.focus();
  input.value = 'typed';
  await import(pathToFileURL(bundle).href);
  await settle();
  const now = document.querySelector('input');
  return { same: now === input, value: now.value, focused: document.activeElement === input };
}

test('the server renders the island an entry will hydrate', () => {
  assert.match(html, /<main[^>]*><!--\[\]--><input value="initial"><!--\/\[\]--><\/main>/);
});

test('a native entry that calls hydrate() at its top level, in the module that defines its page, adopts the island (production build)', async () => {
  const code = fs.readFileSync(bundles.main, 'utf8');
  assert.ok(code.includes('native What content'), 'the bundle carries island adoption');
  // React (react-dom 19.3.1, hydrateRoot): the same node, the typed text, the focus.
  assert.deepEqual(await hydrateWithTyping(bundles.main), { same: true, value: 'typed', focused: true });
});

test('an entry that hydrates a page from another module adopts the island too (production build)', async () => {
  assert.deepEqual(await hydrateWithTyping(bundles.boot), { same: true, value: 'typed', focused: true });
});

test('with reactCompat({ hydrateIslands: false }) the island claims the server\'s region and renders over it, from an entry that hydrates its own page', async () => {
  const code = fs.readFileSync(bundles.claim, 'utf8');
  assert.ok(!code.includes('native What content'), 'no island adoption in the bundle');
  const r = await hydrateWithTyping(bundles.claim);
  // Rendered by the client in place of the server's input: one input, the client's.
  assert.equal(document.querySelectorAll('#app input').length, 1);
  assert.deepEqual(r, { same: false, value: 'initial', focused: false });
});
