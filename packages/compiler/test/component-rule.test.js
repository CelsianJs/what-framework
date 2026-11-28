// Which functions the props rewrites apply to (common.js "Which functions
// are components", docs/ARCHITECTURE.md "Which functions are components").
//
// A destructured prop read where it is used, a rest element kept live
// (_$omit), a returned prop placed (_$place): each changes what the
// function's parameter reads, so it is right for a component and wrong for
// anything else. b74c5b5d applied the rest rewrite to every function with one
// parameter, and what-react's forwardRef(), compiled in the dev server,
// handed Headless UI an object it could not call hasOwnProperty on.
//
// A component is a function that renders JSX, whatever its name, or one with
// no JSX that is named as a component and calls What's h() or returns a prop
// as it is. Both sides are tested here, in .jsx, .js and .ts files.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from '@babel/core';
import whatBabel from '../src/babel-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function compile(code, file, opts = {}) {
  return transformSync(code, {
    filename: file, configFile: false, babelrc: false, compact: false, highlightCode: false,
    plugins: [[whatBabel, { projectRoot: root, ...opts }]],
    parserOpts: { plugins: ['jsx', 'typescript'] },
  }).code;
}
const plain = (code, file) => transformSync(code, {
  filename: file, configFile: false, babelrc: false, compact: false, highlightCode: false, parserOpts: { plugins: ['jsx', 'typescript'] },
}).code;
const flat = (code) => code.replace(/\s+/g, ' ');

// An app's file, outside any What package.
let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'what-components-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const userFile = (ext) => path.join(dir, `file${ext}`);

const H = `import { h } from 'what-framework';\n`;

describe('a component: its props are read where they are used', () => {
  for (const ext of ['.jsx', '.js', '.ts']) {
    it(`${ext}: a component written with h() keeps its rest element live`, () => {
      for (const source of [
        `${H}export function Box({ as, ...rest }) { return h(as, rest); }`,
        `${H}export const Box = ({ as: Tag = 'div', ...rest }) => h(Tag, rest);`,
        `import * as What from 'what-framework';\nexport function Box(props) { const { as, ...rest } = props; return What.h(as, rest); }`,
        `${H}export default function ({ as, ...rest }) { return h(as, rest); }`,
        `${H}const Tabs = {}; Tabs.Panel = ({ id, ...rest }) => h('section', rest);`,
      ]) {
        assert.match(flat(compile(source, userFile(ext))), /rest = _\$omit\(/, source);
      }
    });

    it(`${ext}: a component that returns a prop places it`, () => {
      for (const source of [
        `export function Wrapper(props) { return props.children; }`,
        `export const Wrapper = ({ children }) => children;`,
        `export function Provider(props) { const { children } = props; return children; }`,
        `export const Maybe = (props) => (props.show ? props.children : null);`,
      ]) {
        assert.match(flat(compile(source, userFile(ext))), /_\$place\(/, source);
      }
    });

    it(`${ext}: a function that renders JSX is a component whatever its name`, () => {
      if (ext === '.ts') return;
      const out = flat(compile(`export const row = ({ as: Tag, ...rest }) => <Tag {...rest} />;`, userFile(ext)));
      assert.match(out, /rest = _\$omit\(/);
    });
  }
});

describe('not a component: it comes out as it went in', () => {
  for (const ext of ['.jsx', '.js', '.ts']) {
    it(`${ext}: forwardRef(), a factory, a reducer, a higher-order component, a class, helpers`, () => {
      for (const source of [
        // what-react's forwardRef(): it calls the render function it was given.
        `export function forwardRef(render) { function ForwardRefComponent(props) { const { ref, ...rest } = props; return render(rest, ref || null); } return ForwardRefComponent; }`,
        // A capitalised factory that destructures its argument.
        `export function Point({ x, y, ...rest }) { return { x, y, extra: rest }; }`,
        `export const Config = ({ name, ...options }) => ({ name, options });`,
        // A reducer: its first parameter is state, not props.
        `export function reducer(state, action) { const { items, ...rest } = state; return action.type === 'add' ? { ...rest, items: [...items, action.item] } : state; }`,
        // A higher-order component that calls the component it wraps.
        `export function withTheme(Component) { return function Themed(props) { const { theme, ...rest } = props; return Component({ ...rest, theme }); }; }`,
        // A class's methods.
        `export class Store { constructor({ initial, ...options }) { this.value = initial; this.options = options; } update({ value, ...meta }) { return meta; } }`,
        // A helper that returns a field of its argument, and one that calls h() but is not named as a component.
        `export function pick(o) { return o.value; }`,
        `export const first = ({ items }) => items;`,
        `${H}export function icon({ name, ...rest }) { return h('svg', rest, name); }`,
        // Named as a component, but it neither renders with h() nor returns a prop.
        `export function Label(options) { const { ev, ...rest } = options; return format(ev.label, rest); }`,
      ]) {
        const file = userFile(ext);
        assert.equal(compile(source, file), plain(source, file), source);
      }
    });
  }

  it('in What\'s own packages, a function with no JSX is never a component', () => {
    const file = path.join(root, 'packages/router/src/index.js');
    for (const source of [
      `${H}export function Link({ href, ...rest }) { return h('a', { href, ...rest }); }`,
      `export function Fragment(props) { return props.children; }`,
    ]) assert.equal(compile(source, file), plain(source, file), source);
    // appSource (the Vite plugin's compileDependencies) compiles it as an app's.
    assert.match(flat(compile(`${H}export function Link({ href, ...rest }) { return h('a', { href, ...rest }); }`, file, { appSource: true })), /rest = _\$omit\(/);
  });
});

// The component written with h() in a plain .js file follows the parent's
// state, as React's would: its rest element keeps the live props, so the
// component it hands them to reads the current values. (An element h() builds
// reads its props once, rest element or not: h()'s own rule.)
describe('a component written with h() in a .js file, rendered from JSX', () => {
  let cleanup;
  before(() => { ({ cleanup } = installDOM()); });
  after(() => cleanup());

  it('shows the parent\'s new state through its rest element', async () => {
    const resolveWhat = (code) => code.replace(/(['"])(what-framework(?:\/[\w-]+)?)\1/g, (_m, _q, entry) => JSON.stringify(import.meta.resolve(entry)));
    const box = path.join(dir, 'box.js');
    writeFileSync(box, resolveWhat(compile(`${H}export function Box({ as, ...rest }) { return h(as, rest); }`, box)));
    const app = path.join(dir, 'app.jsx');
    writeFileSync(app.replace(/\.jsx$/, '.mjs'), resolveWhat(compile(`
      import { signal, mount } from 'what-framework';
      import { Box } from ${JSON.stringify(pathToFileURL(box).href)};
      export const href = signal('/a');
      function Link(props) { return <a href={props.href}>{props.label}</a>; }
      export const run = (el) => mount(() => <Box as={Link} href={href()} label={href()} />, el);
    `, app)));
    const mod = await import(pathToFileURL(app.replace(/\.jsx$/, '.mjs')).href);
    const { flushSync } = await import(import.meta.resolve('what-framework'));
    const el = document.createElement('div');
    mod.run(el);
    assert.equal(el.querySelector('a').getAttribute('href'), '/a');
    mod.href('/b');
    flushSync();
    assert.equal(el.querySelector('a').getAttribute('href'), '/b');
    assert.equal(el.querySelector('a').textContent, '/b');
  });
});
