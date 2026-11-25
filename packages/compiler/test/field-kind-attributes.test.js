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

// Verification 6: a file field takes no value but the empty one, an empty
// number field is not the number 0, and an HTML input's `TYPE` is its type.
const edgeSource = `
  import { signal } from 'what-framework';
  export const step = signal(0), count = signal(0);
  export const View = () => <div>
    <input id="file" type={['text', 'file', 'text'][step()]} multiple value={step() === 1 ? undefined : 'abc'} />
    <input id="file-kept" type={['text', 'file', 'text'][step()]} value="abc" />
    <input id="zero" type={step() ? 'number' : 'date'} value={0} />
    <input id="upper" TYPE={step() ? 'text' : 'date'} value="abc" />
    <input id="count" type="number" value={count()} />
  </div>;
`;
const edge = await loadCompiled(edgeSource);

test('an input type and a select multiple are written through _$retype; xmlLang installs its writer', () => {
  const out = compileJSX(source);
  assert.match(out, /_\$retype\(_el\$\d+, "multiple", multiple\(\)\)/);
  assert.match(out, /_\$retype\(_el\$\d+, "type", type\(\)\)/);
  assert.match(out, /_\$xlink\(\);/);
  // Another element's type is a plain prop.
  assert.doesNotMatch(compileJSX('const A = () => <button type={t()} />;'), /_\$retype/);
  assert.doesNotMatch(compileJSX('const A = () => <input multiple={m()} />;'), /_\$retype/);
  // An HTML element's attribute names fold their case.
  assert.match(compileJSX(edgeSource), /_\$retype\(_el\$\d+, "TYPE", /);
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

// Each step's [type, value] of the fields `ids`, and what the steps reported
// to console.error (an effect that threw).
function steps(ids) {
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
      frames.push(ids.map((id) => [el.querySelector(id).type, el.querySelector(id).value]));
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

test('an input that is a file field for a while is written no value then, and shows its value after it', () => {
  const { frames, errors } = steps(['#file', '#file-kept']);
  assert.deepEqual(errors, []);
  for (const [i, id] of ['#file', '#file-kept'].entries()) {
    assert.deepEqual(frames.map((f) => f[i]), [['text', 'abc'], ['file', ''], ['text', 'abc']], id);
  }
});

test('value={0} shows once its type becomes number: an empty number field is not 0', () => {
  const { frames } = steps(['#zero']);
  assert.deepEqual(frames.map((f) => f[0]), [['date', ''], ['number', '0'], ['number', '0']]);
});

test("an input's TYPE attribute is its type: its change shows the value again", () => {
  const { frames } = steps(['#upper']);
  assert.deepEqual(frames.map((f) => f[0]), [['date', ''], ['text', 'abc'], ['text', 'abc']]);
});

test('a number field whose state is 0 shows 0 again after the user empties it, as React writes it', async () => {
  const el = document.body.appendChild(document.createElement('div'));
  const unmount = mount(edge.View, el);
  flushSync();
  try {
    const input = el.querySelector('#count');
    assert.equal(input.value, '0');
    input.value = '';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(input.value, '0');
  } finally {
    unmount();
    el.remove();
  }
});
