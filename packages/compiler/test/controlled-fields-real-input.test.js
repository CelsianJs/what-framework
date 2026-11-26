// A controlled field under real input in Chromium: mouse clicks and typed
// keys, which the browser dispatches itself. A click on a checkbox fires
// `input` and then `change`, and the browser runs microtasks after each
// listener: a field put back after `input` was unchecked again before an
// `onChange` handler ran, so `onChange={(e) => on(e.target.checked)}` could
// never check it. Script-dispatched events (react-habits.test.js) run every
// listener before any microtask and cannot show this. A field is put back once
// every event of the user's action has been handled (dom.js controlledChanged).
// A text field's onChange is React's: it hears each key (dom.js _onChange).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const source = `
  import { signal, mount } from 'what-framework';
  export const seen = [];
  const saw = (s) => seen.push(s);
  export const s = {
    on: signal(false), labelled: signal(false), toggled: signal(false), refused: signal(false),
    choice: signal('x'), refusedChoice: signal('x'), picked: signal('a'), refusedPick: signal('a'),
    typed: signal('a'), committed: signal('a'), both: signal('a'), digits: signal('a'), locked: signal('a'),
    commitRefused: signal('a'), wrapped: signal('a'), inForm: signal('a'),
  };
  function Field(props) { return <input {...props} />; }
  function App() {
    return <div>
      <input id="on" type="checkbox" checked={s.on()} onChange={(e) => { saw('on ' + e.target.checked); s.on(e.target.checked); }} />
      <label id="label"><input id="labelled" type="checkbox" checked={s.labelled()} onChange={(e) => { saw('labelled ' + e.target.checked); s.labelled(e.target.checked); }} /> the label</label>
      <input id="toggled" type="checkbox" checked={s.toggled()} onChange={(e) => { saw('toggled ' + e.target.checked); s.toggled(!s.toggled()); }} />
      <input id="refused" type="checkbox" checked={s.refused()} onChange={(e) => saw('refused ' + e.target.checked)} />
      <div>{['x', 'y', 'z'].map((v) => <input key={v} id={'choice-' + v} type="radio" name="choice" value={v} checked={s.choice() === v} onChange={(e) => { saw('choice ' + e.target.value + ' ' + e.target.checked); s.choice(e.target.value); }} />)}</div>
      <div>{['x', 'y'].map((v) => <input key={v} id={'refused-' + v} type="radio" name="refusedChoice" value={v} checked={s.refusedChoice() === v} onChange={(e) => saw('refusedChoice ' + e.target.value)} />)}</div>
      <select id="picked" value={s.picked()} onChange={(e) => { saw('picked ' + e.target.value); s.picked(e.target.value); }}><option>a</option><option>b</option><option>c</option></select>
      <select id="refusedPick" value={s.refusedPick()} onChange={(e) => saw('refusedPick ' + e.target.value)}><option>a</option><option>b</option><option>c</option></select>
      <input id="typed" value={s.typed()} onInput={(e) => s.typed(e.target.value)} />
      <input id="committed" value={s.committed()} onChange={(e) => { saw('committed ' + e.target.value); s.committed(e.target.value); }} />
      <input id="commitRefused" value={s.commitRefused()} onChange={(e) => saw('commitRefused ' + e.target.value)} />
      <input id="both" value={s.both()} onInput={(e) => s.both(e.target.value)} onChange={(e) => saw('both ' + e.target.value)} />
      <input id="digits" value={s.digits()} onInput={(e) => { if (!/\\d/.test(e.target.value)) s.digits(e.target.value); }} />
      <input id="locked" value={s.locked()} />
      <Field id="wrapped" value={s.wrapped()} onChange={(e) => { saw('wrapped ' + e.target.value); s.wrapped(e.target.value); }} />
      <form onChange={(e) => { saw('form ' + e.target.value); s.inForm(e.target.value); }}><input id="inForm" value={s.inForm()} /></form>
      <button id="elsewhere">elsewhere</button>
    </div>;
  }
  export function start() { mount(App, document.getElementById('app')); }
