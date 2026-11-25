// Spreads read again on SVG, and a field whose kind changes (verification 5).
//
// - SVG attribute names are case-sensitive: `viewBox` and `viewbox` are two
//   attributes, and a spread that wrote `viewbox` after `viewBox` dropped the
//   valid one, which can change how the SVG scales. Only an event's name (on
//   every element) and an attribute's on an HTML element fold their case;
//   React's aliases (`className`, `xlinkHref`, `xmlLang`) are one name on SVG
//   too.
// - An input's type and a select's multiple decide what its value can be
//   (`date` drops `abc`; one option or several): a change of either writes the
//   value and checked the field's props hold again, however it changed (an
//   accessor's next value, a new writer, the writer's removal).
// - `xmlLang` and `xml:lang` are written in the XML namespace, as React writes
//   them, and a spread source's getter is called on its own source.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const mod = await loadCompiled(`
  import { signal } from 'what-framework';
  export const phase = signal(0), type = signal('date'), multiple = signal(true), picked = signal(['a', 'b']);
  export const mode = signal(0), cls = signal('one');
  export const attrs = signal({ tabindex: 5, viewbox: 'a' });
  const modes = () => (mode() === 0 ? { type: 'date' } : {});
  const picks = () => (mode() === 0 ? { multiple: true } : {});
  const receiver = Object.assign(Object.create(null), { label: 'own' });
  Object.defineProperty(receiver, 'title', { enumerable: true, get() { phase(); return this.label; } });
  const getReceiver = () => (phase(), receiver);
  export const View = () => <div>
    <svg id="case" {...{ viewBox: '0 0 5 5' }} {...{ viewbox: 'ignored' + phase() }} />
    <svg id="alias" {...{ className: 'first' + phase() }} {...{ class: 'last' }} {...{ onClick: () => {} }} />
    <svg><g id="xml" {...{ 'xlink:href': '#early', xmlLang: 'en' + phase() }} {...{ xlinkHref: '#final' + phase(), 'xml:lang': 'de' }} /></svg>
    <svg><g id="xml-one" {...{ xmlLang: 'fr', xmlSpace: 'preserve' + phase() }} /></svg>
    <svg id="after-svg" {...attrs()} viewBox="0 0 1 1" />
    <i id="after-html" {...attrs()} tabIndex={1} />
    <input id="accessor-type" {...{ type, value: 'abc' }} />
    <input id="removed-type" {...modes()} {...{ value: 'abc' }} />
    <select id="accessor-multiple" {...{ multiple, value: picked() }}><option>a</option><option>b</option></select>
    <select id="removed-multiple" {...picks()} {...{ value: picked() }}><option>a</option><option>b</option></select>
    <div id="receiver" {...getReceiver()} />
  </div>;
`);

// Verification 6: the field's kind changing, at its edges.
// - A file field takes no value but the empty one (any other throws): one
//   whose value goes away while it is a file field, and comes back once it is
//   a text field again, shows it, with nothing thrown, and a spread read again
//   is not left a file field (React: text, file, text with abc, nothing, abc).
// - An empty number field is not the number 0: a value of 0 shows once the
//   field becomes a number field (React writes 0 into an empty field).
// - `TYPE` is an HTML input's `type`, so its change writes the value again.
// - `xlink:Href` and `xml:Lang` are the attributes `xlinkHref` and `xmlLang`
//   write: one name, the last writer's, the earlier one's again once it goes.
const edge = await loadCompiled(`
  import { signal } from 'what-framework';
  export const step = signal(0);
  const kind = () => ['text', 'file', 'text'][step()];
  const held = () => (step() === 1 ? undefined : 'abc');
  export const View = () => <div>
    <input id="file-live" {...(() => ({ type: kind(), value: held(), multiple: true }))()} />
    <input id="file-stable" {...{ type: kind, value: held, multiple: true }} />
    <input id="file-kept" {...{ type: kind, value: 'abc' }} />
    <input id="zero-live" {...(() => ({ type: step() ? 'number' : 'date', value: 0 }))()} />
    <input id="zero-stable" {...{ type: () => (step() ? 'number' : 'date'), value: 0 }} />
    <input id="upper-live" {...(() => ({ TYPE: step() ? 'text' : 'date', value: 'abc' }))()} />
    <input id="upper-stable" {...{ TYPE: () => (step() ? 'text' : 'date'), value: 'abc' }} />
    <svg>
      <g id="xlink-case" {...{ xlinkHref: '#fixed' }} {...(() => (step() === 1 ? {} : { 'xlink:Href': '#later' }))()} />
      <g id="xml-case" {...{ xmlLang: 'fixed' }} {...(() => (step() === 1 ? {} : { 'xml:Lang': 'later' }))()} />
    </svg>
  </div>;
