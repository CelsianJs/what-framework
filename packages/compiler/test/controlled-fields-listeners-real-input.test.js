// A controlled field under real input, in Chromium and in WebKit (where
// WebKit launches: CI installs Chromium only), development and production:
// the handlers a field's path holds decide when it is put back, and a form's
// reset and the form kit see what the user did.
//
// - A listener render.js on() added is counted while it is there: removing the
//   last change listener of a text field, by its function or with its owner,
//   leaves the field as one with no handler (put back as the user types), and
//   removing one of two leaves it the user's until the commit.
// - A handler an h() element's props added (dom.js setProp, `_events`) is on
//   the path as a compiled one is: an h() form's onChange (either phase) over
//   a compiled field, and its onInput.
// - A form's native reset gives each field its default; a field a prop
//   controls shows the prop again, whether a script resets the form or the
//   user presses its reset button (React keeps a controlled field's value).
//   WebKit showed the default.
// - form.register() on a multiple select: its value is the array of the
//   options picked, from the keyboard (a listbox fires only `change` for a
//   key typed) and from a script that picks and dispatches the events.
//
// Clicks and typed keys, not dispatched events: the browser runs microtasks
// between the events of one action, which script-dispatched events hide.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, webkit } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const core = (file) => JSON.stringify(path.join(root, 'packages/core/src', file));

const source = `
  import { signal, mount, h, createRoot } from 'what-framework';
  import { on } from 'what-framework/render';
  import { useForm, Select } from 'what-framework/form';
  export const seen = [];
  const saw = (s) => seen.push(s);
  export const s = {
    off: signal('a'), offOne: signal('a'), owned: signal('a'), hChild: signal('a'), hCapture: signal('a'), hInput: signal('a'),
    accepted: signal('a'), box: signal(false), pick: signal('a'), many: signal(['a']),
  };
  export const fields = {};
  let form;
  export const forms = {};
  const Child = (props) => <input id={props.id} value={s[props.id]()} />;
  function Kit() {
    form = forms.kit = useForm({ defaultValues: { many: ['a'], one: 'a', text: 'a', merged: 'a' } });
    return <div>
      <select id="regMany" multiple {...form.register('many')}><option>a</option><option>b</option><option>c</option></select>
      <select id="regOne" {...form.register('one')}><option>a</option><option>b</option><option>c</option></select>
      <input id="regText" {...form.register('text')} />
      <Select id="kitSelect" name="merged" register={form.register} onChange={(e) => saw('kit ' + e.target.value)}><option>a</option><option>b</option></Select>
    </div>;
  }
  function App() {
    return <div>
      <input id="off" value={s.off()} ref={(el) => { fields.off = el; }} />
      <input id="offOne" value={s.offOne()} ref={(el) => { fields.offOne = el; }} />
      <input id="owned" value={s.owned()} ref={(el) => { fields.owned = el; }} />
      <div id="hosts" />
      <form id="resetForm">
        <input id="accepted" value={s.accepted()} onInput={(e) => s.accepted(e.target.value)} />
        <input id="box" type="checkbox" checked={s.box()} onChange={(e) => s.box(e.target.checked)} />
        <select id="pick" value={s.pick()} onChange={(e) => s.pick(e.target.value)}><option>a</option><option>b</option><option>c</option></select>
        <select id="many" multiple value={s.many()} onChange={(e) => s.many([...e.target.selectedOptions].map((o) => o.value))}><option>a</option><option>b</option><option>c</option></select>
        <input id="free" />
        <button id="resetButton" type="reset">reset</button>
      </form>
      <Kit />
      <button id="elsewhere">elsewhere</button>
    </div>;
  }
  export let disposeOwned;
  export function start() {
    mount(App, document.getElementById('app'));
    // The last change listener goes: the field has no handler.
    on(fields.off, 'change', () => saw('off'))();
    // One of two goes: the field still has one.
    on(fields.offOne, 'change', () => saw('offOne kept'));
    const stop = on(fields.offOne, 'change', () => saw('offOne removed'));
    stop();
    stop();
    // A listener that goes with its owner.
    createRoot((dispose) => { on(fields.owned, 'change', () => saw('owned')); disposeOwned = dispose; });
    // An h() form above a compiled field, its handler in each phase, and one for input.
    const hosts = document.getElementById('hosts');
    mount(h('form', { onChange: (e) => saw('hChild ' + e.target.value) }, h(Child, { id: 'hChild' })), hosts.appendChild(document.createElement('div')));
    mount(h('form', { onChangeCapture: (e) => saw('hCapture ' + e.target.value) }, h(Child, { id: 'hCapture' })), hosts.appendChild(document.createElement('div')));
    mount(h('form', { onInput: (e) => s.hInput(e.target.value) }, h(Child, { id: 'hInput' })), hosts.appendChild(document.createElement('div')));
  }
`;

