// Hydration and the fields a page shows before it runs. A field the user
// changed keeps what they left in it; one they did not is left as the markup
// shows it; and no input or change event is dispatched for either, as
// released React (react-dom 19.3) does for every field but a textarea, which
// it puts back to the server's text. A value the browser restored on a
// history navigation looks like an edit, so a replayed event ran handlers on
// Back. "Changed" is what the browser's own reset says differs: a range's
// midpoint, a color's #000000, a select whose first group is disabled, a
// radio group with two checked attributes are untouched. Before, those read
// as changed: hydration wrote their value back, which made them dirty, so a
// later default no longer moved them, and their handlers ran on load.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const env = installDOM();
const { h, hydrate, signal, flushSync, onMount, useEffect, lazy, Suspense } = await import('what-core');
const { renderToHydratableString } = await import('../src/index.js');
const { loadCompiled } = await import('../../../test-utils/load-compiled.js');

const flush = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

// Each field: its markup (the props of a server render), a later default, and
// how to read what it shows.
const fields = {
  text: { tag: 'input', props: { type: 'text' }, first: 'a', later: 'b', read: (el) => el.value, edit: (el) => { el.value = 'typed'; } },
  textarea: { tag: 'textarea', props: {}, first: 'a', later: 'b', read: (el) => el.value, edit: (el) => { el.value = 'typed'; } },
  number: { tag: 'input', props: { type: 'number' }, first: '1', later: '2', read: (el) => el.value, edit: (el) => { el.value = '7'; } },
  date: { tag: 'input', props: { type: 'date' }, first: '2026-01-01', later: '2026-02-02', read: (el) => el.value, edit: (el) => { el.value = '2026-03-03'; } },
  // No value attribute: the browser shows the midpoint, and #000000.
  range: { tag: 'input', props: { type: 'range' }, first: undefined, later: '20', read: (el) => el.value, edit: (el) => { el.value = '80'; } },
  color: { tag: 'input', props: { type: 'color' }, first: undefined, later: '#ff0000', read: (el) => el.value, edit: (el) => { el.value = '#00ff00'; } },
  checkbox: { tag: 'input', props: { type: 'checkbox' }, first: false, later: true, read: (el) => el.checked, edit: (el) => { el.checked = true; }, prop: 'defaultChecked' },
};

