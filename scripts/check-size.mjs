#!/usr/bin/env node

// Size budget gate for What's production tier — zero dependencies beyond the
// repo's own esbuild, vite and node builtins. Bundles representative app
// entries the way a production app is built, gzips them, and compares them
// against the ceilings in .size-budgets.json. It also fails if any production
// bundle still contains development-only code (see DEV_SENTINELS below).
//
// Prerequisite: `node scripts/build.js` (dist/ must exist), and the mixed
//               browser fixture's install for the recharts scenario
//               (`npm ci --prefix packages/react-compat/test/fixtures/mixed`).
// Usage:        node scripts/check-size.mjs
// Attribution:  node benchmark/size/why.mjs <scenario> (what is in a
//               scenario's bundle, and what keeps each part there).
//
// Budgets are measured reality rounded up to the next 64 B. If a scenario
// legitimately grows past its ceiling, raise the budget in .size-budgets.json
// in the same PR — deliberately, with a reason in the diff.

import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(import.meta.dirname, '..');

const budgetsPath = resolve(repoRoot, '.size-budgets.json');
const budgets = JSON.parse(readFileSync(budgetsPath, 'utf8'));

// The production condition resolves what-core / what-framework to
// dist/*.min.js — those must exist or the measurement is meaningless.
const requiredDist = [
  'packages/core/dist/index.min.js',
  'packages/what/dist/index.min.js',
];
const missingDist = requiredDist.filter((f) => !existsSync(resolve(repoRoot, f)));
if (missingDist.length) {
  console.error('[check-size] Missing production build outputs:');
  for (const f of missingDist) console.error(`  - ${f}`);
  console.error('\nRun `node scripts/build.js` first.');
  process.exit(1);
}

// Strings only development code contains, one per line. Each must be present
// in a development bundle of every what-core export (so the list cannot go
// stale) and absent from every production app bundle, whichever files they
// resolve.
//   DEV_BRANCH_SENTINELS  text inside an `if (__DEV__)` branch: must be absent
//                         from the production library dist too.
//   DEV_MODULE_SENTINELS  the error catalogue (errors.js) and the diagnostics
//                         channel, which only development branches of an app
//                         reach. Both are public exports that tools read, so
//                         the library dist carries them; an app must not.
const DEV_BRANCH_SENTINELS = [
  'an effect flush',                                          // reactive.js: flushSync() misuse report
  'devFlight',                                               // reactive.js: async flight metadata
  'transition:held',                                         // reactive.js: transition observation
  'suspense:waiting',                                         // components.js: Suspense observation
  'hydration:complete',                                      // render.js: hydration observation
  'onComponentUnmount',                                       // reactive.js: devtools mount hooks and pre-install buffer
  'installed by importing h, ',                               // render.js: a vnode reaching the compiled-JSX runtime
];
const DEV_MODULE_SENTINELS = [
  'codeExample',                                              // errors.js: a field of every catalogue entry
  'ERR_INFINITE_EFFECT',                                      // reactive.js: the loop cap's report, and its entry
  'ERR_SIGNAL_WRITE_IN_COMPUTED',                             // reactive.js: a write inside a computed, and its entry
  'ERR_EFFECT_DEP_NOT_FUNCTION',                              // hooks.js: non-function useEffect dep, and its entry
  'so the effect cannot re-run when it changes',              // errors.js: that entry's message
  'takes no parameter, so it cannot read the store state',    // errors.js: derived() without state
  'change handler was called without an event',               // errors.js: register() handler misuse
  'could not {{operation}} localStorage',                     // errors.js: useLocalStorage failure
  'skills/what-diagnostics/SKILL.md',                         // diagnostics.js: the console's fix pointer
];

// Scenario (a): the what-core runtime as imported by a typical counter app.
const coreCounter = `
import { signal, h, mount } from 'what-core';

function Counter() {
  const count = signal(0, 'count');
  return h('main', { class: 'app-shell' },
    h('h1', {}, 'What Framework'),
    h('section', { class: 'counter' },
      h('button', { onclick: () => count((c) => c - 1) }, '-'),
      h('output', {}, () => count()),
      h('button', { onclick: () => count((c) => c + 1) }, '+'),
    ),
  );
}

mount(h(Counter, {}), '#app');
`;