async function launches(type) {
  if (type === chromium) return chromiumLaunches(chromium);
  try {
    await (await type.launch()).close();
    return true;
  } catch {
    return false;
  }
}

const engines = [['Chromium', chromium], ['WebKit', webkit]];
const available = new Map();
for (const [, type] of engines) available.set(type, await launches(type));

for (const [engine, type] of engines) {
  for (const dev of [true, false]) {
    describe(`a controlled field's handlers, reset and form kit under real input (${engine}, ${dev ? 'development' : 'production'} runtime)`, { skip: !available.get(type) && `${engine} does not launch here` }, () => {
      let browser;
      let page;
      const errors = [];
      before(async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'what-controlled-listeners-'));
        try {
          const code = compileJSX(source, { production: !dev })
            .replace(/(['"])what-framework(\/(render|form))?\1/g, (_, q, sub, name) => core(name === 'render' ? 'render.js' : name === 'form' ? 'entries/form.js' : 'index.js'));
          const file = path.join(dir, 'entry.mjs');
          writeFileSync(file, code);
          const bundle = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'M', write: false,
            define: { __WHAT_DEV__: String(dev) }, logLevel: 'silent' });
          browser = await type.launch();
          page = await browser.newPage();
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
          await page.setContent('<!doctype html><html><body><div id="app"></div></body></html>');
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          await page.evaluate(() => globalThis.M.start());
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });
      after(async () => {
        await browser?.close();
        assert.deepEqual(errors, []);
      });

      // After an action: a task, so every check the action scheduled has run.
      const settled = () => page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
      const seen = () => page.evaluate(() => globalThis.M.seen.splice(0));
      const sig = (name) => page.evaluate((n) => globalThis.M.s[n].peek(), name);
      const value = (sel) => page.$eval(sel, (el) => el.value);
      const picked = (sel) => page.$eval(sel, (el) => [...el.selectedOptions].map((o) => o.value));
      const formValue = (name) => page.evaluate((n) => globalThis.M.forms.kit.getValue(n), name);
      const typeAtEnd = async (sel, text) => {
        await page.click(sel);
        await page.keyboard.press('End');
        await page.keyboard.type(text);
        await settled();
      };

      it('the last change listener removed: the field is put back as the user types, as one with no handler', async () => {
        await typeAtEnd('#off', 'bc');
        assert.equal(await value('#off'), 'a');
      });

      it('one of two change listeners removed (twice): the field is still the user\'s until the commit', async () => {
        await typeAtEnd('#offOne', 'bc');
        assert.equal(await value('#offOne'), 'abc');
        await page.keyboard.press('Tab');
        await settled();
        assert.deepEqual(await seen(), ['offOne kept']);
        assert.equal(await value('#offOne'), 'a', 'the handler did not take the edit');
      });

      it('a change listener that goes with its owner', async () => {
        await typeAtEnd('#owned', 'bc');
        assert.equal(await value('#owned'), 'abc', 'while it is there, the field is the user\'s');
        await page.keyboard.press('Tab');
        await settled();
        assert.deepEqual(await seen(), ['owned']);
        assert.equal(await value('#owned'), 'a');
        await page.evaluate(() => globalThis.M.disposeOwned());
        await typeAtEnd('#owned', 'bc');
        assert.equal(await value('#owned'), 'a', 'once it is gone, the field has no handler');
      });

      it('an h() form\'s onChange over a compiled field, in the bubble and the capture phase', async () => {
        for (const id of ['hChild', 'hCapture']) {
          await typeAtEnd('#' + id, 'bc');
          assert.equal(await value('#' + id), 'abc', `${id}: the field is the user's while they type`);
          await page.keyboard.press('Tab');
          await settled();
          assert.deepEqual(await seen(), [`${id} abc`], `${id}: the handler sees the edit`);
          assert.equal(await value('#' + id), 'a', `${id}: and the field goes back, as the handler did not take it`);
        }
      });

      it('an h() form\'s onInput over a compiled field takes each key', async () => {
        await typeAtEnd('#hInput', 'bc');
        assert.equal(await sig('hInput'), 'abc');
        assert.equal(await value('#hInput'), 'abc');
      });

      it('a form reset by a script, and by its reset button: a controlled field shows its prop, any other its default', async () => {
        await typeAtEnd('#accepted', 'z');
        await page.click('#box');
        await page.focus('#pick');
        await page.keyboard.type('b');
        await page.focus('#many');
        await page.keyboard.type('c');
        await typeAtEnd('#free', 'typed');
        await settled();
        const shown = () => page.evaluate(() => {
          const $ = (id) => document.getElementById(id);
          return [$('accepted').value, $('box').checked, $('pick').value, [...$('many').selectedOptions].map((o) => o.value), $('free').value];
        });
        assert.deepEqual(await shown(), ['az', true, 'b', ['c'], 'typed']);
        assert.deepEqual([await sig('accepted'), await sig('box'), await sig('pick'), await sig('many')], ['az', true, 'b', ['c']]);

        // A script's reset is put right by the first microtask after it.
        const afterScript = await page.evaluate(() => {
          document.getElementById('resetForm').reset();
          return Promise.resolve().then(() => document.getElementById('accepted').value);
        });
        assert.equal(afterScript, 'az');
        await settled();
        assert.deepEqual(await shown(), ['az', true, 'b', ['c'], '']);

        await typeAtEnd('#free', 'again');
        await page.click('#resetButton');
        await settled();
        assert.deepEqual(await shown(), ['az', true, 'b', ['c'], '']);
      });

      it('form.register() on a multiple select: the options picked, from the keyboard and from a script', async () => {
        assert.deepEqual(await picked('#regMany'), ['a']);
        await page.focus('#regMany');
        await page.keyboard.type('b');
        await settled();
        assert.deepEqual(await picked('#regMany'), ['b']);
        assert.deepEqual(await formValue('many'), ['b'], 'a key typed in a listbox fires change alone');
        await page.selectOption('#regMany', ['a', 'c']);
        await settled();
        assert.deepEqual(await formValue('many'), ['a', 'c']);
      });

      it('form.register() on a single select and a text field, and <Select> with an onChange of its own', async () => {
        await page.focus('#regOne');
        await page.keyboard.type('c');
        await settled();
        assert.equal(await formValue('one'), 'c');
        await typeAtEnd('#regText', 'bc');
        assert.equal(await formValue('text'), 'abc', 'a text field takes each key');
        await page.click('#elsewhere');
        await settled();
        assert.equal(await formValue('text'), 'abc');
        await page.focus('#kitSelect');
        await page.keyboard.type('b');
        await settled();
        assert.equal(await formValue('merged'), 'b', 'the registration takes the pick');
        assert.deepEqual(await seen(), ['kit b'], 'and the caller\'s onChange runs beside it');
      });
    });
  }
}
