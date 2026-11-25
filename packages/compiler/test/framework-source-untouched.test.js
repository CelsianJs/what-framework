// The framework's own source is never compiled as an app's.
//
// b74c5b5d made a rest element of the props always live (_$omit). It passed
// every local gate and broke Headless UI's <Dialog> in the dev server only:
// there what-react is served from its source, what-compiler's Vite plugin
// compiled that source as a user's file (a workspace link is outside
// node_modules, and in development any module importing what-core gets
// development names), and what-react's forwardRef() destructures `ref` from
// props to call a render function, so the render function was handed an
// object with no prototype, and `props.hasOwnProperty('open')` threw. Nothing
// compiled the framework's own files through its own plugin.
//
// This compiles every file under packages/*/src, and the shapes plain
// JavaScript libraries are written in, the way the Vite plugin does, in every
// mode it uses, and asserts the output is the input wherever there is no JSX.
// Then it asks the Vite plugin which files it takes, for an app that has
// What's packages from a workspace link, an npm install and a pnpm install.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from '@babel/core';
import whatBabel from '../src/babel-plugin.js';
import what from '../src/vite-plugin.js';
import { isFrameworkFile } from '../src/framework-files.js';
import * as fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// The option sets the Vite plugin hands the Babel plugin (vite-plugin.js
// transform): the dev server's client and server transforms, a production
// build's, each with and without hydratable output.
const MODES = {
  'dev': { generate: 'dom', production: false, devMetadata: true },
  'dev, hydratable': { generate: 'dom', hydratable: true, production: false, devMetadata: true },
  'dev, server': { generate: 'ssr', production: false, devMetadata: true },
  'build': { generate: 'dom', production: true },
  'build, hydratable': { generate: 'dom', hydratable: true, production: true },
  'build, server': { generate: 'ssr', production: true },
};

const parse = (file) => ({ plugins: [...(/\.[jt]sx$/.test(file) ? ['jsx'] : []), ...(/\.[cm]?tsx?$/.test(file) ? ['typescript'] : [])] });

function compile(code, file, opts) {
  return transformSync(code, {
    filename: file, configFile: false, babelrc: false, compact: false, highlightCode: false,
    plugins: opts ? [[whatBabel, { projectRoot: root, ...opts }]] : [],
    parserOpts: parse(file),
  }).code;
}

// The first line where two outputs part, for the message.
function firstDifference(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  return `line ${i + 1}: ${JSON.stringify((y[i] || '').trim().slice(0, 160))}`;
}

const hasJsx = (code, file) => /\.[jt]sx$/.test(file) && /<[A-Za-z>]/.test(code);

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.[cm]?[jt]sx?$/.test(name) && !name.endsWith('.d.ts')) out.push(full);
    }
  };
  for (const pkg of readdirSync(path.join(root, 'packages'))) {
    const src = path.join(root, 'packages', pkg, 'src');
    try { if (statSync(src).isDirectory()) walk(src); } catch { /* no src */ }
  }
  return out;
}

