// Mixed JSX plugin: which tags are React components, and what the JSX
// becomes. Run: node --test packages/react-compat/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createClassifier, lowerJsx, isReactPackage, mixedJsx, REACT_SOURCE_MARKER } from '../src/mixed-plugin.js';
import { detectSsrReactPackages } from '../src/vite-plugin.js';

const require = createRequire(import.meta.url);
const babel = createRequire(require.resolve('what-compiler'))('@babel/core');

// A project on disk: `files` maps relative paths to their text.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'what-mixed-'));
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof text === 'string' ? text : JSON.stringify(text));
  }
  // Node-like resolution: relative files with extensions, bare names from node_modules.
  const resolve = async (source, importer) => {
    if (source.startsWith('.')) {
      const base = path.resolve(path.dirname(importer), source);
      for (const ext of ['', '.jsx', '.tsx', '.js', '.ts', '/index.js', '/index.jsx']) {
        if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
      }
      return null;
    }
    const dir = path.join(root, 'node_modules', source);
    return fs.existsSync(path.join(dir, 'index.js')) ? path.join(dir, 'index.js') : null;
  };
  const at = (rel) => path.join(root, rel);
  return { root, resolve, at, classifier: (opts = {}) => createClassifier({ babel, root, resolve, ...opts }) };
}

const PACKAGES = {
  'node_modules/ui-kit/package.json': { name: 'ui-kit', peerDependencies: { react: '>=18' } },
  'node_modules/ui-kit/index.js': 'export function Button() {}\nexport function useToast() {}',
  'node_modules/what-kit/package.json': { name: 'what-kit', dependencies: { 'what-core': '^0.15.0' } },
  'node_modules/what-kit/index.js': 'export function Tabs() {}\nexport function useTabs() {}',
};

test('a package that depends on react is React; what-react and native packages are not', () => {
  assert.equal(isReactPackage({ name: 'recharts', peerDependencies: { react: '^18' } }), true);
  assert.equal(isReactPackage({ name: 'react' }), true);
  assert.equal(isReactPackage({ name: 'lib', dependencies: { 'react-dom': '1' } }), true);
  assert.equal(isReactPackage({ name: 'what-react', peerDependencies: { 'what-core': '1' } }), false);
  assert.equal(isReactPackage({ name: 'what-router', dependencies: { 'what-core': '1' } }), false);
});