describe('hydration and fields the user did not touch', () => {
  for (const [name, field] of Object.entries(fields)) {
    it(`${name}: left as the markup shows it (a later default still moves it), and no event`, async () => {
      const prop = field.prop || 'defaultValue';
      const dflt = signal(field.first);
      const view = () => h('form', null, h(field.tag, { name: 'f', ...field.props, [prop]: dflt }));
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = renderToHydratableString(view());
      const el = host.querySelector('[name=f]');
      const before = field.read(el);
      const events = [];
      host.addEventListener('input', (e) => events.push(e.type), true);
      host.addEventListener('change', (e) => events.push(e.type), true);
      const stop = hydrate(view(), host);
      await flush();
      try {
        assert.equal(host.querySelector('[name=f]'), el);
        assert.equal(field.read(el), before);
        dflt(field.later);
        flushSync();
        assert.equal(String(field.read(el)), String(field.later), 'not dirty: the default moves it');
        assert.deepEqual(events, []);
      } finally {
        stop();
        host.remove();
      }
    });

    it(`${name}: an edit before hydration stays, and no event is dispatched for it`, async () => {
      const prop = field.prop || 'defaultValue';
      const view = () => h('form', null, h(field.tag, { name: 'f', ...field.props, [prop]: field.first }));
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = renderToHydratableString(view());
      const el = host.querySelector('[name=f]');
      field.edit(el);
      const edited = field.read(el);
      const events = [];
      host.addEventListener('input', (e) => events.push(e.type), true);
      host.addEventListener('change', (e) => events.push(e.type), true);
      const stop = hydrate(view(), host);
      await flush();
      try {
        assert.equal(field.read(el), edited);
        assert.deepEqual(events, []);
      } finally {
        stop();
        host.remove();
      }
    });
  }

  it('a select whose first group is disabled: the browser\'s selection is untouched', async () => {
    const dflt = signal(undefined);
    const view = () => h('form', null, h('select', { name: 'f', defaultValue: dflt },
      h('optgroup', { label: 'Off', disabled: true }, h('option', { value: 'x' }, 'x')),
      h('option', { value: 'a' }, 'a'), h('option', { value: 'b' }, 'b')));
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    const select = host.querySelector('select');
    const shown = select.value;
    const events = [];
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.equal(select.value, shown);
      dflt('b');
      flushSync();
      assert.equal(select.value, 'b', 'not dirty: the default moves it');
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });

  it('a radio group whose markup checks two: the browser checks the last, and that is untouched', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = '<form><input type="radio" name="f" value="a" checked><input type="radio" name="f" value="b" checked></form>';
    const view = () => h('form', null, h('input', { type: 'radio', name: 'f', value: 'a', defaultChecked: true }), h('input', { type: 'radio', name: 'f', value: 'b', defaultChecked: true }));
    const [a, b] = host.querySelectorAll('input');
    assert.deepEqual([a.checked, b.checked], [false, true]);
    const events = [];
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.deepEqual([a.checked, b.checked], [false, true]);
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });

  it('a hidden input and a file input are left alone', async () => {
    const view = () => h('form', null, h('input', { type: 'hidden', name: 'h', value: 'kept' }), h('input', { type: 'file', name: 'u' }));
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    const events = [];
    host.addEventListener('input', (e) => events.push(e.type), true);
    host.addEventListener('change', (e) => events.push(e.type), true);
    const stop = hydrate(view(), host);
    await flush();
    try {
      assert.equal(host.querySelector('[name=h]').value, 'kept');
      assert.equal(host.querySelector('[name=u]').value, '');
      assert.deepEqual(events, []);
    } finally {
      stop();
      host.remove();
    }
  });

  // An input or a textarea whose live state is its markup's is untouched as
  // it stands: hydration builds no copy of it to reset (a copy is built in a
  // <form> of its own) for any but a field that differs. Before, every field
  // was copied and reset, which made hydrating a long form slow.
  it('an untouched input, textarea, checkbox or radio is compared in place, with no reset copy', async () => {
    const view = (title) => h('form', null,
      h('input', { name: 'title', defaultValue: title }),
      h('input', { type: 'number', name: 'n', defaultValue: '20' }),
      h('input', { type: 'date', name: 'd', defaultValue: '2026-11-22' }),
      h('input', { type: 'range', name: 'r', defaultValue: '25' }),
      h('input', { type: 'color', name: 'c', defaultValue: '#00ff00' }),
      h('textarea', { name: 't', defaultValue: 'note' }),
      h('input', { type: 'checkbox', name: 'ok', defaultChecked: true }),
      h('input', { type: 'radio', name: 'pick', value: 'a', defaultChecked: true }),
      h('input', { type: 'radio', name: 'pick', value: 'b' }));
    const copiesWhile = async (edit) => {
      const host = document.createElement('div');
      document.body.append(host);
      host.innerHTML = renderToHydratableString(view('draft'));
      edit(host);
      const create = document.createElement;
      let copies = 0;
      document.createElement = function (tag, ...rest) {
        if (String(tag).toLowerCase() === 'form') copies++;
        return create.call(this, tag, ...rest);
      };
      let stop = () => {};
      try {
        stop = hydrate(view('draft'), host);
        await flush();
      } finally {
        document.createElement = create;
        stop();
        host.remove();
      }
      return copies;
    };
    assert.equal(await copiesWhile(() => {}), 0, 'no field changed: no copy');
    assert.ok(await copiesWhile((host) => { host.querySelector('[name=title]').value = 'typed'; }) > 0, 'a changed field is compared through a copy');
  });

  // A browser lists a form-associated custom element in form.elements, and
  // one may say it is a radio (`type`) of a native group's name. A changed
  // radio group is compared through copies, which are native radios only:
  // a copy of the custom element would run its constructor and callbacks.
  it('a form-associated element that says it is a radio is no radio of the group: no copy of it is made', async () => {
    let constructed = 0;
    class Pick extends window.HTMLElement {
      constructor() {
        super();
        constructed++;
      }
      get type() { return 'radio'; }
      get name() { return this.getAttribute('name'); }
      get form() { return this.closest('form'); }
      get checked() { return false; }
    }
    window.customElements.define('x-pick-radio', Pick);
    const view = () => h('form', null,
      h('input', { type: 'radio', name: 'pick', value: 'a', defaultChecked: true }),
      h('input', { type: 'radio', name: 'pick', value: 'b' }),
      h('x-pick-radio', { name: 'pick' }));
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    host.querySelector('[value=b]').checked = true;
    const elements = Object.getOwnPropertyDescriptor(window.HTMLFormElement.prototype, 'elements');
    // As a browser lists it: the native controls and the custom element.
    Object.defineProperty(window.HTMLFormElement.prototype, 'elements', {
      configurable: true,
      get() { return [...elements.get.call(this), ...this.querySelectorAll('x-pick-radio')]; },
    });
    const before = constructed;
    let stop = () => {};
    try {
      stop = hydrate(view(), host);
      await flush();
      assert.equal(constructed, before, 'no copy of the custom element');
      assert.equal(host.querySelector('[value=b]').checked, true, 'the user\'s choice stays');
    } finally {
      Object.defineProperty(window.HTMLFormElement.prototype, 'elements', elements);
      stop();
      host.remove();
    }
  });
});