// Scenarios (b) and (c): the create-what vanilla template entry (src/main.jsx,
// generateMainDefault in packages/create-what/index.js). (b) bundles it through
// the runtime JSX transform (jsxImportSource: what-framework), a conservative
// upper bound. (c) builds it the way the scaffold does, with what-compiler/vite.
const scaffoldCounter = `
import { mount, signal } from 'what-framework';

function App() {
  const count = signal(0);

  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <p>Compiler-first JSX, fine-grained signals.</p>

      <section className="counter">
        <button onClick={() => count(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count(c => c + 1)}>+</button>
      </section>
    </main>
  );
}

mount(<App />, '#app');
`;

async function esbuildBundle(name, { source, loader, conditions = ['production'] }) {
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: repoRoot,
      sourcefile: `${name}.${loader}`,
      loader,
    },
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    conditions,
    treeShaking: true,
    write: false,
    logLevel: 'silent',
    ...(loader === 'jsx' ? { jsx: 'automatic', jsxImportSource: 'what-framework' } : {}),
  });
  return result.outputFiles[0].contents;
}

// esbuild exactly as a user runs it for production with no configuration:
// bundle and minify, nothing else (`esbuild app.js --bundle --minify`). Its
// default conditions resolve the `module` export, the bundler tier, and
// minifying defines process.env.NODE_ENV as "production", which folds that
// tier's development checks.
async function esbuildDefaultBundle(name, source) {
  const result = await build({
    stdin: { contents: source, resolveDir: repoRoot, sourcefile: `${name}.js`, loader: 'js' },
    bundle: true,
    minify: true,
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].contents;
}

// A production `vite build` through what-compiler/vite. `fromSource` aliases the
// framework to packages/*/src, as the in-repo benchmarks do, instead of letting
// the plugin resolve the `production` condition to dist/*.min.js.
async function viteBundle(name, { source, fromSource = false, hydratable = false }) {
  const { build: viteBuild } = await import('vite');
  const { default: what } = await import('../packages/compiler/src/vite-plugin.js');
  const entry = join(repoRoot, `${name}.jsx`);
  const coreSrc = join(repoRoot, 'packages/core/src');
  const output = await viteBuild({
    configFile: false,
    root: repoRoot,
    logLevel: 'silent',
    mode: 'production',
    plugins: [
      { name: 'size-entry', enforce: 'pre', resolveId: (id) => (id === entry ? entry : null), load: (id) => (id === entry ? source : null) },
      what({ prodBundles: !fromSource, hydratable }),
    ],
    resolve: fromSource
      ? { alias: [
        { find: /^what-(?:framework|core)\/render$/, replacement: join(coreSrc, 'render.js') },
        { find: /^what-(?:framework|core)\/(a11y|ui|motion|dom|form|data)$/, replacement: join(coreSrc, 'entries/$1.js') },
        { find: /^what-(?:framework|core)$/, replacement: join(coreSrc, 'index.js') },
      ] }
      : {},
    build: { write: false, minify: true, target: 'es2022', modulePreload: false, rollupOptions: { input: entry } },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  return Buffer.concat(chunks.map((c) => Buffer.from(c.code)));
}

// Scenario (d): an app on the hooks, a store, a form and a helper, so that
// development-only code those modules reach is in the graph.
const hooksApp = `
import {
  mount, useState, useEffect, useMemo, useRef, useContext, createContext,
  createStore, derived, Show, For,
} from 'what-framework';
import { useForm } from 'what-framework/form';
import { useLocalStorage } from 'what-framework/dom';

const Theme = createContext('light');
const useTodos = createStore({
  items: [],
  remaining: derived((state) => state.items.filter((t) => !t.done).length),
  add(text) { this.items = [...this.items, { id: this.items.length + 1, text, done: false }]; },
});

function App() {
  const todos = useTodos();
  const [filter, setFilter] = useState('all');
  const draft = useLocalStorage('draft', '');
  const input = useRef(null);
  const theme = useContext(Theme);
  const form = useForm({ defaultValues: { title: '' } });
  const shown = useMemo(() => todos.items.filter((t) => filter() === 'all' || !t.done));
  useEffect(() => { document.title = todos.remaining + ' left'; });
  return (
    <main class={theme}>
      <form onSubmit={form.handleSubmit((v) => todos.add(v.title))}>
        <input ref={input} {...form.register('title')} placeholder={draft()} />
      </form>
      <button onClick={() => setFilter('active')}>Active</button>
      <Show when={() => shown().length > 0} fallback={<p>Nothing to do</p>}>
        <ul><For each={shown}>{(t) => <li>{t.text}</li>}</For></ul>
      </Show>
    </main>
  );
}

mount(<App />, '#app');
`;

// Scenario (e): the compiled counter with one h() call. Making a vnode is what
// brings in the vnode renderer, and with it the boundaries and the portal;
// compiled-counter, which makes none, must not carry them (see RENDERER below).
const compiledHCounter = `
import { h, mount, signal } from 'what-framework';

function App() {
  const count = signal(0);
  return (
    <main className="app-shell">
      <h1>What Framework</h1>
      <button onClick={() => count(c => c + 1)}>+</button>
      {h('output', {}, () => count())}
    </main>
  );
}

mount(<App />, '#app');
`;

// Scenarios (f) and (g): the diagnostics names on the root entry. An app checks
// `instanceof WhatError`, or reads what the development checks reported; neither
// needs the error catalogue, which only getErrorDefinition() and those checks
// read, and both must not carry it (see CATALOGUE below).
// An h() app with an <ErrorBoundary> and no computed: the boundary's reset
// must not bring the pull phase (round 5, PKG5-1).
const errorBoundaryApp = `
import { signal, h, mount, ErrorBoundary } from 'what-core';

const count = signal(0);
const fallback = ({ error, reset }) => h('button', { onclick: reset }, error.message);
mount(h(ErrorBoundary, { fallback }, h('output', {}, () => count())), '#app');
`;

const whatErrorApp = `
import { signal, WhatError } from 'what-framework';

const failures = signal(0);
window.addEventListener('error', (e) => {
  if (e.error instanceof WhatError) failures((n) => n + 1);
});
`;

const diagnosticsReadApp = `
import { signal, getDiagnostics, subscribeDiagnostics, clearDiagnostics } from 'what-framework';

const reported = signal(0);
subscribeDiagnostics(() => reported(getDiagnostics().events.length));
document.querySelector('button').onclick = clearDiagnostics;
`;

// Scenario (h): the compiled counter with one computed(). computed() takes a
// function that may return a promise, so it carries the async core; the
// transitions and the server data channel are installed by their first use
// (startTransition, a server render, hydrate()) and must not be here.
const computedCounter = `
import { mount, signal, computed } from 'what-framework';

function App() {
  const count = signal(0);
  const double = computed(() => count() * 2);
  return (
    <main className="app-shell">
      <button onClick={() => count(c => c + 1)}>+</button>
      <output>{double()}</output>
    </main>
  );
}

mount(<App />, '#app');
`;

// Scenario (i): an app on async values: an async computed read under a
// <Suspense> and an <ErrorBoundary>, a page change in a transition, and an
// optimistic add. What a counter pays for them is in the scenarios above.
const asyncApp = `
import {
  mount, signal, computed, refresh, Suspense, ErrorBoundary, For,
  startTransition, useTransition, useOptimistic,
} from 'what-framework';

function Todos(props) {
  const todos = computed(({ signal: abort }) =>
    fetch('/api/todos?page=' + props.page(), { signal: abort }).then((r) => r.json()));
  const [shown, addShown] = useOptimistic(todos, (list, todo) => [...list, todo]);
  const add = (text) => startTransition(async () => {
    addShown({ id: -1, text });
    await fetch('/api/todos', { method: 'POST', body: text });
    await refresh(todos);
  });
  return (
    <section class={todos.pending() ? 'stale' : ''}>
      <button onClick={() => add('New todo')}>Add</button>
      <ul><For each={shown}>{(t) => <li>{t.text}</li>}</For></ul>
    </section>
  );
}

function App() {
  const page = signal(1);
  const [paging, start] = useTransition();
  return (
    <main>
      <button disabled={paging()} onClick={() => start(() => page((p) => p + 1))}>Next page</button>
      <ErrorBoundary fallback={({ error, reset }) => <p onClick={reset}>{error.message}</p>}>
        <Suspense fallback={<p>Loading…</p>}>
          <Todos page={page} />
        </Suspense>
      </ErrorBoundary>
    </main>
  );
}

mount(<App />, '#app');
`;

// Scenario (k): an app on the data layer (docs/DATA.md): a query() read under a
// <Suspense>, a useActionState action that revalidates it, and a router whose
// navigations are transitions that wait for a route's preload.
const dataApp = `
import { mount, Suspense, useActionState } from 'what-framework';
import { query, invalidateQueries } from 'what-framework/data';
import { Router, Link } from 'what-framework/router';

const fetchJson = (key, { signal }) => fetch('/api/' + key.join('/'), { signal }).then((r) => r.json());
const todosQuery = () => query(['todos'], fetchJson, { staleTime: 5000 });

function Todos() {
  const todos = todosQuery();
  const [message, add, isPending] = useActionState(async (_, text) => {
    await fetch('/api/todos', { method: 'POST', body: text });
    await invalidateQueries(['todos']);
    return 'Added ' + text;
  }, '');
  return (
    <section class={todos.pending() ? 'stale' : ''}>
      <button disabled={isPending()} onClick={() => add('New todo')}>Add</button>
      <p>{message()}</p>
      <ul>{todos().map((t) => <li key={t.id}>{t.text}</li>)}</ul>
      <Link href="/about">About</Link>
    </section>
  );
}

const routes = [
  { path: '/', component: Todos, preload: todosQuery },
  { path: '/about', component: () => <h1>About</h1> },
];

mount(<Suspense fallback={<p>Loading…</p>}><Router routes={routes} /></Suspense>, '#app');
`;

// Scenario (j): a compiled app that hydrates the page a server rendered, built
// with what-compiler's hydratable option (the Vite plugin's choice for a
// project that renders on the server). It carries the hydration runtime and
// steps through its templates in document order; it makes no vnode, so it
// carries no vnode renderer either.
const hydratingCounter = `
import { hydrate, signal } from 'what-framework';

function App() {
  const count = signal(0);
  const items = signal(['a', 'b', 'c']);
  return (
    <main class="app-shell">
      <h1>What Framework</h1>
      <section class="counter">
        <button onClick={() => count(c => c - 1)}>-</button>
        <output>{count()}</output>
        <button onClick={() => count(c => c + 1)}>+</button>
      </section>
      <ul>{() => items().map(item => <li key={item}>{item}</li>)}</ul>
    </main>
  );
}

hydrate(<App />, document.getElementById('app'));
`;

// Scenario (l): a React app on what-react (REACT-COMPAT.md, full compat): the
// counter as React code writes it, built with reactCompat() alone, which
// aliases react and react-dom/client to what-react. What an app pays for the
// React-compatible runtime: the reconciler, the hooks, the synthetic events
// and the controlled fields, on top of the part of what-core they stand on.
const reactCounter = `
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => { document.title = 'count ' + count; }, [count]);
  return (
    <main>
      <h1>Counter</h1>
      <button onClick={() => setCount(count - 1)}>-</button>
      <output>{count}</output>
      <button onClick={() => setCount(count + 1)}>+</button>
    </main>
  );
}

createRoot(document.getElementById('app')).render(<Counter />);
`;

// A production `vite build` with what-react's plugin alone: every JSX file is
// React code, and what-core resolves to its production dist.
async function reactCompatBundle(name, source) {
  const { build: viteBuild } = await import('vite');
  const { reactCompat } = await import('../packages/react-compat/src/vite-plugin.js');
  const entry = join(repoRoot, `${name}.jsx`);
  // The plugin announces itself on the console.
  const log = console.log;
  console.log = () => {};
  let output;
  try {
    output = await viteBuild({
      configFile: false,
      root: repoRoot,
      logLevel: 'silent',
      mode: 'production',
      plugins: [
        { name: 'size-entry', enforce: 'pre', resolveId: (id) => (id === entry ? entry : null), load: (id) => (id === entry ? source : null) },
        reactCompat(),
      ],
      build: { write: false, minify: true, target: 'es2022', modulePreload: false, rollupOptions: { input: entry } },
    });
  } finally {
    console.log = log;
  }
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  return Buffer.concat(chunks.map((c) => Buffer.from(c.code)));
}

// Scenario (m): a native What page with one React island, compiled for
// hydration (what({ hydratable: true }) + reactCompat()): what a server-rendered
// mixed app's client carries, island adoption (what-react's hydrate.js and
// markup.js) included. A client-only mixed app carries none of it.
const mixedIsland = `
import { useState, useEffect } from 'react';
export function Counter({ label }) {
  const [count, setCount] = useState(0);
  useEffect(() => { document.title = label + ' ' + count; }, [count]);
  return (<div className="counter"><button onClick={() => setCount(count - 1)}>-</button><output>{label}: {count}</output><button onClick={() => setCount(count + 1)}>+</button></div>);
}
`;
const mixedHydratePage = `
import { hydrate, signal } from 'what-framework';
import { Counter } from './mixed-hydrate-counter.jsx';
const name = signal('clicks');
function App() {
  return (<main class="app-shell"><h1>What and React</h1><Counter label={name()} /><p>native text</p></main>);
}
hydrate(<App />, document.getElementById('app'));
`;

// The mixed plugin tells a React file from a native one by reading the file
// an import resolves to, so the app's files are written out, to
// benchmark/size/.scenarios/<name> (which git ignores): a React file that
// existed only in memory would be compiled as a native one, and its component
// called as a native component instead of rendered as an island.
// `dir`: where the app's files sit instead (relative to the repository), kept
// in memory, so that the package they import resolves from that directory's
// node_modules. `framework`: measure only the chunk that holds what-core and
// what-react; the package's own code (everything from node_modules) goes in a
// chunk of its own, which is not counted.
function scenarioDir(name, dir) {
  if (dir) return join(repoRoot, dir);
  const out = join(repoRoot, 'benchmark/size/.scenarios', name);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(repoRoot, 'benchmark/size/.scenarios/.gitignore'), '*\n');
  return out;
}

async function mixedBundle(name, files, { hydratable = true, dir = '', framework = false } = {}) {
  const { build: viteBuild } = await import('vite');
  const { default: what } = await import('../packages/compiler/src/vite-plugin.js');
  const { reactCompat } = await import('../packages/react-compat/src/vite-plugin.js');
  const base = scenarioDir(name, dir);
  const sources = new Map(Object.entries(files).map(([file, text]) => [join(base, file), text]));
  if (!dir) for (const [file, text] of sources) writeFileSync(file, text);
  const entry = join(base, `${name}.jsx`);
  const log = console.log;
  console.log = () => {};
  let output;
  try {
    output = await viteBuild({
      configFile: false,
      root: repoRoot,
      logLevel: 'silent',
      mode: 'production',
      plugins: [
        { name: 'size-entry', enforce: 'pre', resolveId: (id, importer) => { const file = id.startsWith('./') && importer ? join(dirname(importer), id) : id; return sources.has(file) ? file : null; }, load: (id) => sources.get(id) ?? null },
        what({ hydratable }),
        reactCompat(),
      ],
      build: {
        write: false, minify: true, target: 'es2022', modulePreload: false,
        rollupOptions: {
          input: entry,
          ...(framework ? { output: { codeSplitting: { groups: [
            { name: 'framework', test: /\/packages\/(core|react-compat)\/(src|dist)\//, priority: 2 },
            { name: 'package', test: /\/node_modules\//, priority: 1 },
          ] } } } : {}),
        },
      },
    });
  } finally {
    console.log = log;
  }
  const chunks = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk');
  if (framework) {
    const own = chunks.filter((c) => c.name === 'framework');
    if (own.length !== 1) throw new Error(`[check-size] ${name}: expected one framework chunk, got ${own.length}`);
    return Buffer.from(own[0].code);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.code)));
}

// Scenario (n): a client-only mixed app on a real React package (MIXED.md's
// dashboard: a native What page that draws a recharts chart). What-react's
// share is what recharts and the packages it stands on (react-redux,
// use-sync-external-store) reach of it, which a counter does not: the chunk
// that holds what-core and what-react is measured, recharts' own code is not.
// recharts comes from the mixed browser fixture's install
// (packages/react-compat/test/fixtures/mixed: `npm ci` there); without it
// the scenario fails, it is never skipped.
const MIXED_FIXTURE = 'packages/react-compat/test/fixtures/mixed';
const mixedRechartsPage = `
import { mount, signal } from 'what-framework';
import { BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';

const sales = signal([{ day: 'Mon', total: 3 }, { day: 'Tue', total: 5 }]);

function Dashboard() {
  return (
    <main>
      <h1>{sales().length} days</h1>
      <button onClick={() => sales([...sales(), { day: 'Day ' + sales().length, total: 4 }])}>Add a day</button>
      <BarChart width={300} height={150} data={sales()}>
        <XAxis dataKey="day" />
        <YAxis />
        <Tooltip />
        <Bar dataKey="total" fill="#36c" />
      </BarChart>
    </main>
  );
}

mount(<Dashboard />, '#app');
`;
function mixedRechartsBundle() {
  if (!existsSync(join(repoRoot, MIXED_FIXTURE, 'node_modules/recharts/package.json'))) {
    throw new Error(`[check-size] mixed-recharts needs recharts: run \`npm ci --prefix ${MIXED_FIXTURE} --ignore-scripts\` first.`);
  }
  return mixedBundle('mixed-recharts', { 'mixed-recharts.jsx': mixedRechartsPage }, { hydratable: false, dir: `${MIXED_FIXTURE}/src`, framework: true });
}

const scenarios = {
  'core-counter': () => esbuildBundle('core-counter', { source: coreCounter, loader: 'js' }),
  'esbuild-default-counter': () => esbuildDefaultBundle('esbuild-default-counter', coreCounter),
  'scaffold-counter': () => esbuildBundle('scaffold-counter', { source: scaffoldCounter, loader: 'jsx' }),
  'compiled-counter': () => viteBundle('compiled-counter', { source: scaffoldCounter }),
  'compiled-h-counter': () => viteBundle('compiled-h-counter', { source: compiledHCounter }),
  'hooks-app': () => viteBundle('hooks-app', { source: hooksApp }),
  'what-error': () => esbuildBundle('what-error', { source: whatErrorApp, loader: 'js' }),
  'error-boundary-counter': () => esbuildBundle('error-boundary-counter', { source: errorBoundaryApp, loader: 'js' }),
  'diagnostics-read': () => esbuildBundle('diagnostics-read', { source: diagnosticsReadApp, loader: 'js' }),
  'computed-counter': () => viteBundle('computed-counter', { source: computedCounter }),
  'async-app': () => viteBundle('async-app', { source: asyncApp }),
  'data-app': () => viteBundle('data-app', { source: dataApp }),
  'compiled-hydrate': () => viteBundle('compiled-hydrate', { source: hydratingCounter, hydratable: true }),
  'react-counter': () => reactCompatBundle('react-counter', reactCounter),
  'mixed-hydrate': () => mixedBundle('mixed-hydrate', { 'mixed-hydrate.jsx': mixedHydratePage, 'mixed-hydrate-counter.jsx': mixedIsland }),
  'mixed-recharts': () => mixedRechartsBundle(),
};

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;

let failed = false;
const productionBundles = {};
console.log('[check-size] production-tier bundle sizes (min+gzip):\n');

for (const [name, bundle] of Object.entries(scenarios)) {
  const budget = budgets.scenarios?.[name];
  if (!budget || typeof budget.limitGzipBytes !== 'number') {
    console.error(`  ✗ ${name}: no limitGzipBytes budget in .size-budgets.json`);
    failed = true;
    continue;
  }
  let bytes;
  try {
    bytes = await bundle();
  } catch (error) {
    console.error(`  ✗ ${name}: ${error && error.message ? error.message.split('\n')[0] : error}`);
    failed = true;
    continue;
  }
  productionBundles[name] = bytes;
  const minBytes = bytes.length;
  const gzipBytes = gzipSync(bytes, { level: 9 }).length;
  const over = gzipBytes > budget.limitGzipBytes;
  const mark = over ? '✗' : '✓';
  console.log(
    `  ${mark} ${name}: min ${kb(minBytes)}, gzip ${kb(gzipBytes)} (${gzipBytes} B)` +
      ` — budget ${kb(budget.limitGzipBytes)} (${budget.limitGzipBytes} B)`,
  );
  if (over) {
    console.error(
      `    OVER BUDGET by ${gzipBytes - budget.limitGzipBytes} B.` +
        ' Shrink the runtime or raise the budget deliberately in .size-budgets.json.',
    );
    failed = true;
  }
}

// --- Development code must not reach production ---------------------------
// The same apps through every path an app takes to production: esbuild on the
// dist, what-compiler/vite on the dist, what-compiler/vite on the source.
productionBundles['hooks-app (esbuild, dist)'] = await esbuildBundle('hooks-app-esbuild', { source: hooksApp, loader: 'jsx' });
productionBundles['hooks-app (vite, source)'] = await viteBundle('hooks-app-src', { source: hooksApp, fromSource: true });
productionBundles['compiled-counter (vite, source)'] = await viteBundle('compiled-counter-src', { source: scaffoldCounter, fromSource: true });
productionBundles['what-error (vite, source)'] = await viteBundle('what-error-src', { source: whatErrorApp, fromSource: true });
productionBundles['diagnostics-read (vite, source)'] = await viteBundle('diagnostics-read-src', { source: diagnosticsReadApp, fromSource: true });
productionBundles['async-app (vite, source)'] = await viteBundle('async-app-src', { source: asyncApp, fromSource: true });
const allExports = ['', ...['a11y', 'ui', 'motion', 'dom', 'form', 'data'].map((kit) => `/${kit}`)]
  .map((sub) => `export * from 'what-core${sub}';`).join('\n');
const developmentBundle = Buffer.from(await esbuildBundle('all-exports-dev', { source: allExports, loader: 'js', conditions: ['development'] })).toString();
const coreDist = join(repoRoot, 'packages/core/dist');
const distFiles = Object.fromEntries(readdirSync(coreDist)
  .filter((f) => f.endsWith('.min.js'))
  .map((f) => [`packages/core/dist/${f}`, readFileSync(join(coreDist, f))]));

console.log('\n[check-size] development-only code in production output:\n');
for (const sentinel of [...DEV_BRANCH_SENTINELS, ...DEV_MODULE_SENTINELS]) {
  if (!developmentBundle.includes(sentinel)) {
    console.error(`  ✗ sentinel ${JSON.stringify(sentinel)} is not in the development bundle; update the sentinel lists.`);
    failed = true;
  }
}
const checkLeaks = (name, bytes, sentinels) => {
  const code = Buffer.from(bytes).toString();
  const leaked = sentinels.filter((s) => code.includes(s));
  const size = `(${gzipSync(bytes, { level: 9 }).length} B gzip)`;
  console.log(`  ${leaked.length ? '✗' : '✓'} ${name} ${size}${leaked.length ? `: contains ${leaked.map((s) => JSON.stringify(s)).join(', ')}` : ''}`);
  if (leaked.length) failed = true;
};
// WhatError has a codeExample field of its own: in an app that imports the
// class, that word is the class, not the catalogue (CATALOGUE below checks the
// catalogue itself).
const ownWords = (name) => (name.startsWith('what-error') ? ['codeExample'] : []);
for (const [name, bytes] of Object.entries(productionBundles)) {
  checkLeaks(name, bytes, [...DEV_BRANCH_SENTINELS, ...DEV_MODULE_SENTINELS].filter((s) => !ownWords(name).includes(s)));
}
for (const [name, bytes] of Object.entries(distFiles)) checkLeaks(name, bytes, DEV_BRANCH_SENTINELS);

// --- The vnode renderer only where a vnode is made ------------------------
// '__portal' is the renderer's portal branch (dom.js createDOM). From the dist
// and from the source alike, a compiled app that makes no vnode must not carry
// it, and one that calls h() must.
const RENDERER = '__portal';
console.log('\n[check-size] vnode renderer only when a vnode is made:\n');
for (const [name, expected] of [
  ['compiled-counter', false],
  ['compiled-counter (vite, source)', false],
  ['compiled-h-counter', true],
  ['compiled-hydrate', false],
]) {
  const has = Buffer.from(productionBundles[name]).toString().includes(RENDERER);
  console.log(`  ${has === expected ? '✓' : '✗'} ${name}: ${has ? 'carries' : 'does not carry'} the vnode renderer`);
  if (has !== expected) failed = true;
}

// --- Form state carried into built fields only where one can be built ----
// `closest('noscript')` (in whichever quotes the minifier writes it) is
// render.js controlsIn, which only the carrying of
// what the user changed before hydration into the fields built before the
// walk reached them reaches (_carryFields). A hydrating app whose compiled
// JSX builds no field and that makes no vnode must not carry it; the mixed
// app, whose what-react/mixed.js installs a vnode renderer, must.
const FIELD_CARRY = /closest\(["'`]noscript["'`]\)/;
console.log('\n[check-size] form state carried into built fields only where one can be built:\n');
for (const [name, expected] of [
  ['compiled-hydrate', false],
  ['mixed-hydrate', true],
]) {
  if (productionBundles[name] === undefined) {
    console.error(`  ✗ ${name}: not built (above)`);
    failed = true;
    continue;
  }
  const has = FIELD_CARRY.test(Buffer.from(productionBundles[name]).toString());
  console.log(`  ${has === expected ? '✓' : '✗'} ${name}: ${has ? 'carries' : 'does not carry'} the carrying of form state`);
  if (has !== expected) failed = true;
}

// --- The pull phase only where a computed is made -------------------------
// The text of DEFER (reactive.js, the marker of a deferred deep evaluation)
// stands for the pull phase, which the first computed or selector installs: an
// app of signals and effects must not carry it, and one computed brings it.
const PULL_PHASE = '[what] deferred evaluation';
console.log('\n[check-size] pull phase only when a computed is made:\n');
for (const [name, expected] of [
  ['core-counter', false],
  ['error-boundary-counter', false],
  ['compiled-counter', false],
  ['compiled-counter (vite, source)', false],
  ['compiled-hydrate', false],
  ['computed-counter', true],
]) {
  const has = Buffer.from(productionBundles[name]).toString().includes(PULL_PHASE);
  console.log(`  ${has === expected ? '✓' : '✗'} ${name}: ${has ? 'carries' : 'does not carry'} the pull phase`);
  if (has !== expected) failed = true;
}

// --- The error catalogue only where it is read ----------------------------
// ERROR_CODES is one object literal, so one of its messages (also a
// DEV_MODULE_SENTINELS entry, so it cannot go stale) stands for all of it. Only
// getErrorDefinition() and the development checks read it; an app that checks
// `instanceof WhatError` or reads the diagnostics must not carry it.
const CATALOGUE = 'takes no parameter, so it cannot read the store state';
console.log('\n[check-size] error catalogue only where it is read:\n');
for (const name of ['what-error', 'what-error (vite, source)', 'diagnostics-read', 'diagnostics-read (vite, source)']) {
  const has = Buffer.from(productionBundles[name]).toString().includes(CATALOGUE);
  console.log(`  ${has ? '✗' : '✓'} ${name}: ${has ? 'carries' : 'does not carry'} the error catalogue`);
  if (has) failed = true;
}

// --- what-react only where it is used -------------------------------------
// A native app built with what-react's plugin as well (mixed mode on) that
// uses no React package is the same bytes as the app built without it. A
// client build that does not hydrate carries no island adoption (hydrate.js,
// whose "native What content" stands for it) and no island server renderer
// (server.js, the plugin's stand-in takes its place in every client build);
// the hydrating mixed app carries the adoption.
console.log('\n[check-size] what-react only where it is used:\n');
{
  const nativeOnly = await mixedBundle('compiled-counter-mixed', { 'compiled-counter-mixed.jsx': scaffoldCounter }, { hydratable: false });
  const same = Buffer.compare(Buffer.from(nativeOnly), Buffer.from(productionBundles['compiled-counter'])) === 0;
  console.log(`  ${same ? '✓' : '✗'} compiled-counter with reactCompat() too: ${same ? 'the same bytes as without it' : `differs (${gzipSync(nativeOnly, { level: 9 }).length} B gzip against ${gzipSync(productionBundles['compiled-counter'], { level: 9 }).length} B)`}`);
  if (!same) failed = true;
  const ADOPTION = 'native What content';
  const SERVER_RENDERER = 'A React island cannot render on the server';
  for (const [name, adoption] of [['react-counter', false], ['mixed-recharts', false], ['mixed-hydrate', true]]) {
    if (productionBundles[name] === undefined) {
      console.error(`  ✗ ${name}: not built (above)`);
      failed = true;
      continue;
    }
    const code = Buffer.from(productionBundles[name]).toString();
    const adopts = code.includes(ADOPTION);
    const server = code.includes(SERVER_RENDERER);
    const ok = adopts === adoption && !server;
    console.log(`  ${ok ? '✓' : '✗'} ${name}: ${adopts ? 'carries' : 'does not carry'} island adoption, ${server ? 'carries' : 'does not carry'} the island server renderer`);
    if (!ok) failed = true;
  }
}

// --- A default esbuild build is the production build ----------------------
// The bundler tier with process.env.NODE_ENV folded must carry what the
// production tier carries, within per-module minification (2%).
console.log('\n[check-size] esbuild defaults against the production condition (gzip):\n');
{
  const d = gzipSync(productionBundles['esbuild-default-counter'], { level: 9 }).length;
  const p = gzipSync(productionBundles['core-counter'], { level: 9 }).length;
  const drift = (d - p) / p;
  const ok = Math.abs(drift) <= 0.02;
  console.log(`  ${ok ? '✓' : '✗'} counter: esbuild defaults ${d} B, production condition ${p} B (${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)}%)`);
  if (!ok) failed = true;
}

// --- The dist tree-shakes like the source ---------------------------------
// An app bundled from the production dist must be the app bundled from the
// source, within zlib noise and per-module minification (2%).
console.log('\n[check-size] production dist against source (vite, gzip):\n');
for (const [dist, source] of [
  ['compiled-counter', 'compiled-counter (vite, source)'],
  ['hooks-app', 'hooks-app (vite, source)'],
  ['async-app', 'async-app (vite, source)'],
]) {
  const d = gzipSync(productionBundles[dist], { level: 9 }).length;
  const s = gzipSync(productionBundles[source], { level: 9 }).length;
  const drift = (d - s) / s;
  const ok = drift <= 0.02;
  console.log(`  ${ok ? '✓' : '✗'} ${dist}: dist ${d} B, source ${s} B (${drift >= 0 ? '+' : ''}${(drift * 100).toFixed(1)}%)`);
  if (!ok) failed = true;
}

console.log('');
if (failed) {
  console.error('[check-size] FAIL: size budget exceeded, development code in a production bundle, a default esbuild build that is not the production build, or the dist does not tree-shake like the source.');
  process.exit(1);
}
console.log('[check-size] OK: all scenarios within budget, no development code in production bundles, a default esbuild build is the production build, the dist tree-shakes like the source.');
