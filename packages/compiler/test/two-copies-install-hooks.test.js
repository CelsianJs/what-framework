// Two copies of what-core on one page (a library bundled with its own), each
// in a bundle of its own, and every install hook a copy runs only when its own
// code needs it, asked to act on something the other copy made:
//
//   the select code (_$selects)  the first copy to bind a field listens for
//                                the window and puts back the fields of both:
//                                a select the other copy bound, from an app
//                                whose own JSX has no select, after a pick
//                                and after its form's reset; and _resetForm
//                                (what-server's <Form>) from that copy.
//   _enableSuspense              a component of the other copy that suspends
//                                (its lazy()), under a <Suspense> of the
//                                copy that renders it.
//   _$rowFields()                a keyed list of one copy whose rows are the
//                                other copy's components reading the item,
//                                both ways: a new item under the same key
//                                shows.
//   _$controlled                 a spread on a field of one copy given the
//                                other copy's live props.
//   lazy children (_$createLeaf) children and JSX props one copy hands a
//                                component of the other, both ways.
//   the class bridge (_$createFn) a class component of the other copy, by a
//                                member tag, an alias and memo().
//   the pull phase               a computed of the other copy read by a copy
//                                that made none.
//   optionsChanged               <option>s one copy's list renders into the
//                                other copy's controlled <select>: the select
//                                shows its value once they arrive. A copy
//                                with no select code calls the code the
//                                select carries (render.js optionsChanged).
//   the vnode renderer           an h() component of the other copy, rendered
//                                by a copy that makes no vnode: the vnode
//                                carries its own copy's renderer.
//
// The signal graph stays each copy's own (docs/ARCHITECTURE.md, tiers): a
// signal of one copy read in an effect of the other is not tracked, so these
// read the other copy's state where it is current, and write it through that
// copy.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, firefox, webkit } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const core = (file) => JSON.stringify(path.join(root, 'packages/core/src', file));

