// onChange is React's change event, under real input in Chromium, WebKit and
// Firefox (where they launch: CI installs Chromium only), development and
// production: a text field fires it as the user edits it, once per edit, and
// a checkbox, a radio, a select and a file field when their value changes.
// Every path that binds one is here: compiled JSX's delegated `$$change` (a
// field's, a form's above it), a spread's, a forwarded live handler, an
// onChange with modifiers, an h() element's props, and What's register().
// Each case is one React 19 was measured in, in Chromium, with the same keys
// (dom.js _onChange): typing, the change on blur, paste, undo, an input
// method's composition, a number field's `1.` on the way to `1.5`, a field
// whose type changes, a controlled field that takes, transforms or refuses an
// edit, and onInput beside onChange. What differs from React is said where it
// is tested: an event a script dispatches after its own write is an edit here
// (as in what-react), and a field forgets what it held when it loses focus.
// `on(el, 'change', fn)` stays the DOM's change event: the commit, on blur.
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
import { chromium, firefox, webkit } from 'playwright';
import { chromiumLaunches } from '../../../test-utils/chromium.js';
import { compileJSX } from '../../../test-utils/compile.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const core = (file) => JSON.stringify(path.join(root, 'packages/core/src', file));

const source = `
  import { signal, mount, h } from 'what-framework';
  import { on } from 'what-framework/render';
  import { useForm } from 'what-framework/form';
  export const seen = [];
  const v = (e) => (e.target.type === 'checkbox' || e.target.type === 'radio' ? e.target.checked : e.target.value);
  const saw = (id) => (e) => seen.push(id + ' ' + v(e));
  export const s = { ctl: signal('a'), up: signal('a'), num: signal(''), both: signal('a'), typ: signal('text'), live: signal(true), locked: signal('a') };
  export const refs = {};
  export let form;
  export const count = { validations: 0 };
  function Field(props) { return <input {...props} />; }
  function Forward(props) { const { label, ...rest } = props; return <input {...rest} />; }
  function App() {
    form = useForm({ mode: 'onChange', defaultValues: { email: '' }, resolver: (values) => {
      count.validations++;
      return values.email.length < 3 ? { values: {}, errors: { email: { type: 'min', message: 'short' } } } : { values, errors: {} };
    } });
    return <div>
      <input id="unc" defaultValue="a" onChange={saw('unc')} ref={(el) => { refs.unc = el; }} />
      <input id="ctl" value={s.ctl()} onChange={(e) => { saw('ctl')(e); s.ctl(e.target.value); }} />
      <input id="refused" value={s.locked()} onChange={saw('refused')} />
      <input id="up" value={s.up()} onChange={(e) => { saw('up')(e); s.up(e.target.value.toUpperCase()); }} />
      <input id="num" type="number" value={s.num()} onChange={(e) => { saw('num')(e); s.num(e.target.value); }} />
      <input id="both" value={s.both()} onInput={(e) => { seen.push('input ' + e.target.value); s.both(e.target.value); }} onChange={saw('both')} />
      <form onInput={(e) => e.stopPropagation()} onChange={saw('stopped-form')}><input id="stopped" onInput={(e) => e.stopPropagation()} onChange={saw('stopped')} /></form>
      <form id="form" onChange={saw('form')}><input id="inForm" defaultValue="a" /><input id="formBox" type="checkbox" /><select id="formPick"><option>a</option><option>b</option></select></form>
      <textarea id="ta" defaultValue="a" onChange={saw('ta')} />
      <input id="typ" type={s.typ()} defaultValue="a" onChange={saw('typ')} />
      <input id="chk" type="checkbox" onChange={saw('chk')} />
      <input id="r1" type="radio" name="r" onChange={saw('r1')} /><input id="r2" type="radio" name="r" onChange={saw('r2')} />
      <select id="sel" onChange={saw('sel')}><option>a</option><option>b</option><option>c</option></select>
      <input id="range" type="range" min="0" max="10" defaultValue="5" onChange={saw('range')} />
      <input id="file" type="file" onChange={(e) => seen.push('file ' + e.target.files.length)} />
      <Field id="spread" onChange={saw('spread')} />
      <Forward id="forwarded" label="x" onChange={s.live() ? saw('live-a') : saw('live-b')} />
      <input id="once" onChange__once={saw('once')} />
      <input id="digits" onChange={(e) => { e.target.value = e.target.value.replace(/\\d/g, ''); seen.push('digits ' + e.target.value); }} />
      <input id="native" defaultValue="a" ref={(el) => on(el, 'change', saw('native'))} />
      <input id="rhf" {...form.register('email')} />
      <button id="clear" onClick={() => { refs.unc.value = ''; }}>clear</button>
      <button id="elsewhere">elsewhere</button>
    </div>;
  }
  export function start() {
    mount(<App />, document.getElementById('app'));
    const hosts = document.getElementById('hosts');
    mount(h('input', { id: 'hField', onChange: saw('hField') }), hosts.appendChild(document.createElement('div')));
    mount(h('form', { onChange: saw('hForm') }, h('input', { id: 'hInForm', onInput: (e) => seen.push('hInput ' + e.target.value) })), hosts.appendChild(document.createElement('div')));
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

const engines = [['Chromium', chromium], ['WebKit', webkit], ['Firefox', firefox]];
const available = new Map();
for (const [, type] of engines) available.set(type, await launches(type));

for (const [engine, type] of engines) {
  for (const dev of [true, false]) {
    describe(`onChange is React's change event under real input (${engine}, ${dev ? 'development' : 'production'} runtime)`, { skip: !available.get(type) && `${engine} does not launch here` }, () => {
      let browser;
      let context;
      let page;
      const errors = [];
      before(async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'what-onchange-'));
        try {
          const code = compileJSX(source, { production: !dev })
            .replace(/(['"])what-framework(\/(render|form))?\1/g, (_, q, sub, name) => core(name === 'render' ? 'render.js' : name === 'form' ? 'entries/form.js' : 'index.js'));
          const file = path.join(dir, 'entry.mjs');
          writeFileSync(file, code);
          const bundle = await build({ entryPoints: [file], bundle: true, format: 'iife', globalName: 'M', write: false,
            define: { __WHAT_DEV__: String(dev) }, logLevel: 'silent' });
          browser = await type.launch();
          context = await browser.newContext();
          if (engine === 'Chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
          page = await context.newPage();
          page.on('pageerror', (e) => errors.push(e.message));
          page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
          // A secure origin, where Chromium lets the page write the clipboard.
          await page.route('http://localhost:41234/', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><div id="app"></div><div id="hosts"></div></body></html>' }));
          await page.goto('http://localhost:41234/');
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
      const seen = async () => { await settled(); return page.evaluate(() => globalThis.M.seen.splice(0)); };
      const sig = (name) => page.evaluate((n) => globalThis.M.s[n].peek(), name);
      const value = (sel) => page.$eval(sel, (el) => el.value);
      const typeAtEnd = async (sel, text) => {
        await page.click(sel);
        await page.keyboard.press('End');
        await page.keyboard.type(text);
      };
      const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

      it('a text field fires each edit, and nothing more on blur or Enter', async () => {
        await typeAtEnd('#unc', 'bc');
        assert.deepEqual(await seen(), ['unc ab', 'unc abc']);
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), []);
        await typeAtEnd('#ta', 'b');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['ta ab'], 'a textarea too');
      });

      it('a controlled field that takes, transforms or refuses each edit, as React\'s', async () => {
        await typeAtEnd('#ctl', 'bc');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['ctl ab', 'ctl abc']);
        assert.equal(await value('#ctl'), 'abc');
        await typeAtEnd('#up', 'bc');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['up ab', 'up ABc'], 'what the state wrote is what the next edit starts from');
        assert.equal(await value('#up'), 'ABC');
        await typeAtEnd('#refused', 'bb');
        assert.deepEqual(await seen(), ['refused ab', 'refused ab'], 'put back after each edit, so the same key is an edit again');
        assert.equal(await value('#refused'), 'a');
      });

      it('a number field: `1.` on the way to `1.5` is no edit, as its value is still 1', async () => {
        await typeAtEnd('#num', '1.5');
        assert.deepEqual(await seen(), ['num 1', 'num 1.5']);
        assert.equal(await value('#num'), '1.5');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        assert.deepEqual(await seen(), ['num 1'], '1.5 to 1. is an edit (to 1), 1. to 1 none');
        assert.equal(await sig('num'), '1');
      });

      it('onInput and onChange on one field: both hear each key, onInput first, as React dispatches them', async () => {
        await typeAtEnd('#both', 'bc');
        assert.deepEqual(await seen(), ['input ab', 'both ab', 'input abc', 'both abc'], 'an onInput that writes the state leaves the edit to onChange');
        assert.equal(await sig('both'), 'abc');
      });

      it('an onInput handler that stops the event leaves onChange, which is an event of its own in React', async () => {
        await typeAtEnd('#stopped', 'x');
        assert.deepEqual(await seen(), ['stopped x', 'stopped-form x']);
      });

      it('a form\'s onChange hears its fields: a text field per edit, a checkbox and a select on their change', async () => {
        await typeAtEnd('#inForm', 'b');
        await page.click('#formBox');
        await page.focus('#formPick');
        await page.keyboard.type('b');
        assert.deepEqual(await seen(), ['form ab', 'form true', 'form b']);
      });

      it('paste, undo and an input method\'s composition are edits', async () => {
        await page.click('#unc');
        await page.keyboard.press('End');
        if (engine === 'Chromium') {
          await page.evaluate(() => navigator.clipboard.writeText('xyz'));
          await page.keyboard.press(`${mod}+V`);
          assert.deepEqual(await seen(), ['unc abcxyz'], 'paste');
          await page.keyboard.press(`${mod}+Z`);
          assert.deepEqual(await seen(), ['unc abc'], 'undo');
          const cdp = await context.newCDPSession(page);
          await cdp.send('Input.imeSetComposition', { text: 'n', selectionStart: 1, selectionEnd: 1 });
          await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
          await cdp.send('Input.insertText', { text: '你' });
          assert.deepEqual(await seen(), ['unc abcn', 'unc abcni', 'unc abc你'], 'each step of a composition, as React fires them');
          await cdp.send('Input.insertText', { text: 'Q' });
          assert.deepEqual(await seen(), ['unc abc你Q'], 'text a browser inserts (autofill)');
        } else {
          await page.keyboard.insertText('xyz');
          assert.deepEqual(await seen(), ['unc abcxyz'], 'inserted text');
        }
      });

      it('a value a script writes: a button that clears the field, and the user typing what it held', async () => {
        await page.evaluate(() => { globalThis.M.refs.unc.value = ''; });
        await typeAtEnd('#unc', 'b');
        assert.deepEqual(await seen(), ['unc b']);
        await page.click('#clear');
        await typeAtEnd('#unc', 'b');
        assert.deepEqual(await seen(), ['unc b'], 'the field forgot what it held when it lost focus');
      });

      it('a field a script clears while it keeps the focus hears the same text typed again (a chat box on Enter)', async () => {
        await page.evaluate(() => { globalThis.M.refs.unc.value = ''; });
        await typeAtEnd('#unc', 'h');
        assert.deepEqual(await seen(), ['unc h']);
        await page.evaluate(() => { globalThis.M.refs.unc.value = ''; });
        await page.keyboard.type('h');
        assert.deepEqual(await seen(), ['unc h'], 'the keystroke that makes what the field held before the write');
      });

      it('events a script dispatches: after its own write an edit (as in what-react; React has none), and none that changed nothing', async () => {
        const fire = (write, type) => page.evaluate(([w, t]) => {
          const el = document.getElementById('unc');
          if (w !== null) el.value = w;
          el.dispatchEvent(new Event(t, { bubbles: true }));
        }, [write, type]);
        await fire('s1', 'input');
        assert.deepEqual(await seen(), ['unc s1']);
        await fire(null, 'input');
        assert.deepEqual(await seen(), [], 'an input that changed nothing');
        await fire('s2', 'change');
        assert.deepEqual(await seen(), ['unc s2'], 'a change that reports a new value');
        await page.click('#elsewhere');
        assert.deepEqual(await seen(), [], 'the change on blur reports nothing new');
      });

      it('a handler that writes the field: what it wrote is what onChange saw', async () => {
        await typeAtEnd('#digits', 'a1');
        assert.deepEqual(await seen(), ['digits a', 'digits a']);
        await page.keyboard.type('1');
        assert.deepEqual(await seen(), ['digits a'], 'the same key again is an edit again');
        assert.equal(await value('#digits'), 'a');
      });

      it('a field whose type changes: per edit as text, per click as a checkbox', async () => {
        await typeAtEnd('#typ', 'b');
        assert.deepEqual(await seen(), ['typ ab']);
        await page.evaluate(() => globalThis.M.s.typ('checkbox'));
        await page.click('#typ');
        assert.deepEqual(await seen(), ['typ true']);
        await page.evaluate(() => globalThis.M.s.typ('text'));
        await typeAtEnd('#typ', 'c');
        assert.equal((await seen()).length, 1);
      });

      it('a checkbox, a radio, a select, a range and a file field', async () => {
        await page.click('#chk');
        await page.click('#chk');
        assert.deepEqual(await seen(), ['chk true', 'chk false']);
        await page.click('#r1');
        await page.click('#r2');
        await page.click('#r2');
        assert.deepEqual(await seen(), ['r1 true', 'r2 true'], 'a radio clicked again changed nothing');
        await page.focus('#sel');
        await page.keyboard.type('c');
        assert.deepEqual(await seen(), ['sel c']);
        await page.focus('#range');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowRight');
        assert.deepEqual(await seen(), ['range 6', 'range 7'], 'a range as it moves, as React fires it');
        await page.setInputFiles('#file', { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') });
        assert.deepEqual(await seen(), ['file 1']);
      });

      it('a spread, a forwarded live handler, and onChange with modifiers', async () => {
        await typeAtEnd('#spread', 'ab');
        assert.deepEqual(await seen(), ['spread a', 'spread ab']);
        await typeAtEnd('#forwarded', 'a');
        await page.evaluate(() => globalThis.M.s.live(false));
        await page.keyboard.type('b');
        assert.deepEqual(await seen(), ['live-a a', 'live-b ab'], 'the current handler');
        await typeAtEnd('#once', 'ab');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['once a'], 'once: the first edit');
      });

      it('an h() element\'s onChange, and an h() form\'s over a field', async () => {
        await typeAtEnd('#hField', 'ab');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['hField a', 'hField ab']);
        await typeAtEnd('#hInForm', 'ab');
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['hInput a', 'hForm a', 'hInput ab', 'hForm ab']);
      });

      it('on(el, \'change\') is the DOM\'s change event: the commit, on blur', async () => {
        await typeAtEnd('#native', 'bc');
        assert.deepEqual(await seen(), []);
        await page.keyboard.press('Tab');
        assert.deepEqual(await seen(), ['native abc']);
      });

      it('register(): the form takes and validates each key, once per key', async () => {
        await page.evaluate(() => { globalThis.M.count.validations = 0; });
        await typeAtEnd('#rhf', 'ab');
        await settled();
        const read = () => page.evaluate(() => ({ email: globalThis.M.form.getValue('email'), error: !!globalThis.M.form.formState.errors.email, validations: globalThis.M.count.validations }));
        assert.deepEqual(await read(), { email: 'ab', error: true, validations: 2 });
        await page.keyboard.type('c');
        await page.keyboard.press('Tab');
        await settled();
        assert.deepEqual(await read(), { email: 'abc', error: false, validations: 3 });
      });
    });
  }
}
