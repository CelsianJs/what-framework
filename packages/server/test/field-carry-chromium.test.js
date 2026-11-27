// What the visitor changed in a form before the page's code ran reaches the
// form the client builds in its place while hydrating (render.js placeBuilt
// and _carryFields), on every path What builds a form field by: compiled JSX
// built before it is placed (with the hydratable option or without it), the
// inner HTML an element is given (innerHTML, dangerouslySetInnerHTML, a
// spread), a tag held in a binding, h() and the JSX runtime, and what-react's
// renderer in a mixed app. The carrying is installed by what can build a
// field (a compiled module whose JSX can, a vnode producer), so a client that
// builds none does not carry its code; a field built by hand
// (document.createElement) in such a client is the one that does not get
// what the visitor did.
//
// Each client is built two ways, as an app is: bundled by esbuild from
// compiled modules, and by a production `vite build` with what-compiler/vite
// compiling for hydration (which serves its stand-in for what-core's
// vnode-adoption.js). Each runs in Chromium on the page what-server rendered,
// after the visitor typed, checked, chose and picked a file there.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';
import { installDOM } from '../../../test-utils/dom.js';
import { PRODUCTION } from '../../../scripts/build.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(here, '../../..');
const CORE_SRC = path.join(REPO, 'packages/core/src');
const browserAvailable = await chromiumLaunches(chromium);

const FORM_FIELDS = '<input name="t" /><input type="checkbox" name="c" /><input type="radio" name="r" value="a" /><input type="radio" name="r" value="b" /><select name="s"><option value="a">A</option><option value="b">B</option></select><input type="file" name="d" />';
const FORM_JSX = `<form id="f">${FORM_FIELDS}</form>`;
const FORM_HTML = JSON.stringify(FORM_FIELDS.replace(/ \/>/g, '>'));

// Each path: the page as the server renders it, and the client's modules:
// page.jsx, compiled for hydration, and fields.js, compiled without it.
const PATHS = [
  ['compiled JSX built before it is placed', {
    page: `export function Page() { const form = ${FORM_JSX}; return <main>{form}</main>; }`,
  }],
  ['compiled JSX a module compiled without the hydratable option builds', {
    server: `export function Page() { return <main><Fields /></main>; } function Fields() { return ${FORM_JSX}; }`,
    page: `import { Fields } from './fields.js'; export function Page() { return <main><Fields /></main>; }`,
    fields: `export function Fields() { return ${FORM_JSX}; }`,
  }],
  ['innerHTML given to an element built before it is placed', {
    page: `const FORM = ${FORM_HTML}; export function Page() { const form = <form id="f" innerHTML={{ __html: FORM }} />; return <main>{form}</main>; }`,
  }],
  ['dangerouslySetInnerHTML given to an element built before it is placed', {
    page: `const FORM = ${FORM_HTML}; export function Page() { const form = <form id="f" dangerouslySetInnerHTML={{ __html: FORM }} />; return <main>{form}</main>; }`,
  }],
  ['inner HTML a spread gives an element built before it is placed', {
    page: `const props = { id: 'f', innerHTML: { __html: ${FORM_HTML} } }; export function Page() { const form = <form {...props} />; return <main>{form}</main>; }`,
  }],
  ['tags held in bindings', {
    page: `
      function Field(props) { const Tag = props.as; return <Tag {...props.attrs}>{props.children}</Tag>; }
      export function Page() {
        const form = <form id="f">
          <Field as="input" attrs={{ name: 't' }} />
          <Field as="input" attrs={{ type: 'checkbox', name: 'c' }} />
          <Field as="input" attrs={{ type: 'radio', name: 'r', value: 'a' }} />
          <Field as="input" attrs={{ type: 'radio', name: 'r', value: 'b' }} />
          <Field as="select" attrs={{ name: 's' }}><option value="a">A</option><option value="b">B</option></Field>
          <Field as="input" attrs={{ type: 'file', name: 'd' }} />
        </form>;
        return <main>{form}</main>;
      }`,
  }],
  ['h() elements', {
    page: `
      import { h } from 'what-framework';
      export function Page() {
        const form = <form id="f">{[
          h('input', { name: 't' }),
          h('input', { type: 'checkbox', name: 'c' }),
          h('input', { type: 'radio', name: 'r', value: 'a' }),
          h('input', { type: 'radio', name: 'r', value: 'b' }),
          h('select', { name: 's' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b' }, 'B')),
          h('input', { type: 'file', name: 'd' }),
        ]}</form>;
        return <main>{form}</main>;
      }`,
  }],
  ['JSX runtime elements', {
    page: `
      import { jsx } from 'what-framework/jsx-runtime';
      export function Page() {
        const form = <form id="f">{[
          jsx('input', { name: 't' }),
          jsx('input', { type: 'checkbox', name: 'c' }),
          jsx('input', { type: 'radio', name: 'r', value: 'a' }),
          jsx('input', { type: 'radio', name: 'r', value: 'b' }),
          jsx('select', { name: 's', children: [jsx('option', { value: 'a', children: 'A' }), jsx('option', { value: 'b', children: 'B' })] }),
          jsx('input', { type: 'file', name: 'd' }),
        ]}</form>;
        return <main>{form}</main>;
      }`,
  }],
];