test('which files are React files', async () => {
  const p = project({
    ...PACKAGES,
    'src/imports-react.jsx': "import { useState } from 'react';\nexport const A = () => <div />;",
    'src/imports-react-dom.jsx': "import { createPortal } from 'react-dom';\nexport const A = () => <div />;",
    'src/type-only.tsx': "import type { ReactNode } from 'react';\nexport const A = (p: { c: ReactNode }) => <div />;",
    'src/pragma.jsx': '/** @jsxImportSource react */\nexport const A = () => <div />;',
    'src/forced-native.jsx': "/** @jsxImportSource what-framework */\nimport { useState } from 'react';\nexport const A = () => <div />;",
    'src/calls-react-hook.jsx': "import { useToast } from 'ui-kit';\nexport function A() { const t = useToast(); return <div />; }",
    'src/imports-react-hook-unused.jsx': "import { useToast } from 'ui-kit';\nexport const hook = useToast;\nexport const A = () => <div />;",
    'src/calls-native-hook.jsx': "import { useTabs } from 'what-kit';\nimport { useState } from 'what-framework';\nexport function A() { useTabs(); useState(0); return <div />; }",
    'src/uses-react-component.jsx': "import { Button } from 'ui-kit';\nexport const A = () => <Button />;",
    'src/hooks.js': "import { useState } from 'react';\nexport function useCount() { return useState(0); }",
    'src/calls-local-react-hook.jsx': "import { useCount } from './hooks.js';\nexport function A() { useCount(); return <div />; }",
    'src/legacy/old.jsx': 'export const A = () => <div />;',
    'node_modules/zustand/package.json': { name: 'zustand', peerDependencies: { react: '>=18' } },
    'node_modules/zustand/index.js': 'export function create() {}',
    'src/store-and-component.jsx': "import { create } from 'zustand';\nexport const useStore = create(() => ({ n: 0 }));\nexport function A() { const n = useStore((s) => s.n); return <p>{n}</p>; }",
    'src/store.js': "import { create } from 'zustand';\nexport const useStore = create(() => ({ n: 0 }));",
    'src/uses-store.jsx': "import { useStore } from './store.js';\nexport function A() { return <p>{useStore((s) => s.n)}</p>; }",
    'src/reads-store-outside-render.jsx': "import { useStore } from './store.js';\nexport const A = () => <p>{useStore.getState().n}</p>;",
    'src/custom-hook.jsx': "import { useToast } from 'ui-kit';\nfunction useNotify() { return useToast(); }\nexport function A() { useNotify(); return <div />; }",
    'src/native-custom-hook.jsx': "import { signal } from 'what-framework';\nfunction useCounter() { return signal(0); }\nexport function A() { const c = useCounter(); return <div>{c()}</div>; }",
  });
  const c = p.classifier({ react: 'src/legacy/' });
  const kind = async (rel) => (await c.fileIsReact(p.at(rel))) ? 'react' : 'native';
  assert.equal(await kind('src/imports-react.jsx'), 'react');
  assert.equal(await kind('src/imports-react-dom.jsx'), 'react');
  assert.equal(await kind('src/type-only.tsx'), 'native', 'a type-only import of react is not React code');
  assert.equal(await kind('src/pragma.jsx'), 'react');
  assert.equal(await kind('src/forced-native.jsx'), 'native', 'the pragma names the file kind');
  assert.equal(await kind('src/calls-react-hook.jsx'), 'react', 'a file calling a React package hook');
  assert.equal(await kind('src/imports-react-hook-unused.jsx'), 'native', 'importing a hook without calling it');
  assert.equal(await kind('src/calls-native-hook.jsx'), 'native', "What's own hooks and native packages");
  assert.equal(await kind('src/uses-react-component.jsx'), 'native', 'a React component as a tag makes an island, not a React file');
  assert.equal(await kind('src/calls-local-react-hook.jsx'), 'react', 'a hook from a React file of the app');
  assert.equal(await kind('src/legacy/old.jsx'), 'react', 'the react option');
  assert.equal(await kind('src/store-and-component.jsx'), 'react', 'a hook a React package builds in the file (zustand create)');
  assert.equal(await kind('src/store.js'), 'native', 'a store file with no hook call');
  assert.equal(await kind('src/uses-store.jsx'), 'react', 'a hook a React package built in another file');
  assert.equal(await kind('src/reads-store-outside-render.jsx'), 'native', 'reading the store without calling the hook');
  assert.equal(await kind('src/custom-hook.jsx'), 'react', 'a custom hook that calls a React hook');
  assert.equal(await kind('src/native-custom-hook.jsx'), 'native', 'a custom hook built on signals');
});

test('React components through re-exports', async () => {
  const p = project({
    ...PACKAGES,
    'src/Old.jsx': "import { useState } from 'react';\nexport function Old() {}\nexport default Old;",
    'src/Native.jsx': 'export function Native() {}',
    'src/ui/index.js': [
      "export { Button, Button as Btn } from 'ui-kit';",
      "export { Tabs } from 'what-kit';",
      "export * from '../Old.jsx';",
      "export * from '../Native.jsx';",
      "import { Button as B2 } from 'ui-kit';",
      'export { B2 };',
      "import OldDefault from '../Old.jsx';",
      'export { OldDefault };',
      "export { default as OldAgain } from '../Old.jsx';",
      'export function Local() {}',
    ].join('\n'),
    'src/ui/deep.js': "export * from './index.js';",
  });
  const c = p.classifier();
  const kind = async (name, file = 'src/ui/index.js') => (await c.exportIsReact(p.at(file), name)) ? 'react' : 'native';
  assert.equal(await kind('Button'), 'react');
  assert.equal(await kind('Btn'), 'react');
  assert.equal(await kind('Tabs'), 'native');
  assert.equal(await kind('Old'), 'react');
  assert.equal(await kind('Native'), 'native');
  assert.equal(await kind('B2'), 'react');
  assert.equal(await kind('OldDefault'), 'react');
  assert.equal(await kind('OldAgain'), 'react');
  assert.equal(await kind('Local'), 'native');
  assert.equal(await kind('Button', 'src/ui/deep.js'), 'react', 'two barrels deep');
  assert.equal(await kind('Missing'), 'native');
});

