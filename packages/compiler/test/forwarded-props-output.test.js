// What what-compiler emits for props forwarded the way React code forwards
// them (their behaviour: what-core test/forwarded-props-react-habits.test.js),
// and that a component that does none of it pays nothing for it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const flat = (code) => code.replace(/\s+/g, ' ');
const quiet = (source, options) => {
  const warn = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    return { code: flat(compileJSX(source, options)), seen };
  } finally {
    console.warn = warn;
  }
};

describe('an attribute written after a spread', () => {
  it('is skipped by the spread, its alias too', () => {
    const { code } = quiet(`export const A = ({ v, ...rest }) => <a {...rest} href="/x" class="c" onClick={go} />;`);
    assert.match(code, /_\$spread\(_el\$0, rest, \["href", "class", "className", "onClick"\]\)/);
  });

  it('an element whose attributes all come before the spread passes no list', () => {
    const { code } = quiet(`export const A = ({ v, ...rest }) => <a href="/x" {...rest} />;`);
    assert.match(code, /_\$spread\(_el\$0, rest\);/);
  });

  it('a spread followed by another spread lists the attributes after it only', () => {
    const { code } = quiet(`export const A = ({ a, b }) => <a {...a} id="i" {...b} title="t" />;`);
    assert.match(code, /_\$spread\(_el\$0, _props\.a, \["id", "title"\]\)/);
    assert.match(code, /_\$spread\(_el\$0, _props\.b, \["title"\]\)/);
  });
});

describe('children written as a prop', () => {
  it('are a live prop when they read state', () => {
    const { code } = quiet(`export const A = () => <Box children={label()} />;`);
    assert.match(code, /get children\(\) \{ return label\(\); \}/);
  });

  it('JSX children still decide when both are written', () => {
    const { code } = quiet(`export const A = () => <Box children={label()}>own</Box>;`);
    assert.match(code, /\["own"\]/);
  });
});

