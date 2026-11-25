// A field's kind written as an attribute: an <input>'s `type` and a
// <select>'s `multiple` decide what its value can be (`date` drops `abc`,
// `text` keeps it; one option or several). Compiled JSX writes them through
// what-core's _$retype, which writes the field's value and checked again when
// one changes, as React writes them after its type. `<select multiple={m()}
// value={v()}>` kept one option after multiple went off and on, and
// `<input type={t()} value="abc">` stayed empty once `date` gave way to
// `text`, in either attribute order. An SVG element's XML attributes
// (`xmlLang`) bring the writer of their namespace, as XLink's do.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const source = `
  import { signal } from 'what-framework';
  export const multiple = signal(true), picked = signal(['a', 'b']), type = signal('date'), lang = signal('en');
  export const View = () => <div>
    <select id="mv" multiple={multiple()} value={picked()}><option>a</option><option>b</option></select>
    <select id="vm" value={picked()} multiple={multiple()}><option>a</option><option>b</option></select>
    <input id="tv" type={type()} value="abc" />
    <input id="vt" value="abc" type={type()} />
    <input id="bound" type={type()} value={'ab' + 'c'} />
    <input id="accessor" type={type} value="abc" />
    <svg><g id="lang" xmlLang={lang()} /></svg>
  </div>;
`;

const mod = await loadCompiled(source);

test('an input type and a select multiple are written through _$retype; xmlLang installs its writer', () => {
  const out = compileJSX(source);
  assert.match(out, /_\$retype\(_el\$\d+, "multiple", multiple\(\)\)/);
  assert.match(out, /_\$retype\(_el\$\d+, "type", type\(\)\)/);
  assert.match(out, /_\$xlink\(\);/);
  // Another element's type is a plain prop.
  assert.doesNotMatch(compileJSX('const A = () => <button type={t()} />;'), /_\$retype/);
  assert.doesNotMatch(compileJSX('const A = () => <input multiple={m()} />;'), /_\$retype/);
});

async function withView(check) {
  const el = document.body.appendChild(document.createElement('div'));
  const unmount = mount(mod.View, el);
  flushSync();
  try {
    await check((s) => el.querySelector(s));
  } finally {
    unmount();
    el.remove();
    mod.multiple(true);
    mod.type('date');
    flushSync();
  }
}

const selected = (el) => [...el.options].filter((o) => o.selected).map((o) => o.value).join();

test('a select whose multiple attribute goes off and on selects its value again, in either order', () => withView((q) => {
  for (const id of ['#mv', '#vm']) assert.equal(selected(q(id)), 'a,b', `${id} at mount`);
  mod.multiple(false);
  flushSync();
  for (const id of ['#mv', '#vm']) assert.equal(q(id).multiple, false, id);
  mod.multiple(true);
  flushSync();
  for (const id of ['#mv', '#vm']) assert.equal(selected(q(id)), 'a,b', `${id} after multiple went off and on`);
}));

test('an input whose type attribute changes shows its value again, in either order', () => withView((q) => {
  const ids = ['#tv', '#vt', '#bound', '#accessor'];
  for (const id of ids) assert.equal(q(id).value, '', `${id}: date drops abc`);
  mod.type('text');
  flushSync();
  for (const id of ids) assert.equal(q(id).value, 'abc', `${id} once text`);
  mod.type('date');
  flushSync();
  mod.type('text');
  flushSync();
  for (const id of ids) assert.equal(q(id).value, 'abc', `${id} again`);
}));

test('a type written again with the same value leaves an edit alone', () => withView((q) => {
  mod.type('text');
  flushSync();
  const input = q('#tv');
  input.value = 'edited';
  mod.type('TEXT');
  flushSync();
  assert.equal(input.value, 'edited');
}));

test('an SVG xmlLang attribute is written in the XML namespace', () => withView((q) => {
  const g = q('#lang');
  assert.equal(g.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang'), 'en');
  mod.lang('de');
  flushSync();
  assert.equal(g.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang'), 'de');
}));