describe('the framework\'s own source, compiled by its own compiler', () => {
  const files = sourceFiles();

  it('finds the packages\' source', () => {
    assert.ok(files.length > 150, `${files.length} files`);
    for (const pkg of ['core', 'react-compat', 'router', 'server', 'compiler']) {
      assert.ok(files.some((f) => f.includes(`${path.sep}packages${path.sep}${pkg}${path.sep}src${path.sep}`)), pkg);
    }
  });

  it('every file with no JSX comes out as it went in, in every mode the Vite plugin uses', () => {
    const changed = [];
    for (const file of files) {
      const code = readFileSync(file, 'utf8');
      if (hasJsx(code, file)) continue;
      const same = compile(code, file, null);
      for (const [mode, opts] of Object.entries(MODES)) {
        const out = compile(code, file, opts);
        if (out !== same) changed.push(`${path.relative(root, file)} (${mode}) ${firstDifference(same, out)}`);
      }
    }
    assert.deepEqual(changed, []);
  });

  it('a file with JSX that What publishes (what-devtools/panel) compiles, with no development names on its primitives', () => {
    const file = path.join(root, 'packages/devtools/src/DevPanel.jsx');
    const out = compile(readFileSync(file, 'utf8'), file, MODES.dev);
    assert.match(out, /_\$template\(/);
    assert.doesNotMatch(out, /signal\([^)]*"[A-Za-z_$][\w$]*@packages\//);
  });

  it('every file is What\'s own, and none of its tests or fixtures are', () => {
    for (const file of files) assert.equal(isFrameworkFile(file, fs), true, path.relative(root, file));
    for (const file of [
      'packages/compiler/test/framework-source-untouched.test.js',
      'packages/react-compat/test/fixtures/matrix/src/main.jsx',
      'packages/devtools/test/fixture-app.jsx',
      'examples/todomvc/src/App.jsx',
    ]) assert.equal(isFrameworkFile(path.join(root, file), fs), false, file);
  });
});

// Plain JavaScript as libraries write it, in an app's own files (outside any
// What package): none of it is a component, so none of it is rewritten. Each
// shape is one a rewrite that runs without JSX could take for its own:
// props read where they are used (forwardRef, the factory, the reducer, the
// HOC, the class), a signal read, a `.map()`, an event handler, a prop alias.
const SHAPES = {
  forwardRef: `
    export function forwardRef(render) {
      function ForwardRefComponent(props) {
        const { ref, ...rest } = props;
        return render(rest, ref || null);
      }
      ForwardRefComponent.displayName = 'ForwardRef';
      return ForwardRefComponent;
    }`,
  'higher-order component': `
    export function withTheme(Component) {
      return function Themed(props) {
        const { theme = 'light', ...rest } = props;
        return Component({ ...rest, theme });
      };
    }`,
  class: `
    export class Store {
      constructor({ initial, ...options }) { this.value = initial; this.options = options; }
      update({ value, ...meta }) { this.value = value; return meta; }
      get Current() { return this.value; }
    }`,
  'capitalised factory with a destructured argument': `
    export function Point({ x, y, ...rest }) { return { x, y, extra: rest }; }
    export const Size = ({ width, height }) => width * height;
    export function Pick({ value }) { return { value }; }`,
  reducer: `
    export function reducer(state, action) {
      const { items, ...rest } = state;
      switch (action.type) {
        case 'add': return { ...rest, items: [...items, action.item] };
        default: return state;
      }
    }`,
  'helpers that read their argument': `
    export function pick(o) { return o.value; }
    export const first = ({ items }) => items[0];
    export function Label(options) { const ev = options.ev; return ev.label; }`,
  'a signal read, a .map(), an event handler': `
    export function total(count, rows) { return count() + rows.map((r) => r.n).reduce((a, b) => a + b, 0); }
    export const handlers = { onClick: (e) => e.preventDefault(), onInput: () => {} };
    export function Rows({ list }) { return list.map((item) => ({ key: item.id, label: item.name })); }`,
};

describe('plain JavaScript library shapes in an app\'s own files', () => {
  let dir;
  before(() => { dir = mkdtempSync(path.join(tmpdir(), 'what-shapes-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  for (const [name, code] of Object.entries(SHAPES)) {
    for (const ext of ['.js', '.ts', '.jsx']) {
      it(`${name} (${ext}) comes out as it went in`, () => {
        const file = path.join(dir, `shape${ext}`);
        const same = compile(code, file, null);
        for (const [mode, opts] of Object.entries(MODES)) {
          const out = compile(code, file, opts);
          assert.equal(out, same, `${mode}: ${firstDifference(same, out)}`);
        }
      });
    }
  }
});

// The files the Vite plugin takes, for an app whose What packages come from a
// workspace link, an npm install and a pnpm install. Vite hands a plugin the
// real path of a module (it resolves symlinks), so a workspace link's files
// arrive under the package's own directory, outside node_modules.
describe('the Vite plugin takes the app\'s files, not a dependency\'s', () => {
  let base;
  let app;
  const files = {};
  const SOURCE = `import { h, signal } from 'what-core';\nexport function forwardRef(render) { function ForwardRefComponent(props) { const { ref, ...rest } = props; return render(rest, ref || null); } return ForwardRefComponent; }\nexport const count = signal(0);\n`;
  const pkg = (dir, name) => {
    mkdirSync(path.join(dir, 'src'), { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '0.15.0', type: 'module', files: ['src'] }));
    writeFileSync(path.join(dir, 'src', 'index.js'), SOURCE);
    writeFileSync(path.join(dir, 'src', 'Panel.jsx'), `export function Panel(props) { return <div>{props.children}</div>; }\n`);
    return path.join(dir, 'src', 'index.js');
  };

  before(() => {
    base = realpathSync(mkdtempSync(path.join(tmpdir(), 'what-installs-')));
    app = path.join(base, 'app');
    mkdirSync(path.join(app, 'src'), { recursive: true });
    writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'my-app', private: true, type: 'module' }));
    writeFileSync(path.join(app, 'src', 'store.js'), `import { signal } from 'what-framework';\nexport const count = signal(0);\nexport function Wrapper(props) { return props.children; }\n`);
    // A workspace: the package's directory, linked into the app's node_modules.
    files.workspace = pkg(path.join(base, 'packages', 'react-compat'), 'what-react');
    mkdirSync(path.join(app, 'node_modules'), { recursive: true });
    symlinkSync(path.join(base, 'packages', 'react-compat'), path.join(app, 'node_modules', 'what-react'), 'dir');
    // npm: the package's files under node_modules.
    files.npm = pkg(path.join(app, 'node_modules', 'what-router'), 'what-router');
    // pnpm: under node_modules/.pnpm, linked from node_modules.
    files.pnpm = pkg(path.join(app, 'node_modules', '.pnpm', 'what-core@0.15.0', 'node_modules', 'what-core'), 'what-core');
    // A React package from npm.
    files.react = pkg(path.join(app, 'node_modules', '@headlessui', 'react'), '@headlessui/react');
  });
  after(() => rmSync(base, { recursive: true, force: true }));

  function transform(file, { command, ssr = false, options = {} }) {
    const plugin = what({ production: command === 'build', ...options });
    plugin.configResolved({ root: app, command, appType: 'spa', build: {} });
    const result = plugin.transform.call({ getCombinedSourcemap: () => null }, readFileSync(file, 'utf8'), file, ssr ? { ssr: true } : undefined);
    return result === null || result === undefined ? null : result.code;
  }

  for (const command of ['serve', 'build']) {
    for (const ssr of [false, true]) {
      const mode = `${command === 'serve' ? 'dev server' : 'build'}${ssr ? ', server' : ''}`;
      it(`${mode}: a workspace link, an npm and a pnpm install of a What package are not compiled; a React package is not either`, () => {
        for (const [layout, file] of Object.entries(files)) {
          assert.equal(realpathSync(file), file, layout);
          assert.equal(transform(file, { command, ssr }), null, `${layout}: ${path.relative(base, file)}`);
        }
      });
    }
  }

  it('a JSX file What publishes is compiled from a workspace link, for its JSX only', () => {
    const out = transform(path.join(base, 'packages', 'react-compat', 'src', 'Panel.jsx'), { command: 'serve' });
    assert.match(out, /_\$template\(/);
    assert.equal(transform(path.join(app, 'node_modules', 'what-router', 'src', 'Panel.jsx'), { command: 'serve' }), null, 'npm');
  });

  it('the app\'s own plain module is compiled in the dev server as before: its signals get development names', () => {
    const out = transform(path.join(app, 'src', 'store.js'), { command: 'serve' });
    assert.match(out, /signal\(0, "count@src\/store\.js:2:22"\)/);
    assert.match(out, /_\$place\(props, "children"\)/, 'a component named as one, returning a prop');
    assert.equal(transform(path.join(app, 'src', 'store.js'), { command: 'build' }), null);
  });

  it('a custom `exclude` does not let node_modules in; `compileDependencies` opts a path in, compiled as the app\'s', () => {
    assert.equal(transform(files.npm, { command: 'serve', options: { exclude: /\.test\.jsx$/ } }), null);
    const optedIn = transform(files.npm, { command: 'serve', options: { compileDependencies: /what-router/ } });
    assert.match(optedIn, /signal\(0, "count@/);
    const workspace = transform(files.workspace, { command: 'serve', options: { compileDependencies: [(id) => id.includes('react-compat')] } });
    assert.match(workspace, /signal\(0, "count@/);
  });
});