describe('an object literal that spreads the props', () => {
  it('is their merge, read like the props, when it is only spread and read by key', () => {
    const { code } = quiet(`export const A = ({ v, ...rest }) => { const merged = { ...rest, className: 'fixed' }; return <a {...merged} title={merged.title} />; };`);
    assert.match(code, /const merged = _\$merge\(rest, \{ className: 'fixed' \}\);/);
    assert.match(code, /_\$effect\(\(\) => _\$setProp\(_el\$0, "title", merged\.title\)\)/);
    assert.match(code, /_\$insert\(_el\$0, _\$place\(merged, "children"\)\)/);
  });

  it('spread straight onto JSX', () => {
    const { code } = quiet(`export const A = (props) => <a {...{ ...props, rel: 'x' }} />;`);
    assert.match(code, /_\$spread\(_el\$0, _\$merge\(props, \{ rel: 'x' \}\)\)/);
  });

  it('stays object spread where the object is handed on, written or has a method', () => {
    for (const body of [
      `const m = { ...props }; use(m); return <a {...m} />;`,
      `const m = { ...props }; m.x = 1; return <a {...m} />;`,
      `const m = { ...props, get x() { return 1; } }; return <a {...m} />;`,
      `let m = { ...props }; return <a {...m} />;`,
    ]) {
      const { code } = quiet(`export function A(props) { ${body} }`);
      assert.doesNotMatch(code, /_\$merge/, body);
    }
  });

  it('is not touched on the server', () => {
    const { code } = quiet(`export const A = ({ v, ...rest }) => { const merged = { ...rest, id: 'x' }; return <a {...merged} />; };`, { pluginOptions: { generate: 'ssr' } });
    assert.doesNotMatch(code, /_\$merge\(rest/);
  });
});

describe('a function handed to a component in a prop', () => {
  it('returns the prop it reads, not a placing read of it', () => {
    const { code } = quiet(`export const A = (props) => <Child read={() => props.project} />; export const B = ({ project }) => <Child read={() => project} />;`);
    assert.match(code, /read: \(\) => props\.project/);
    assert.match(code, /read: \(\) => _props\.project/);
    assert.doesNotMatch(code, /_\$place/);
  });

  it('a function written as a child still places what it returns', () => {
    const { code } = quiet(`export const A = (props) => <div>{() => props.children}</div>;`);
    assert.match(code, /_\$place\(props, "children"\)/);
  });
});

describe('a keyed row hands a render callback its raw item', () => {
  it('for a callback, a branch and a nested list\'s cell: the item read through the row, no view', () => {
    const { code } = quiet(`export const T = () => <div>{rows().map((item) => <div key={item.id}>{renderCell(item)}{item.on ? a(item) : null}<b>{cols.map((c) => <i key={c.key}>{c.render(item)}</i>)}</b></div>)}</div>;`);
    assert.doesNotMatch(code, /live/);
    assert.match(code, /renderCell\(_\$item\(_item\$0\)\)/);
    assert.match(code, /a\(_\$item\(_item\$0\)\)/);
    assert.match(code, /\.render\(_\$item\(_item\$0\)\)/);
  });

  it('a live() view written by hand reads the row\'s item', () => {
    const { code } = quiet(`import { live } from 'what-framework'; export const T = () => <div>{rows().map((item) => <div key={item.id}>{renderCell(live(() => item))}</div>)}</div>;`);
    assert.match(code, /renderCell\(live\(\(\) => _\$item\(_item\$0\)\)\)/);
  });
});

describe('a key that reads the index', () => {
  it('is a key function of the item and the index, with no warning', () => {
    const { code, seen } = quiet(`export const T = () => <ul>{terms().map((t, i) => <li key={\`\${t.term}-\${i}\`}>{t.term}</li>)}</ul>;`);
    assert.match(code, /key: \(t, i\) => `\$\{t\.term\}-\$\{i\}`, follow: true/);
    assert.deepEqual(seen, []);
  });

  it('the server\'s key function counts the index when it is not handed one', () => {
    const { code } = quiet(`export const T = () => <ul>{terms().map((t, i) => <li key={t.term + i}>{t.term}</li>)}</ul>;`, { pluginOptions: { generate: 'ssr' } });
    assert.match(code, /\(_n\$0 => \(t, i = _n\$0\+\+\) => t\.term \+ i\)\(0\)/);
  });

  it('a key from a name the callback declares still falls back, with a warning', () => {
    const { code, seen } = quiet(`export const T = () => <ul>{terms().map((t) => { const k = t.term; return <li key={k}>{t.term}</li>; })}</ul>;`);
    assert.doesNotMatch(code, /_\$mapArray/);
    assert.match(seen.join('\n'), /reads `k`/);
  });
});

describe('component shapes that used to read their props once', () => {
  const H = `import { h, memo } from 'what-framework';\n`;
  it('a component with h() a factory returns, a hook with h() and a class\'s render() read them where they are used', () => {
    const { code } = quiet(`${H}const Make = () => ({ value }) => h('i', {}, () => value);
      function useLook({ value }) { return h('i', {}, () => value); }
      class Cls { render() { const { value, other: o = 1 } = this.props; return <i title={o}>{value}</i>; } }`);
    assert.match(code, /const Make = \(\) => _props => h\('i', \{\}, \(\) => _props\.value\)/);
    assert.match(code, /function useLook\(_props2\) \{ return h\('i', \{\}, \(\) => _props2\.value\); \}/);
    assert.match(code, /const \{ other: o = 1 \} = this\.props;/, 'a name with a default keeps its destructuring');
    assert.match(code, /_\$insert\(_el\$0, \(\) => this\.props\.value\)/);
  });

  it('a lower-case helper that calls h() is still not a component', () => {
    const { code } = quiet(`${H}export function icon({ name, ...rest }) { return h('svg', rest, name); }`);
    assert.doesNotMatch(code, /_\$omit|_props/);
  });

  const reports = (source) => quiet(source, { filename: `read-once-${Math.random()}.jsx` }).seen.filter((w) => w.includes('ERR_PROP_READ_ONCE'));
  for (const [shape, source, name] of [
    ['a returned ternary', `export function C({ on }) { return on ? <a /> : <b />; }`, 'on'],
    ['an early return', `export function C(props) { if (!props.open) return null; return <a />; }`, 'props.open'],
    ['a returned logical', `export const C = ({ on }) => on && <a />;`, 'on'],
    ['h() returned conditionally', `${H}export function C({ value }) { return value ? h('i', {}, () => value) : null; }`, 'value'],
  ]) {
    it(`reports ${shape} that reads a prop: it decides once what the component returns`, () => {
      const found = reports(source);
      assert.equal(found.length, 1, found.join('\n'));
      assert.ok(found[0].includes(`\`${name}\``) && found[0].includes('<C>') && found[0].includes('decides what the component returns'), found[0]);
    });
  }

  it('reports a component that hands its props to a JSX helper as a value', () => {
    const found = reports(`const mk = ({ value }) => <i>{value}</i>; export function Helper({ value }) { return mk({ value }); }`);
    assert.equal(found.length, 1);
    assert.match(found[0], /`value`.*<Helper>.*handed to `mk\(\)` as a value.*`mk\(props\)`/);
  });

  it('reports nothing for a branch inside a binding, a row, a nested function or a helper', () => {
    for (const source of [
      `export function C({ on }) { return <p>{on ? 'a' : 'b'}</p>; }`,
      `export function C({ items }) { return <ul>{items.map((i) => { if (!i) return null; return <li key={i}>{i}</li>; })}</ul>; }`,
      `export function C({ on }) { const f = () => { if (on) return 1; }; return <a>{f()}</a>; }`,
      `export function C({ on }) { if (ready()) return null; return <a>{on}</a>; }`,
      `export const pick = ({ on }) => (on ? 1 : 2);`,
    ]) assert.deepEqual(reports(source), [], source);
  });
});