// what-react's elements in an island of a mixed app (what-react's own
// renderer builds them), in native JSX built before it is placed: built by
// what-compiler/vite and what-react's plugin together.
const MIXED = {
  server: `export function Page() { return <main>${FORM_JSX}</main>; }`,
  page: `import { Fields } from './fields.jsx'; export function Page() { const form = <form id="f"><Fields /></form>; return <main>{form}</main>; }`,
  react: `import { useState } from 'react'; export function Fields() { const [name] = useState('t'); return <>${FORM_FIELDS.replace('name="t"', 'name={name}')}</>; }`,
};

// A form built by hand, in a client none of whose code builds a field.
const HAND_MADE = {
  server: `export function Page() { return <main>${FORM_JSX}</main>; }`,
  page: `
    function handMade() {
      const form = document.createElement('form');
      form.id = 'f';
      for (const [type, name, value] of [['text', 't'], ['checkbox', 'c'], ['radio', 'r', 'a'], ['radio', 'r', 'b'], ['select', 's'], ['file', 'd']]) {
        const field = document.createElement(type === 'select' ? 'select' : 'input');
        if (type === 'select') field.innerHTML = '<option value="a">A</option><option value="b">B</option>';
        else if (type !== 'text') field.type = type;
        field.name = name;
        if (value) field.value = value;
        form.append(field);
      }
      return form;
    }
    export function Page() { const form = handMade(); return <main>{form}</main>; }`,
};

const ENTRY = `
  import { hydrate } from 'what-framework';
  import { Page } from './page.jsx';
  window.__run = () => hydrate(<Page />, document.body);`;

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-field-carry-'));
const mixedDirs = [];
let built = 0;

