// SPRINT v0.11 C8 — golden-output snapshot tests.
// Exact-compare the compiler's emitted code for representative components.
// Any intentional codegen change must regenerate the snapshots:
//
//   UPDATE_SNAPSHOTS=1 node --test packages/compiler/test/golden-output.test.js
//
// Snapshots live in packages/compiler/test/__snapshots__/<name>.jsx.snap and
// are committed — diffs of generated output show up in code review.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import babelPlugin from '../src/babel-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAP_DIR = path.join(__dirname, '__snapshots__');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';

function compile(source) {
  return transformSync(source, {
    filename: 'fixture.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  })?.code || '';
}

const FIXTURES = {
  counter: `
import { signal } from 'what-framework';
export function Counter() {
  const count = signal(0);
  return (
    <div class="counter">
      <span>Count: {count()}</span>
      <button onClick={() => count(c => c + 1)}>+1</button>
    </div>
  );
}
`,

  'keyed-list': `
import { signal } from 'what-framework';
export function TodoList() {
  const todos = signal([]);
  return (
    <ul class="todos">
      {todos().map(todo => <li key={todo.id}>{todo.title}</li>)}
    </ul>
  );
}
`,

  conditional: `
import { signal } from 'what-framework';
export function Status() {
  const count = signal(0);
  const user = signal(null);
  return (
    <div>
      {count() > 5 ? <strong>big</strong> : <em>small</em>}
      {user() && <p>logged in</p>}
      <Show when={count() > 0} fallback={<p>zero</p>}><p>positive</p></Show>
    </div>
  );
}
`,

  spread: `
export function Card(props) {
  return (
    <div {...props}>
      <h2 {...props.headerProps}>title</h2>
    </div>
  );
}
`,

  svg: `
import { signal } from 'what-framework';
export function Icon() {
  const active = signal(false);
  return (
    <svg viewBox="0 0 24 24" width="24" height="24">
      <circle cx="12" cy="12" r="10" fill={active() ? 'red' : 'gray'} />
      <path d="M4 12h16" />
    </svg>
  );
}
`,

  'component-with-children': `
import { signal } from 'what-framework';
function Layout({ children }) {
  return <main class="layout">{children}</main>;
}
export function Page() {
  const title = signal('Home');
  return (
    <Layout theme="dark">
      <h1>{title()}</h1>
      <p>Welcome</p>
    </Layout>
  );
}
`,
};

describe('C8: golden compiler output snapshots', () => {
  for (const [name, source] of Object.entries(FIXTURES)) {
    it(`matches snapshot: ${name}`, () => {
      const output = compile(source);
      const snapFile = path.join(SNAP_DIR, `${name}.jsx.snap`);

      if (UPDATE) {
        mkdirSync(SNAP_DIR, { recursive: true });
        writeFileSync(snapFile, output);
        return;
      }

      assert.ok(existsSync(snapFile),
        `missing snapshot ${snapFile} — run UPDATE_SNAPSHOTS=1 node --test ${path.relative(process.cwd(), fileURLToPath(import.meta.url))}`);
      const expected = readFileSync(snapFile, 'utf8');
      assert.equal(output, expected,
        `compiled output for "${name}" changed. If intentional, regenerate with UPDATE_SNAPSHOTS=1`);
    });
  }
});