test('an import cycle between barrels terminates', async () => {
  const p = project({
    'src/a.js': "export * from './b.js';\nexport function A() {}",
    'src/b.js': "export * from './a.js';\nexport function B() {}",
  });
  const c = p.classifier();
  assert.equal(await c.exportIsReact(p.at('src/a.js'), 'Nope'), false);
});

// --- what the JSX becomes ---

function lower(code, opts, file = '/app/src/x.jsx') {
  const ast = babel.parseSync(code, { filename: file, configFile: false, babelrc: false, parserOpts: { plugins: ['jsx'] } });
  const changed = lowerJsx(babel, ast, { reactFile: false, reactTags: new Set(), nativeTags: new Set(), ...opts });
  return { changed, code: babel.transformFromAstSync(ast, code, { configFile: false, babelrc: false }).code };
}

test('a native file: a React tag becomes an island with its whole subtree; the rest stays JSX', () => {
  const { changed, code } = lower(`
import { BarChart, Bar } from 'recharts';
import { Panel } from './Panel.jsx';
function Local() { return <p />; }
export function App() {
  return (
    <main class="m">
      <h1>{n()}</h1>
      <BarChart data={rows()} width={300}>
        <Bar dataKey="v" />
        <Panel title={t()}><b>{n()}</b></Panel>
        <Local />
        <>{items().map((i) => <li key={i.id}>{i.name}</li>)}</>
      </BarChart>
      <svg><BarChart /></svg>
    </main>
  );
}`, { reactTags: new Set(['BarChart', 'Bar']), nativeTags: new Set(['Panel']) });
  assert.equal(changed, true);
  const imported = code.match(/import \{([^}]*)\} from "what-react\/mixed";/)[1].split(',').map((x) => x.trim()).sort();
  assert.deepEqual(imported, ['Fragment as _Fragment', 'ReactIsland as WhatReactIsland', 'createElement as _createElement', 'native as _native']);
  // Native JSX around the island is untouched.
  assert.match(code, /<main class="m">\s*<h1>\{n\(\)\}<\/h1>/);
  assert.match(code, /<WhatReactIsland view=\{\(\) => _createElement\(BarChart, \{\s*"data": rows\(\),\s*"width": 300\s*\}/);
  assert.match(code, /_createElement\(Bar, \{\s*"dataKey": "v"\s*\}\)/);
  assert.match(code, /_createElement\(_native\(Panel\), \{\s*"title": t\(\)\s*\}, _createElement\("b", null, n\(\)\)\)/);
  assert.match(code, /_createElement\(_native\(Local\), null\)/, "the native file's own component");
  assert.match(code, /_createElement\(_Fragment, null, items\(\)\.map\(i => _createElement\("li", \{\s*"key": i\.id\s*\}, i\.name\)\)\)/);
  assert.match(code, /<svg><WhatReactIsland view=\{\(\) => _createElement\(BarChart, null\)\} svg \/><\/svg>/);
  assert.doesNotMatch(code, /<Bar\b|<Panel\b/);
});

test('a React tag in a native keyed list keeps its key on the island', () => {
  const { code } = lower(`export const L = () => <ul>{rows().map((r) => <Chip key={r.id} label={r.name} />)}</ul>;`, { reactTags: new Set(['Chip']) });
  assert.match(code, /rows\(\)\.map\(r => <WhatReactIsland key=\{r\.id\} view=\{\(\) => _createElement\(Chip, \{\s*"key": r\.id,\s*"label": r\.name\s*\}\)\} \/>\)/);
});

test('a native file without React tags is not changed', () => {
  const { changed } = lower('export const A = () => <div><Panel /></div>;', { nativeTags: new Set(['Panel']) });
  assert.equal(changed, false);
});

test('a React file: all JSX is createElement; a native import becomes a wrapper read at render', () => {
  const { code } = lower(`
import { useState } from 'react';
import { Counter } from './Counter.jsx';
import * as Kit from 'what-kit';
export function Old({ n }) {
  const [c, setC] = useState(0);
  return <div id="x" hidden {...rest} data-a="1&amp;2">
    hello
       world
    <Counter label={c} /><Kit.Tabs /><Old n={1} />
  </div>;
}`, { reactFile: true, nativeTags: new Set(['Counter', 'Kit']) });
  assert.match(code, /const _n\$Counter = _nativeRef\(\(\) => Counter, "Counter"\);/);
  assert.match(code, /const _n\$Kit_Tabs = _nativeRef\(\(\) => Kit\.Tabs, "Kit\.Tabs"\);/);
  assert.match(code, /_createElement\("div", \{\s*"id": "x",\s*"hidden": true,\s*\.\.\.rest,\s*"data-a": "1&2"\s*\}, "hello world"/);
  assert.match(code, /_createElement\(_n\$Counter, \{\s*"label": c\s*\}\)/);
  assert.match(code, /_createElement\(_n\$Kit_Tabs, null\)/);
  assert.match(code, /_createElement\(Old, \{\s*"n": 1\s*\}\)/, "the file's own components are React components");
  assert.doesNotMatch(code, /<div|<Counter/);
});

test('the plugin marks React files for what-compiler and leaves native files without React tags alone', async () => {
  const p = project({
    ...PACKAGES,
    'src/Old.jsx': "import { useState } from 'react';\nexport function Old() { return <div />; }",
    'src/Plain.jsx': "import { Tabs } from 'what-kit';\nexport const P = () => <Tabs />;",
    'src/Mixed.jsx': "import { Button } from 'ui-kit';\nexport const M = () => <section><Button /></section>;",
  });
  const plugin = mixedJsx();
  plugin.configResolved({ root: p.root });
  const ctx = { resolve: async (s, i) => ({ id: await p.resolve(s, i) }), environment: null };
  const run = (rel) => plugin.transform.call(ctx, fs.readFileSync(p.at(rel), 'utf8'), p.at(rel));
  const old = await run('src/Old.jsx');
  assert.ok(old.code.endsWith(REACT_SOURCE_MARKER));
  assert.match(old.code, /_createElement\("div", null\)/);
  assert.equal(await run('src/Plain.jsx'), null);
  const mixed = await run('src/Mixed.jsx');
  assert.match(mixed.code, /<section><WhatReactIsland view=\{\(\) => _createElement\(Button, null\)\} \/><\/section>/);
  assert.ok(!mixed.code.includes(REACT_SOURCE_MARKER));
});

test('a server build bundles the React packages the app depends on, with their React dependencies', () => {
  const p = project({
    'package.json': { name: 'app', dependencies: { 'chart-kit': '1', 'plain-util': '1', 'cjs-react-thing': '1', 'what-router': '1' } },
    'node_modules/chart-kit/package.json': { name: 'chart-kit', type: 'module', peerDependencies: { react: '*' }, dependencies: { 'store-bindings': '1', 'tiny-cjs': '1' } },
    'node_modules/store-bindings/package.json': { name: 'store-bindings', module: 'index.mjs', peerDependencies: { react: '*' } },
    'node_modules/tiny-cjs/package.json': { name: 'tiny-cjs', main: 'index.js' },
    'node_modules/plain-util/package.json': { name: 'plain-util', type: 'module' },
    'node_modules/cjs-react-thing/package.json': { name: 'cjs-react-thing', main: 'index.js', peerDependencies: { react: '*' } },
    'node_modules/what-router/package.json': { name: 'what-router', type: 'module', dependencies: { 'what-core': '1' } },
  });
  assert.deepEqual(detectSsrReactPackages(p.root).sort(), ['chart-kit', 'store-bindings']);
});