`);

async function withView(check) {
  const el = document.body.appendChild(document.createElement('div'));
  const unmount = mount(mod.View, el);
  flushSync();
  try {
    await check((s) => el.querySelector(s));
  } finally {
    unmount();
    el.remove();
    mod.phase(0);
    mod.type('date');
    mod.multiple(true);
    mod.mode(0);
    mod.attrs({ tabindex: 5, viewbox: 'a' });
    flushSync();
  }
}

const selected = (el) => [...el.options].filter((o) => o.selected).map((o) => o.value).join();

test('an SVG spread keeps viewBox beside a lowercase viewbox: its names keep their case', () => withView((q) => {
  const svg = q('#case');
  assert.equal(svg.getAttribute('viewBox'), '0 0 5 5', 'mount');
  assert.equal(svg.getAttribute('viewbox'), 'ignored0', 'mount');
  mod.phase(1);
  flushSync();
  assert.equal(svg.getAttribute('viewBox'), '0 0 5 5', 'after an update');
  assert.equal(svg.getAttribute('viewbox'), 'ignored1', 'after an update');
}));

test("React's aliases are one name on SVG too: className and class, xlinkHref and xlink:href", () => withView((q) => {
  assert.equal(q('#alias').getAttribute('class'), 'last');
  assert.equal(q('#xml').getAttributeNS(XLINK_NS, 'href'), '#final0');
  mod.phase(1);
  flushSync();
  assert.equal(q('#alias').getAttribute('class'), 'last', 'the later class keeps winning');
  assert.equal(q('#alias').getAttribute('classname'), null);
  assert.equal(q('#xml').getAttributeNS(XLINK_NS, 'href'), '#final1');
}));

test('xmlLang and xml:lang are one name, written in the XML namespace', () => withView((q) => {
  const g = q('#xml');
  assert.equal(g.getAttributeNS(XML_NS, 'lang'), 'de');
  assert.equal(g.getAttribute('xml:lang'), 'de');
  assert.deepEqual([...g.attributes].map((a) => a.name).sort(), ['id', 'xlink:href', 'xml:lang'], 'one href, one lang');
  assert.equal(q('#xml-one').getAttributeNS(XML_NS, 'lang'), 'fr');
  assert.equal(q('#xml-one').getAttributeNS(XML_NS, 'space'), 'preserve0');
  mod.phase(1);
  flushSync();
  assert.equal(g.getAttributeNS(XML_NS, 'lang'), 'de');
  assert.equal(q('#xml-one').getAttributeNS(XML_NS, 'space'), 'preserve1');
}));

test('an attribute after a spread read again keeps winning, compared as the element reads names', () => withView((q) => {
  const check = (when) => {
    assert.equal(q('#after-html').getAttribute('tabindex'), '1', `HTML tabIndex after the spread, ${when}`);
    assert.equal(q('#after-svg').getAttribute('viewBox'), '0 0 1 1', `SVG viewBox after the spread, ${when}`);
  };
  check('mount');
  assert.equal(q('#after-svg').getAttribute('viewbox'), 'a', 'SVG viewbox is its own name');
  mod.attrs({ tabindex: 6, tabIndex: 7, viewBox: 'b', viewbox: 'c' });
  flushSync();
  check('after the spread changed');
  assert.equal(q('#after-svg').getAttribute('viewbox'), 'c');
}));

test('an input whose type an accessor of a spread changes shows its value again', () => withView((q) => {
  const input = q('#accessor-type');
  assert.equal(input.type, 'date');
  assert.equal(input.value, '', 'date drops abc');
  mod.type('text');
  flushSync();
  assert.equal(input.type, 'text');
  assert.equal(input.value, 'abc');
  mod.type('date');
  flushSync();
  mod.type('text');
  flushSync();
  assert.equal(input.value, 'abc', 'and again');
}));

test("an input whose spread's type writer goes away shows its value again", () => withView((q) => {
  const input = q('#removed-type');
  assert.equal(input.type, 'date');
  mod.mode(1);
  flushSync();
  assert.equal(input.getAttribute('type'), null);
  assert.equal(input.value, 'abc');
}));

test('a select whose multiple an accessor of a spread toggles selects its value again', () => withView((q) => {
  const select = q('#accessor-multiple');
  assert.equal(selected(select), 'a,b');
  mod.multiple(false);
  flushSync();
  assert.equal(select.multiple, false);
  mod.multiple(true);
  flushSync();
  assert.equal(select.multiple, true);
  assert.equal(selected(select), 'a,b', 'after multiple went off and on');
}));

test("a select whose spread's multiple writer goes away and comes back selects its value again", () => withView((q) => {
  const select = q('#removed-multiple');
  assert.equal(selected(select), 'a,b');
  mod.mode(1);
  flushSync();
  assert.equal(select.multiple, false);
  mod.mode(0);
  flushSync();
  assert.equal(select.multiple, true);
  assert.equal(selected(select), 'a,b');
}));

test("a spread source's getter is called on its own source (`this.label`)", () => withView((q) => {
  assert.equal(q('#receiver').title, 'own');
  mod.phase(1);
  flushSync();
  assert.equal(q('#receiver').title, 'own', 'after the getter ran again');
}));

// Each step's [type, value] of the fields `ids`, and what the steps reported
// to console.error (an effect that threw).
async function steps(ids, read = (el) => [el.type, el.value]) {
  const el = document.body.appendChild(document.createElement('div'));
  const errors = [];
  const error = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  const unmount = mount(edge.View, el);
  try {
    flushSync();
    const frames = [];
    for (const step of [0, 1, 2]) {
      edge.step(step);
      flushSync();
      frames.push(ids.map((id) => read(el.querySelector(id))));
    }
    return { frames, errors };
  } finally {
    console.error = error;
    unmount();
    el.remove();
    edge.step(0);
    flushSync();
  }
}

test('a field that is a file field for a while shows its value again after it, with nothing thrown', async () => {
  const { frames, errors } = await steps(['#file-live', '#file-stable']);
  assert.deepEqual(errors, []);
  for (const [i, id] of ['#file-live', '#file-stable'].entries()) {
    assert.deepEqual(frames.map((f) => f[i]), [['text', 'abc'], ['file', ''], ['text', 'abc']], id);
  }
});

test('a file field is never written the value it holds; it shows it once it is a text field again', async () => {
  const { frames, errors } = await steps(['#file-kept']);
  assert.deepEqual(errors, []);
  assert.deepEqual(frames.map((f) => f[0]), [['text', 'abc'], ['file', ''], ['text', 'abc']]);
});

test('a value of 0 shows once the field becomes a number field: an empty field is not 0', async () => {
  const { frames, errors } = await steps(['#zero-live', '#zero-stable']);
  assert.deepEqual(errors, []);
  for (const [i, id] of ['#zero-live', '#zero-stable'].entries()) {
    assert.deepEqual(frames.map((f) => f[i]), [['date', ''], ['number', '0'], ['number', '0']], id);
  }
});

test("an HTML input's TYPE is its type: its change shows the value again", async () => {
  const { frames } = await steps(['#upper-live', '#upper-stable']);
  for (const [i, id] of ['#upper-live', '#upper-stable'].entries()) {
    assert.deepEqual(frames.map((f) => f[i]), [['date', ''], ['text', 'abc'], ['text', 'abc']], id);
  }
});

test('xlink:Href and xml:Lang are the names xlinkHref and xmlLang write: the earlier writer shows once the later goes', async () => {
  const { frames } = await steps(['#xlink-case', '#xml-case'], (el) => [
    el.getAttributeNS(XLINK_NS, 'href') ?? el.getAttributeNS(XML_NS, 'lang'),
    [...el.attributes].map((a) => a.name).filter((n) => n !== 'id').join(),
  ]);
  assert.deepEqual(frames.map((f) => f[0]), [['#later', 'xlink:href'], ['#fixed', 'xlink:href'], ['#later', 'xlink:href']], 'xlink');
  assert.deepEqual(frames.map((f) => f[1]), [['later', 'xml:lang'], ['fixed', 'xml:lang'], ['later', 'xml:lang']], 'xml');
});