// A country the user picked before hydration, with what depends on it: the
// component reads the field in onMount and writes its state from it. Before,
// the fields were restored after the hydration's mount callbacks had run, so
// a synchronous read there saw the server's value.
describe('the mount callbacks of a hydration see what the user left in each field', () => {
  const countries = ['CA', 'US'];
  function Country({ seen }) {
    const country = signal('CA');
    let select;
    let note;
    onMount(() => {
      seen.push(['onMount', select.value, note.value]);
      country(select.value);
    });
    useEffect(() => {
      seen.push(['useEffect', select.value, note.value]);
    }, []);
    return h('form', null,
      h('select', { name: 'country', value: country, ref: (el) => { select = el; }, onChange: (e) => country(e.currentTarget.value) },
        ...countries.map((c) => h('option', { value: c }, c))),
      h('input', { name: 'note', defaultValue: 'server', ref: (el) => { note = el; } }),
      h('p', { id: 'regions' }, () => (country() === 'US' ? 'NY, TX' : 'BC, ON')));
  }

  async function edited(view, hydrateView) {
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(view());
    host.querySelector('[name=country]').value = 'US';
    host.querySelector('[name=note]').value = 'typed';
    const stop = hydrateView(host);
    await flush();
    return { host, stop };
  }

  it('in a full-page hydration of h() vnodes', async () => {
    const seen = [];
    const { host, stop } = await edited(() => h(Country, { seen: [] }), (el) => hydrate(h(Country, { seen }), el));
    try {
      assert.deepEqual(seen, [['onMount', 'US', 'typed'], ['useEffect', 'US', 'typed']]);
      assert.equal(host.querySelector('#regions').textContent, 'NY, TX');
      assert.equal(host.querySelector('[name=country]').value, 'US');
    } finally {
      stop();
      host.remove();
    }
  });

  it('in compiled JSX', async () => {
    const source = `
      import { signal, onMount } from 'what-framework';
      export function Country(props) {
        const country = signal('CA');
        let select;
        onMount(() => { props.seen.push(select.value); country(select.value); });
        return <form>
          <select name="country" value={country()} ref={(el) => { select = el; }}><option value="CA">CA</option><option value="US">US</option></select>
          <p id="regions">{country() === 'US' ? 'NY, TX' : 'BC, ON'}</p>
        </form>;
      }`;
    const server = await loadCompiled(source, { pluginOptions: { generate: 'ssr' } });
    const client = await loadCompiled(source, { pluginOptions: { hydratable: true } });
    const seen = [];
    const { host, stop } = await (async () => {
      const el = document.createElement('div');
      document.body.append(el);
      el.innerHTML = renderToHydratableString(h(server.Country, { seen: [] }));
      el.querySelector('[name=country]').value = 'US';
      const unmount = hydrate(h(client.Country, { seen }), el);
      await flush();
      return { host: el, stop: unmount };
    })();
    try {
      assert.deepEqual(seen, ['US']);
      assert.equal(host.querySelector('#regions').textContent, 'NY, TX');
    } finally {
      stop();
      host.remove();
    }
  });

  it('in a <Suspense> whose content waits for its code: the walk that reveals it restores first', async () => {
    let load;
    const Lazy = lazy(() => new Promise((resolve) => { load = resolve; }));
    const seen = [];
    const host = document.createElement('div');
    document.body.append(host);
    host.innerHTML = renderToHydratableString(h(Suspense, { fallback: h('i', null, 'loading') }, h(Country, { seen: [] })));
    const stop = hydrate(h(Suspense, { fallback: h('i', null, 'loading') }, h(Lazy, { seen })), host);
    await flush();
    try {
      assert.equal(host.querySelector('i'), null, 'the server\'s content stays up while the code loads');
      host.querySelector('[name=country]').value = 'US';
      host.querySelector('[name=note]').value = 'typed';
      load({ default: Country });
      for (let i = 0; i < 10 && seen.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 1));
      assert.deepEqual(seen, [['onMount', 'US', 'typed'], ['useEffect', 'US', 'typed']]);
      assert.equal(host.querySelector('#regions').textContent, 'NY, TX');
    } finally {
      stop();
      host.remove();
    }
  });
});

process.on('exit', () => env.cleanup());