`;

const browserAvailable = await chromiumLaunches(chromium);

for (const dev of [true, false]) {
  describe(`a controlled field under real input (${dev ? 'development' : 'production'} runtime)`, { skip: !browserAvailable }, () => {
    let browser;
    let page;
    const errors = [];
    before(async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'what-controlled-'));
      try {
        const code = compileJSX(source, { production: !dev })
          .replace(/(['"])what-framework(\/render)?\1/g, (_, q, sub) => JSON.stringify(path.join(root, 'packages/core/src', sub ? 'render.js' : 'index.js')));
        const file = path.join(dir, 'entry.mjs');
        writeFileSync(file, code);
        const bundle = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'M', write: false,
          define: { __WHAT_DEV__: String(dev) }, logLevel: 'silent' });
        browser = await chromium.launch();
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
    const checked = (sel) => page.$eval(sel, (el) => el.checked);
    const value = (sel) => page.$eval(sel, (el) => el.value);
    const typeAtEnd = async (sel, text) => {
      await page.click(sel);
      await page.keyboard.press('End');
      await page.keyboard.type(text);
      await settled();
    };

    it('a checkbox click: the change handler reads the new state, and the box keeps it', async () => {
      await page.click('#on');
      await settled();
      assert.deepEqual(await seen(), ['on true']);
      assert.equal(await sig('on'), true);
      assert.equal(await checked('#on'), true);
      await page.click('#on');
      await settled();
      assert.deepEqual(await seen(), ['on false']);
      assert.equal(await checked('#on'), false);
    });

    it('a click on the label of a checkbox, and Space on the focused box', async () => {
      await page.click('#label', { position: { x: 60, y: 6 } });
      await settled();
      assert.deepEqual(await seen(), ['labelled true']);
      assert.equal(await checked('#labelled'), true);
      await page.focus('#labelled');
      await page.keyboard.press('Space');
      await settled();
      assert.deepEqual(await seen(), ['labelled false']);
      assert.equal(await sig('labelled'), false);
      assert.equal(await checked('#labelled'), false);
    });

    it('a handler that toggles the state it reads', async () => {
      await page.click('#toggled');
      await settled();
      assert.deepEqual(await seen(), ['toggled true']);
      assert.equal(await checked('#toggled'), true);
      await page.focus('#toggled');
      await page.keyboard.press('Space');
      await settled();
      assert.deepEqual(await seen(), ['toggled false']);
      assert.equal(await checked('#toggled'), false);
      assert.equal(await sig('toggled'), false);
    });

    it('a click the handler refuses: the handler sees the edit, then the box goes back', async () => {
      await page.click('#refused');
      await settled();
      assert.deepEqual(await seen(), ['refused true']);
      assert.equal(await checked('#refused'), false);
    });

    it('a radio group: a click and an arrow key move the choice; a refused click puts the group back', async () => {
      await page.click('#choice-y');
      await settled();
      assert.deepEqual(await seen(), ['choice y true']);
      assert.equal(await sig('choice'), 'y');
      await page.keyboard.press('ArrowDown');
      await settled();
      assert.deepEqual(await seen(), ['choice z true']);
      assert.deepEqual(await Promise.all(['x', 'y', 'z'].map((v) => checked('#choice-' + v))), [false, false, true]);

      await page.click('#refused-y');
      await settled();
      assert.deepEqual(await seen(), ['refusedChoice y']);
      assert.deepEqual([await checked('#refused-x'), await checked('#refused-y')], [true, false]);
    });

    it('a select picked from the keyboard; a refused pick goes back', async () => {
      await page.focus('#picked');
      await page.keyboard.type('c');
      await settled();
      assert.deepEqual(await seen(), ['picked c']);
      assert.equal(await sig('picked'), 'c');
      assert.equal(await value('#picked'), 'c');

      await page.focus('#refusedPick');
      await page.keyboard.type('b');
      await settled();
      assert.deepEqual(await seen(), ['refusedPick b']);
      assert.equal(await value('#refusedPick'), 'a');
    });

    it('a text field with onInput takes each key; one that refuses digits drops them', async () => {
      await typeAtEnd('#typed', 'bc');
      assert.equal(await sig('typed'), 'abc');
      assert.equal(await value('#typed'), 'abc');
      await typeAtEnd('#digits', 'b1c');
      assert.equal(await value('#digits'), 'abc');
      assert.equal(await sig('digits'), 'abc');
    });

    it('a text field with only onChange: the state takes each key, as React\'s onChange does', async () => {
      await typeAtEnd('#committed', 'bc');
      assert.deepEqual(await seen(), ['committed ab', 'committed abc']);
      assert.equal(await sig('committed'), 'abc');
      assert.equal(await value('#committed'), 'abc');
      await page.keyboard.press('Tab');
      await settled();
      assert.deepEqual(await seen(), [], 'the change on blur reports nothing new');

      await typeAtEnd('#commitRefused', 'bc');
      assert.deepEqual(await seen(), ['commitRefused ab', 'commitRefused ac'], 'each key, the field put back after each');
      assert.equal(await value('#commitRefused'), 'a', 'an edit the handler refused is undone');
      await page.keyboard.press('Enter');
      await settled();
      assert.deepEqual(await seen(), []);
    });

    it('a text field with onInput and onChange: both hear each key', async () => {
      await typeAtEnd('#both', 'bc');
      assert.equal(await sig('both'), 'abc');
      assert.deepEqual(await seen(), ['both ab', 'both abc']);
      await page.keyboard.press('Tab');
      await settled();
      assert.deepEqual(await seen(), []);
      assert.equal(await value('#both'), 'abc');
    });

    it('a text field with no handler cannot be changed', async () => {
      await typeAtEnd('#locked', 'bc');
      assert.equal(await value('#locked'), 'a');
    });

    it('onChange through a spread in a wrapper, and on a form above the field: each key', async () => {
      await typeAtEnd('#wrapped', 'bc');
      assert.deepEqual(await seen(), ['wrapped ab', 'wrapped abc']);
      assert.equal(await sig('wrapped'), 'abc');
      assert.equal(await value('#wrapped'), 'abc');
      await page.keyboard.press('Tab');
      await settled();
      assert.deepEqual(await seen(), []);

      await typeAtEnd('#inForm', 'bc');
      assert.deepEqual(await seen(), ['form ab', 'form abc']);
      assert.equal(await sig('inForm'), 'abc');
      await page.click('#elsewhere');
      await settled();
      assert.deepEqual(await seen(), []);
      assert.equal(await value('#inForm'), 'abc');
    });
  });
}
