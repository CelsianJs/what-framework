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
