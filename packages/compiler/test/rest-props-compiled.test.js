// What what-compiler emits for rest props and polymorphic components, and
// what it reports where a destructured prop cannot follow the parent's state.
// What a user sees is compared with React in rest-props-react-parity.test.js;
// this file holds the output those pages rely on and its cost: a component
// that does not spread gets no effect and no getter for it.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const flat = (code) => code.replace(/\s+/g, ' ');

describe('a rest element of the props is read live', () => {
  it('in a pattern whose other names are a tag, it is the props without them (_$omit)', () => {
    const out = flat(compileJSX(`export const Box = ({ as: Tag, ...rest }) => <Tag {...rest} />;`));
    assert.match(out, /_props => \{ const \{ as: Tag \} = _props, rest = _\$omit\(_props, \["as"\]\);/);
    assert.match(out, /_\$createComponent\(Tag, _\$merge\(rest\), \[\]\)/);
  });

  it('a rest element alone, in the body, in a function declaration and with a ref parameter', () => {
    for (const source of [
      `export const Box = ({ ...rest }) => <a {...rest} />;`,
      `export function Box(props) { const { as: Tag, ...rest } = props; return <Tag {...rest} />; }`,
      `export function Box({ as: Tag, ...rest }) { return <Tag {...rest} />; }`,
      `export const Box = ({ as: Tag = 'a', ...rest }, ref) => <Tag ref={ref} {...rest} />;`,
    ]) {
      const out = flat(compileJSX(source));
      assert.match(out, /rest = _\$omit\(/, source);
      assert.doesNotMatch(out, /\.\.\.rest \}/, source);
    }
  });

  it('a rest element destructured again, and read by key, reads the props', () => {
    const again = flat(compileJSX(`export const Box = ({ as: Tag, ...rest }) => { const { href, ...more } = rest; return <a href={href} {...more} />; };`));
    assert.match(again, /more = _\$omit\(rest, \["href"\]\)/);
    // An attribute before a spread is a property of their merge, the spread's
    // own value winning where it has one, as in React (dom.js mergesSpreads).
    assert.match(again, /_\$spread\(_el\$\d+, _\$merge\(\{ __proto__: null, get href\(\) \{ return rest\.href; \} \}, more\)\)/);
    const byKey = flat(compileJSX(`export function Box(props) { const { as: Tag, ...rest } = props; return <a href={rest.href}>{rest.children}</a>; }`));
    assert.match(byKey, /_\$effect\(\(\) => _\$setProp\(_el\$\d+, "href", rest\.href\)\)/);
    assert.match(byKey, /_\$insert\(_el\$\d+, _\$place\(rest, "children"\)\)/);
  });

  it('a nested pattern is read where it is used', () => {
    const out = flat(compileJSX(`export const Box = ({ style: { color } = {}, ...rest }) => <a data-color={color} {...rest} />;`));
    assert.match(out, /_props\.style\?\.color/);
    assert.match(out, /rest = _\$omit\(_props, \["style"\]\)/);
  });

  it('a default that reads nothing of the component is made once, and the prop read where it is used', () => {
    const out = flat(compileJSX(`const SIZES = { md: 'm' }; export const List = ({ items = [], size = SIZES.md, onPick = () => {} }) => <ul data-size={size} onClick={onPick}>{items.length}</ul>;`));
    assert.match(out, /const _itemsDefault = \[\], _sizeDefault = SIZES\.md, _onPickDefault = \(\) => \{\};/);
    assert.match(out, /\(_size = _props\.size\) === void 0 \? _sizeDefault : _size/);
  });
});

describe('a spread\'s children are the element\'s', () => {
  it('a childless element with a spread places the spread\'s children, with no effect of its own', () => {
    const out = flat(compileJSX(`export const A = (props) => <a {...props} />; export const B = ({ v, ...rest }) => <a {...rest} />;`));
    assert.match(out, /_\$spread\(_el\$0, props\); _\$insert\(_el\$0, _\$place\(props, "children"\)\);/);
    assert.match(out, /_\$spread\(_el\$1, rest\); _\$insert\(_el\$1, _\$place\(rest, "children"\)\);/);
  });

  it('several spreads: their merge; none for an element with children, a void element or a <textarea>', () => {
    assert.match(flat(compileJSX(`export const A = (p) => <a {...p.x} {...p.y} />;`)), /_\$place\(_\$merge\(p\.x, p\.y\), "children"\)/);
    for (const source of [`export const A = (p) => <a {...p}>own</a>;`, `export const A = (p) => <input {...p} />;`,
      `export const A = (p) => <textarea {...p} />;`, `export const A = (p) => <a {...p.get()} />;`]) {
      assert.doesNotMatch(compileJSX(source), /"children"/, source);
    }
  });

  it('the server writes them, for an element and for a tag held in a binding', () => {
    const ssr = { pluginOptions: { generate: 'ssr' } };
    assert.match(flat(compileJSX(`export const A = (props) => <a {...props} />;`, ssr)), /_\$ssrText\(props\.children\)/);
    assert.match(flat(compileJSX(`export const A = ({ as: Tag, ...rest }) => <Tag {...rest} />;`, ssr)), /_\$ssrComponent\(Tag, \{ \.\.\.rest \}, \[rest\.children\]/);
  });

  it('a component that does not spread is compiled as before', () => {
    const out = flat(compileJSX(`export const A = ({ label }) => <b>{label}</b>;`));
    assert.doesNotMatch(out, /_\$omit|_\$spread|_\$merge/);
  });
});

describe('a component call in SVG or MathML tells the tags held in bindings below it (_$inNs)', () => {
  const Shape = `const Shape = ({ as: Tag, ...rest }) => <Tag {...rest} />;`;
  it('in <svg>, <math> and back in HTML inside them', () => {
    const out = flat(compileJSX(`${Shape} export const A = () => <div><svg><Shape as="circle" /><foreignObject><Shape as="a" /></foreignObject></svg><math><Shape as="mi" /></math><Shape as="b" /></div>;`));
    assert.match(out, /_\$inNs\(1, \(\) => _\$createComponent\(Shape/);
    assert.match(out, /_\$inNs\(0, \(\) => _\$createComponent\(Shape/);
    assert.match(out, /_\$inNs\(2, \(\) => _\$createComponent\(Shape/);
    assert.equal(out.match(/_\$inNs\(/g).length, 4 - 1 + 1 - 1, 'not for the call in plain HTML');
  });

  it('not for a component the module defines whose JSX names no tag held in a binding', () => {
    const out = flat(compileJSX(`const Dot = (p) => <circle r={p.r} />; export const A = () => <svg><Dot r={2} /></svg>;`));
    assert.doesNotMatch(out, /_\$inNs/);
  });
});

describe('a destructured .map() row reads its item where it is used', () => {
  it('as a row whose parameter is a name', () => {
    const out = flat(compileJSX(`import { signal } from 'what-framework'; export const items = signal([]);
      export const A = () => <ul>{items().map(({ id, label }) => <li key={id}>{label}</li>)}</ul>;`, { production: true }));
    assert.match(out, /\(_item\$0, _i\$0, _row\$0\) => \{ const _el\$1 = _tmpl\$1\(\); _\$field\(_el\$1, _item\$0, _row\$0\.label/);
    assert.match(out, /key: _row\$0 => _row\$0\.id, follow: true/);
  });

  it('a rest element of the item, once, where the row is built', () => {
    const out = flat(compileJSX(`import { signal } from 'what-framework'; export const items = signal([]);
      export const A = () => <ul>{items().map(({ id, ...rest }) => <li key={id} {...rest} />)}</ul>;`, { production: true }));
    assert.match(out, /const rest = _\$omit\(_\$item\(_item\$0\), \["id"\]\);/);
  });

  it('keeps its destructuring when the row binds a name again', () => {
    const out = flat(compileJSX(`import { signal } from 'what-framework'; export const items = signal([]);
      export const A = () => <ul>{items().map(({ id, label }) => { const f = (label) => label; return <li key={id}>{f(label)}</li>; })}</ul>;`, { production: true }));
    assert.match(out, /\(\{ id, label \}\) =>/);
  });
});

describe('ERR_PROP_READ_ONCE: a destructured prop the compiler cannot read where it is used', () => {
  const warnings = [];
  const original = console.warn;
  const capture = (source, options) => {
    warnings.length = 0;
    console.warn = (message) => warnings.push(String(message));
    try {
      compileJSX(source, { filename: `read-once-${Math.random()}.jsx`, ...options });
    } finally {
      console.warn = original;
    }
    return warnings.filter((w) => w.includes('ERR_PROP_READ_ONCE'));
  };
  afterEach(() => { console.warn = original; });

  for (const [shape, source, name, why] of [
    ['an assigned prop', `export function Button({ size, ...rest }) { size = size ?? 'md'; return <a data-size={size} {...rest} />; }`, 'size', 'it is assigned again'],
    ['a default that reads another prop', `export const Button = ({ size, label = size + '!' }) => <a>{label}</a>;`, 'label', 'its default reads a name of the component'],
    ['a computed key and a rest', `const k = 'x'; export const Button = ({ [k]: v, ...rest }) => <a data-v={v} {...rest} />;`, '...rest', 'the pattern has a computed key'],
    ['a var pattern', `export function Button(props) { var { href } = props; return <a href={href} />; }`, '{ href }', 'declared with `var`'],
  ]) {
    it(`reports ${shape}, with the component, the place and the fix`, () => {
      // One report per name read once (a computed key is one, the rest beside it another).
      const found = capture(source).filter((w) => w.includes(`\`${name}\``));
      assert.equal(found.length, 1, warnings.join('\n'));
      assert.match(found[0], /^\[what-compiler\] ERR_PROP_READ_ONCE: /);
      assert.ok(found[0].includes(`\`${name}\``), found[0]);
      assert.ok(found[0].includes('<Button>'), found[0]);
      assert.ok(found[0].includes(why), found[0]);
      assert.match(found[0], /\.jsx:\d+:\d+/);
      assert.match(found[0], /Fix: .+what_fix\(\{ error: 'ERR_PROP_READ_ONCE' \}\)/);
    });
  }

  it('reports nothing for the shapes it reads live, for a helper that is not a component, and in production', () => {
    assert.deepEqual(capture(`export const Box = ({ as: Tag = 'a', size = 'md', items = [], style: { color } = {}, ...rest }) => <Tag data-size={size} data-c={color} {...rest}>{items.length}</Tag>;`), []);
    assert.deepEqual(capture(`export const row = ({ size }) => { size = size || 1; return <i>{size}</i>; };`), []);
    const saved = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.deepEqual(capture(`export function Button({ size }) { size = size ?? 'md'; return <a>{size}</a>; }`), []);
    } finally {
      process.env.NODE_ENV = saved;
    }
  });
});