// One bundle: its own copy of what-core, from the source, in the tier `dev` names.
async function bundle(source, dev, globalName) {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-two-copies-'));
  try {
    const code = compileJSX(source, { production: !dev })
      .replace(/(['"])what-framework(\/(render|form))?\1/g, (_, q, sub, name) => core(name === 'render' ? 'render.js' : name === 'form' ? 'entries/form.js' : 'index.js'))
      .replace(/(['"])what-core\/dom\1/g, () => core('dom.js'));
    const file = path.join(dir, 'entry.mjs');
    writeFileSync(file, code);
    const out = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName, write: false,
      define: { __WHAT_DEV__: String(dev) }, logLevel: 'silent' });
    return out.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The library: what-core bundled into it, its components on `Lib`.
const lib = `
  import { signal, computed, mount, lazy, memo, h } from 'what-framework';
  export const state = { pick: signal('a'), chosen: signal('b'), label: signal('lib'), n: signal(2), items: signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]) };
  export function Choose(props) {
    return <select id="choose" value={state.chosen()}>{props.children}</select>;
  }
  export function Made() {
    return h('b', { class: 'made', title: () => state.label() }, 'made by h');
  }
  export const total = computed(() => state.n() * 10);
  export function Picker(props) {
    return <select id={props.id} value={state.pick()} onChange={(e) => props.onPick?.(e.target.value)}><option>a</option><option>b</option><option>c</option></select>;
  }
  export function PickerForm() {
    return <form id="libForm"><select id="libFormPick" value={state.pick()}><option>a</option><option>b</option></select></form>;
  }
  export function Row(props) {
    return <li class="row">{props.item.label}<i>{state.label()}</i></li>;
  }
  export function Card(props) {
    return <section class="card"><header>{props.header}</header>{props.children}</section>;
  }
  export function Each(props) {
    return <ul class="each">{state.items().map((item) => <props.Row key={item.id} item={item} />)}</ul>;
  }
  export function Slot(props) {
    return <props.Inner><i>from lib</i></props.Inner>;
  }
  export function Forward(props) {
    return <props.Field value={props.read()} />;
  }
  export class Legacy {
    constructor(props) { this.props = props; }
    render() { return <b class="legacy">{this.props.label}</b>; }
  }
  export const MemoLegacy = memo(Legacy);
  let resolveChunk;
  export const loadChunk = () => resolveChunk();
  export const Later = lazy(() => new Promise((resolve) => { resolveChunk = () => resolve({ default: () => <b class="later">loaded</b> }); }));
  export { mount };
`;

const scenarios = {
  // An app whose JSX has no select: its copy has no select code, and binds a field first.
  selects: {
    app: `
      import { signal, mount } from 'what-framework';
      import { _resetForm } from 'what-core/dom';
      export const typed = signal('x');
      const Lib = globalThis.Lib;
      export function start() {
        const app = document.getElementById('app');
        mount(() => <input id="appField" value={typed()} />, app.appendChild(document.createElement('div')));
        mount(() => <Lib.Picker id="libPick" onPick={() => {}} />, app.appendChild(document.createElement('div')));
        Lib.mount(() => <Lib.PickerForm />, document.getElementById('lib'));
      }
      export const resetLibForm = () => _resetForm(document.getElementById('libForm'), (e) => { throw e; });
    `,
  },
  suspense: {
    app: `
      import { mount, Suspense } from 'what-framework';
      const Lib = globalThis.Lib;
      export function start() {
        mount(() => <Suspense fallback={<p class="wait">wait</p>}><Lib.Later /></Suspense>, document.getElementById('app'));
      }
    `,
  },
  rows: {
    app: `
      import { signal, mount } from 'what-framework';
      export const items = signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
      const Lib = globalThis.Lib;
      const Own = (props) => <li class="own">{props.item.label}</li>;
      export function start() {
        mount(() => <div><ul class="app">{items().map((item) => <Lib.Row key={item.id} item={item} />)}</ul><Lib.Each Row={Own} /></div>, document.getElementById('app'));
      }
    `,
  },
  controlled: {
    app: `
      import { mount, signal } from 'what-framework';
      export const text = signal('app');
      const Lib = globalThis.Lib;
      function Field(props) { return <input id="forwarded" {...props} />; }
      export function start() {
        mount(() => <Lib.Forward Field={Field} read={text} />, document.getElementById('app'));
      }
    `,
  },
  children: {
    app: `
      import { mount } from 'what-framework';
      const Lib = globalThis.Lib;
      function Inner(props) { return <p class="inner">{props.children}</p>; }
      export function start() {
        mount(() => <div><Lib.Card header={<b class="head">head</b>}><em class="body">body</em></Lib.Card><Lib.Slot Inner={Inner} /></div>, document.getElementById('app'));
      }
    `,
  },
  classes: {
    app: `
      import { mount } from 'what-framework';
      const Lib = globalThis.Lib;
      const Alias = Lib.Legacy;
      function Plain() { return <s>plain</s>; }
      export function start() {
        mount(() => <div><Plain /><Lib.Legacy label="member" /><Alias label="alias" /><Lib.MemoLegacy label="memo" /></div>, document.getElementById('app'));
      }
    `,
  },
  options: {
    app: `
      import { signal, mount } from 'what-framework';
      export const opts = signal([]);
      const Lib = globalThis.Lib;
      export function start() {
        mount(() => <Lib.Choose>{opts().map((o) => <option key={o}>{o}</option>)}</Lib.Choose>, document.getElementById('app'));
      }
    `,
  },
  vnode: {
    app: `
      import { mount } from 'what-framework';
      const Lib = globalThis.Lib;
      export function start() {
        mount(() => <div class="host"><Lib.Made /></div>, document.getElementById('app'));
      }
    `,
  },
  pull: {
    app: `
      import { mount, effect } from 'what-framework';
      const Lib = globalThis.Lib;
      export const read = [];
      export function start() {
        effect(() => { read.push(Lib.total()); });
        mount(() => <p class="total">{Lib.total()}</p>, document.getElementById('app'));
      }
    `,
  },
};

async function launches(type) {
  if (type === chromium) return chromiumLaunches(chromium);
  try {
    await (await type.launch()).close();
    return true;
  } catch {
    return false;
  }
}

const engines = [['Chromium', chromium], ['WebKit', webkit], ['Firefox', firefox]];
const available = new Map();
for (const [, type] of engines) available.set(type, await launches(type));

for (const [engine, type] of engines) {
  for (const dev of [true, false]) {
    describe(`two copies of what-core on a page (${engine}, ${dev ? 'development' : 'production'})`, { skip: !available.get(type) && `${engine} does not launch here` }, () => {
      let browser;
      const code = {};
      before(async () => {
        code.lib = await bundle(lib, dev, 'Lib');
        for (const [name, { app }] of Object.entries(scenarios)) code[name] = await bundle(app, dev, 'App');
        browser = await type.launch();
      });
      after(async () => {
        await browser?.close();
      });

      // A page with the app's bundle and the library's, in `order`.
      async function open(name, order = ['lib', name]) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.setContent('<!doctype html><html><body><div id="app"></div><div id="lib"></div><button id="elsewhere">elsewhere</button></body></html>');
        for (const part of order) await page.addScriptTag({ content: code[part] });
        await page.evaluate(() => globalThis.App.start());
        return { page, errors };
      }
      const settled = (page) => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const html = (page, sel) => page.$eval(sel, (el) => el.innerHTML);

      it('the select code: a select the other copy bound is put back after a pick and after a reset', async () => {
        // The app's bundle runs first: its copy binds the first field and
        // listens for the window, and it has no select code.
        const { page, errors } = await open('selects', ['lib', 'selects']);
        await page.focus('#libPick');
        await page.keyboard.type('b');
        await settled(page);
        assert.equal(await page.$eval('#libPick', (el) => el.value), 'a', 'the pick the handler refused is put back');

        await page.$eval('#libFormPick', (el) => { el.value = 'b'; });
        await page.evaluate(() => document.getElementById('libForm').reset());
        await settled(page);
        assert.equal(await page.$eval('#libFormPick', (el) => el.value), 'a', 'after a native reset');

        await page.$eval('#libFormPick', (el) => { el.value = 'b'; });
        await page.evaluate(() => globalThis.App.resetLibForm());
        assert.equal(await page.$eval('#libFormPick', (el) => el.value), 'a', '_resetForm of the copy without select code');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('_enableSuspense: a lazy component of the other copy under this copy\'s <Suspense>', async () => {
        const { page, errors } = await open('suspense');
        assert.match(await html(page, '#app'), /class="wait"/);
        await page.evaluate(() => globalThis.Lib.loadChunk());
        await page.waitForSelector('.later');
        assert.doesNotMatch(await html(page, '#app'), /class="wait"/);
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('_$rowFields(): the other copy\'s components as rows, both ways, take a new item under the same key', async () => {
        const { page, errors } = await open('rows');
        const rows = () => page.evaluate(() => [...document.querySelectorAll('ul.app li, ul.each li')].map((li) => li.textContent));
        assert.deepEqual(await rows(), ['onelib', 'twolib', 'one', 'two']);
        // Each list is written through its own copy.
        await page.evaluate(() => globalThis.App.items([{ id: 1, label: 'uno' }, { id: 2, label: 'two' }]));
        await page.evaluate(() => globalThis.Lib.state.items([{ id: 1, label: 'one' }, { id: 2, label: 'dos' }]));
        await settled(page);
        assert.deepEqual(await rows(), ['unolib', 'twolib', 'one', 'dos']);
        await page.evaluate(() => globalThis.Lib.state.label('LIB'));
        await settled(page);
        assert.deepEqual((await rows()).slice(0, 2), ['unoLIB', 'twoLIB'], 'the library\'s own binding in a row of the app');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('_$controlled: a spread on a field given the other copy\'s live props binds it', async () => {
        // The library hands a live prop of its own, which reads the app's state.
        const { page, errors } = await open('controlled');
        assert.equal(await page.$eval('#forwarded', (el) => el.value), 'app');
        await page.click('#forwarded');
        await page.keyboard.press('End');
        await page.keyboard.type('zz');
        await settled(page);
        assert.equal(await page.$eval('#forwarded', (el) => el.value), 'app', 'a field with no handler is put back');
        await page.evaluate(() => globalThis.App.text('next'));
        await settled(page);
        assert.equal(await page.$eval('#forwarded', (el) => el.value), 'next', 'and follows the state');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('lazy children: children and a JSX prop handed to the other copy\'s component, and the other way', async () => {
        const { page, errors } = await open('children');
        assert.equal(await html(page, '.card'), '<header><b class="head">head</b></header><em class="body">body</em>');
        assert.equal(await html(page, '.inner'), '<i>from lib</i>');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('the class bridge: the other copy\'s class component by a member tag, an alias and memo()', async () => {
        const { page, errors } = await open('classes');
        assert.deepEqual(await page.$$eval('#app b.legacy', (els) => els.map((el) => el.textContent)), ['member', 'alias', 'memo']);
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('optionsChanged: the options one copy renders into the other copy\'s controlled select are selected as its value says', async () => {
        // The app's copy has no select code: its JSX writes no select prop.
        const { page, errors } = await open('options');
        assert.equal(await page.$eval('#choose', (el) => el.options.length), 0);
        await page.evaluate(() => globalThis.App.opts(['a', 'b', 'c']));
        await settled(page);
        assert.equal(await page.$eval('#choose', (el) => el.value), 'b', 'the select shows its value once the options arrive');
        await page.evaluate(() => globalThis.App.opts(['c', 'b']));
        await settled(page);
        assert.equal(await page.$eval('#choose', (el) => el.value), 'b', 'and after they change');
        await page.evaluate(() => globalThis.Lib.state.chosen('c'));
        await settled(page);
        assert.equal(await page.$eval('#choose', (el) => el.value), 'c', 'and follows its value');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('the vnode renderer: an h() component of the other copy, rendered by a copy that makes no vnode', async () => {
        const { page, errors } = await open('vnode');
        // Between the markers of a component whose output is not one element.
        assert.equal((await html(page, '.host')).replace(/<!--[^>]*-->/g, ''), '<b class="made" title="lib">made by h</b>');
        // Its binding is its own copy's.
        await page.evaluate(() => globalThis.Lib.state.label('LIB'));
        await settled(page);
        assert.equal(await page.$eval('.made', (el) => el.title), 'LIB');
        assert.deepEqual(errors, []);
        await page.close();
      });

      it('the pull phase: the other copy\'s computed, read by a copy that made none', async () => {
        const { page, errors } = await open('pull');
        assert.equal(await page.$eval('.total', (el) => el.textContent), '20');
        assert.deepEqual(await page.evaluate(() => globalThis.App.read), [20]);
        // Its own copy keeps it current: written there, read again here.
        await page.evaluate(() => globalThis.Lib.state.n(3));
        assert.equal(await page.evaluate(() => globalThis.Lib.total()), 30);
        assert.deepEqual(errors, []);
        await page.close();
      });
    });
  }
}