const toCore = (code) => code
  .replace(/(['"])what-framework\/render\1/g, () => JSON.stringify(path.join(CORE_SRC, 'render.js')))
  .replace(/(['"])what-framework\/jsx-runtime\1/g, () => JSON.stringify(path.join(CORE_SRC, 'jsx-runtime.js')))
  .replace(/(['"])what-framework\1/g, () => JSON.stringify(path.join(CORE_SRC, 'index.js')));

// The client bundled by esbuild from modules compiled one at a time.
async function esbuildClient({ page, fields }) {
  const dir = path.join(tmpDir, `esbuild-${built++}`);
  mkdirSync(dir);
  const compile = (source, hydratable) => toCore(compileJSX(source, { production: true, pluginOptions: { hydratable } }))
    .replace(/(['"])\.\/page\.jsx\1/g, '"./page.js"');
  writeFileSync(path.join(dir, 'entry.js'), compile(ENTRY, true));
  writeFileSync(path.join(dir, 'page.js'), compile(page, true));
  if (fields) writeFileSync(path.join(dir, 'fields.js'), compile(fields, false));
  const result = await build({
    entryPoints: [path.join(dir, 'entry.js')],
    bundle: true, format: 'iife', write: false, platform: 'browser', target: 'es2022', logLevel: 'silent',
    define: PRODUCTION.define, plugins: PRODUCTION.plugins,
  });
  return result.outputFiles[0].text;
}

// The client built by a production `vite build` with what-compiler/vite
// compiling for hydration; fields.js arrives compiled without it, as a
// library's precompiled module does.
async function viteClient({ page, fields }) {
  const { build: viteBuild } = await import('vite');
  const { default: whatVitePlugin } = await import('../../compiler/src/vite-plugin.js');
  const dir = path.join(tmpDir, `vite-${built++}`);
  const sources = new Map([
    [path.join(dir, 'entry.jsx'), ENTRY],
    [path.join(dir, 'page.jsx'), page],
  ]);
  if (fields) sources.set(path.join(dir, 'fields.js'), compileJSX(fields, { production: true, pluginOptions: { hydratable: false } }));
  const output = await viteBuild({
    configFile: false,
    root: REPO,
    logLevel: 'silent',
    mode: 'production',
    plugins: [
      { name: 'client-sources', enforce: 'pre', resolveId: (id, importer) => {
        const file = id.startsWith('./') && importer ? path.join(path.dirname(importer), id) : id;
        return sources.has(file) ? file : null;
      }, load: (id) => sources.get(id) ?? null },
      whatVitePlugin({ hydratable: true, prodBundles: false }),
    ],
    resolve: { alias: [
      { find: /^what-framework\/render$/, replacement: path.join(CORE_SRC, 'render.js') },
      { find: /^what-framework\/jsx-runtime$/, replacement: path.join(CORE_SRC, 'jsx-runtime.js') },
      { find: /^what-framework$/, replacement: path.join(CORE_SRC, 'index.js') },
    ] },
    build: { write: false, minify: false, target: 'es2022', modulePreload: false, rollupOptions: { input: path.join(dir, 'entry.jsx'), output: { format: 'iife' } } },
  });
  return (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk').map((c) => c.code).join('\n');
}

// The mixed app: its files on disk, where what-react's plugin reads which
// of them import react, in the repository, where what-framework and
// what-react resolve what-core alike (from its production tier), so the
// program holds one copy of it.
async function mixedClient({ page, react }) {
  const { build: viteBuild } = await import('vite');
  const { default: whatVitePlugin } = await import('../../compiler/src/vite-plugin.js');
  const { reactCompat } = await import('../../react-compat/src/vite-plugin.js');
  const dir = mkdtempSync(path.join(here, '.field-carry-mixed-'));
  mixedDirs.push(dir);
  writeFileSync(path.join(dir, 'entry.jsx'), ENTRY);
  writeFileSync(path.join(dir, 'page.jsx'), page);
  writeFileSync(path.join(dir, 'fields.jsx'), react);
  const output = await viteBuild({
    configFile: false,
    root: REPO,
    logLevel: 'silent',
    mode: 'production',
    plugins: [whatVitePlugin({ hydratable: true }), reactCompat()],
    build: { write: false, minify: false, target: 'es2022', modulePreload: false, rollupOptions: { input: path.join(dir, 'entry.jsx'), output: { format: 'iife' } } },
  });
  return (Array.isArray(output) ? output : [output]).flatMap((o) => o.output).filter((o) => o.type === 'chunk').map((c) => c.code).join('\n');
}

const BUILDERS = [['esbuild', esbuildClient], ['vite', viteClient]];

let browser = null;
let env = null;

before(async () => {
  if (!browserAvailable) return;
  env = installDOM();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  env?.cleanup();
  rmSync(tmpDir, { recursive: true, force: true });
  for (const dir of mixedDirs) rmSync(dir, { recursive: true, force: true });
});

async function serverMarkup(source) {
  const { h } = await import('../../core/src/index.js');
  const { __resetHydrationData } = await import('../../core/src/entries/internal.js');
  const { renderToHydratableString } = await import('../src/index.js');
  const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
  __resetHydrationData();
  return renderToHydratableString(h(server.Page));
}

// The page the server rendered, changed by the visitor, then hydrated by
// `script`: what each field shows.
async function run(markup, script) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
    await page.fill('[name=t]', 'typed');
    await page.check('[name=c]');
    await page.check('[name=r][value=b]');
    await page.selectOption('[name=s]', 'b');
    await page.setInputFiles('[name=d]', { name: 'doc.txt', mimeType: 'text/plain', buffer: Buffer.from('chosen') });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => { /** @type {any} */ (window).__run(); });
    return await page.evaluate(() => ({
      t: /** @type {HTMLInputElement} */ (document.querySelector('[name=t]')).value,
      c: /** @type {HTMLInputElement} */ (document.querySelector('[name=c]')).checked,
      r: /** @type {HTMLInputElement | null} */ (document.querySelector('[name=r]:checked'))?.value ?? null,
      s: /** @type {HTMLSelectElement} */ (document.querySelector('[name=s]')).value,
      d: /** @type {HTMLInputElement} */ (document.querySelector('[name=d]')).files?.[0]?.name ?? null,
      fields: document.querySelectorAll('input, select').length,
    }));
  } finally {
    await page.close();
  }
}

const CHANGED = { t: 'typed', c: true, r: 'b', s: 'b', d: 'doc.txt', fields: 6 };

describe('a form built before the walk reached it, in Chromium', { skip: !browserAvailable }, () => {
  for (const [name, client] of PATHS) {
    for (const [bundler, bundle] of BUILDERS) {
      it(`${name} (${bundler}): gets what the visitor typed, checked, chose and picked`, async () => {
        const markup = await serverMarkup(client.server ?? client.page);
        assert.deepEqual(await run(markup, await bundle(client)), CHANGED);
      });
    }
  }

  it('what-react elements in an island of a mixed app (vite, what-react): get what the visitor typed, checked, chose and picked', async () => {
    const markup = await serverMarkup(MIXED.server);
    assert.deepEqual(await run(markup, await mixedClient(MIXED)), CHANGED);
  });

  for (const [bundler, bundle] of BUILDERS) {
    it(`a form built by hand, in a client that builds no field (${bundler}): shows what it was built with`, async () => {
      const markup = await serverMarkup(HAND_MADE.server);
      assert.deepEqual(await run(markup, await bundle(HAND_MADE)), { t: '', c: false, r: null, s: 'a', d: null, fields: 6 });
    });
  }
});
