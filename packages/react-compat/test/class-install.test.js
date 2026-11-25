// what-react's Vite plugin installs class components (`what-react/class`)
// in a module whose code has the class marker's name in it, so a class marked
// `isReactComponent` without Component renders in a production build, from
// an ES module or a CommonJS dependency, in any spelling of the marker. Text
// is not an install (a comment that names `what-react/class`). The name as
// text counts as a marker: that costs the class code, and the app still
// renders.
// Production builds through Vite of an installed layout, run in jsdom.
// Run: node --test packages/react-compat/test/class-install.test.js
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
const FRAMEWORK = { 'what-framework': 'what', 'what-core': 'core', 'what-react': 'react-compat' };

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-class-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const root = path.join(scratch, 'app');
for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
  for (const entry of ['package.json', 'src']) {
    fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
  }
}

// Each dependency marks its class by hand, and says in a comment how the
// class is installed: the comment names the installer, it does not import it.
const COMMENT = '// This class can be installed via what-react/class.\n';
// The ways a dependency marks a class, as written or as a minifier writes them.
const MARKS = {
  quoted: "Object.assign(Marked.prototype, { 'isReactComponent': {} });",
  getter: 'Object.defineProperties(Marked.prototype, Object.getOwnPropertyDescriptors({ get isReactComponent() { return {}; } }));',
  define: "Object.defineProperty(Marked.prototype, 'isReactComponent', { value: {} });",
  minified: "if (!('isReactComponent'in Marked.prototype)) Object.assign(Marked.prototype, { ['isReact' + 'Component']: {} });",
};
const files = {
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
  'node_modules/marked-esm/package.json': JSON.stringify({ name: 'marked-esm', type: 'module', main: 'index.js' }),
  'node_modules/marked-esm/index.js': `${COMMENT}import { createElement } from 'react';
export class EsmMarked {
  constructor(props) { this.props = props; }
  componentDidMount() { window.__log.push('esm mounted'); }
  render() { return createElement('b', { id: 'esm' }, 'esm ' + this.props.n); }
}
EsmMarked.prototype.isReactComponent = {};
`,
  'node_modules/marked-cjs/package.json': JSON.stringify({ name: 'marked-cjs', main: 'index.js' }),
  'node_modules/marked-cjs/index.js': `${COMMENT}const React = require('react');
function CjsMarked(props) { this.props = props; }
CjsMarked.prototype.isReactComponent = {};
CjsMarked.prototype.componentDidMount = function () { window.__log.push('cjs mounted'); };
CjsMarked.prototype.render = function () { return React.createElement('b', { id: 'cjs' }, 'cjs ' + this.props.n); };
module.exports = { CjsMarked };
`,
  ...Object.fromEntries(Object.entries(MARKS).flatMap(([name, mark]) => [
    [`node_modules/marked-${name}/package.json`, JSON.stringify({ name: `marked-${name}`, type: 'module', main: 'index.js' })],
    [`node_modules/marked-${name}/index.js`, `import { createElement } from 'react';
export class Marked {
  constructor(props) { this.props = props; }
  render() { return createElement('b', { id: '${name}' }, '${name}'); }
}
${mark}
`],
    [`src/${name}.jsx`, `import { createRoot } from 'react-dom/client';
import { Marked } from 'marked-${name}';
window.__log = [];
createRoot(document.getElementById('app')).render(<Marked />);
`],
  ])),
  // One dependency per app: a CommonJS dependency's require('react') holds
  // all of React's exports, Component's definition with them.
  'src/esm.jsx': `import { createRoot } from 'react-dom/client';
import { EsmMarked } from 'marked-esm';
window.__log = [];
createRoot(document.getElementById('app')).render(<main><EsmMarked n={1} /></main>);
`,
  'src/cjs.jsx': `import { createRoot } from 'react-dom/client';
import { CjsMarked } from 'marked-cjs';
window.__log = [];
createRoot(document.getElementById('app')).render(<main><CjsMarked n={2} /></main>);
`,
  // No class: the marker's name only as text.
  'src/mentions.jsx': `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
function App() {
  const [word] = useState('isReactComponent');
  return <p id="word">{word}</p>;
}
createRoot(document.getElementById('app')).render(<App />);
`,
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

async function clientBuild(entry) {
  const outDir = path.join(root, `dist-${entry}`);
  await quiet(() => build({
    root, configFile: false, logLevel: 'silent',
    plugins: [reactCompat()],
    // From the packages' source (bundle.test.js).
    resolve: { conditions: ['browser'] },
    build: { outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: path.join(root, 'src', `${entry}.jsx`) } },
  }));
  const assets = path.join(outDir, 'assets');
  return path.join(assets, fs.readdirSync(assets).find((f) => f.startsWith(`${entry}-`) && f.endsWith('.js')));
}

const bundles = { esm: await clientBuild('esm'), cjs: await clientBuild('cjs'), mentions: await clientBuild('mentions') };
for (const name of Object.keys(MARKS)) bundles[name] = await clientBuild(name);

const { installDOM } = await import(path.join(REPO, 'test-utils/dom.js'));
installDOM();
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

async function run(bundle) {
  document.body.innerHTML = '<div id="app"></div>';
  const printed = [];
  const { error, warn } = console;
  console.error = (...args) => printed.push(`error: ${args.join(' ')}`);
  console.warn = (...args) => printed.push(`warn: ${args.join(' ')}`);
  try {
    await import(pathToFileURL(bundle).href);
    await settle();
    return { html: document.getElementById('app').innerHTML, printed };
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

// The class wrapper's code: only it reads this lifecycle method.
const CLASS_CODE = /getSnapshotBeforeUpdate/;

test('a marked class from an ES module dependency renders, though the module names what-react/class in a comment (production build)', async () => {
  assert.ok(CLASS_CODE.test(fs.readFileSync(bundles.esm, 'utf8')), 'class components installed');
  const { html, printed } = await run(bundles.esm);
  assert.deepEqual(printed, []);
  assert.equal(html, '<main><b id="esm">esm 1</b></main>');
  assert.deepEqual(window.__log, ['esm mounted']);
});

test('a marked class from a CommonJS dependency renders, though the module names what-react/class in a comment (production build)', async () => {
  const { html, printed } = await run(bundles.cjs);
  assert.deepEqual(printed, []);
  assert.equal(html, '<main><b id="cjs">cjs 2</b></main>');
  assert.deepEqual(window.__log, ['cjs mounted']);
});

for (const [name, mark] of Object.entries(MARKS)) {
  test(`a class marked with \`${mark.slice(0, 60)}\` renders (production build)`, async () => {
    const { html, printed } = await run(bundles[name]);
    assert.deepEqual(printed, []);
    assert.equal(html, `<b id="${name}">${name}</b>`);
  });
}

// The marker's name as text installs class components too: a false positive
// that costs the class code and changes nothing else.
test('an app that renders the string isReactComponent, with no class, renders (and carries the class code) (production build)', async () => {
  const code = fs.readFileSync(bundles.mentions, 'utf8');
  assert.ok(CLASS_CODE.test(code), 'class code');
  const { html, printed } = await run(bundles.mentions);
  assert.deepEqual(printed, []);
  assert.equal(html, '<p id="word">isReactComponent</p>');
});
