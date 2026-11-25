// A compiled module imports the smallest runtime helper that does what its
// JSX needs, under the local name the emitted calls use, so an app pays for
// the general helper only where a module needs it (dom.js renderExport):
//
//   _$createComponent   `_$createLeaf` when no component call of the module
//                       hands over children or JSX in a prop: nothing is
//                       built lazily, so the lazy getters are not reached.
//                       `_$createFn` and `_$createLazyFn` (and `_$hcreateFn`
//                       for hydratable output) when every component of the
//                       module is a plain function: no class component bridge
//                       and no tag held in a binding (render.js asComponent).
//   a tag in a constant `const Tag = 'select'; <Tag />` is the element itself.
//   _$insert            `_$reactive` when every insert of the module is of a
//                       function written in the hole itself, which insert()
//                       could only hand to its reactive region.
//   _$spread, _$setProp, _$setValue
//                       always the compiled forms, which do not bring the
//                       select code the hand-written spread(), setProp() and
//                       setValue() install for a select; `_$selects()`, once
//                       at module scope, installs it in a module whose JSX
//                       writes a prop of a <select> or an <option>.
//
// The choice is per module, as `_$mapKeyed` against `mapArray` is, and the
// calls themselves are emitted as before. The runtime side is in what-core
// (test/feature-install-production.test.js runs each choice in a production
// bundle, test/feature-reach.test.js checks what each one leaves out).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

const compile = (source, pluginOptions = {}) => compileJSX(source, { production: true, pluginOptions });
// The specifiers of the what-framework/render import: { local: imported }.
function renderImports(code) {
  const match = /import \{([^}]*)\} from "what-framework\/render";/.exec(code);
  assert.ok(match, `no what-framework/render import in:\n${code}`);
  return Object.fromEntries(match[1].split(',').map((spec) => spec.trim()).filter(Boolean).map((spec) => {
    const [imported, local = imported] = spec.split(' as ');
    return [local.trim(), imported.trim()];
  }));
}
const component = (source, options) => renderImports(compile(source, options))._$createComponent;
const insert = (source, options) => renderImports(compile(source, options))._$insert;

describe('the component call a module imports', () => {
  for (const [what, source] of [
    ['a component with no props', 'const A = () => <Leaf />;'],
    ['plain and live props', 'const A = () => <Leaf a="1" b={other} c={count()} onClick={go} />;'],
    ['spread props', 'const A = (p) => <Leaf {...p} extra={1} />;'],
    ['a component in an element', 'const A = () => <div><Leaf /><Other n={1} /></div>;'],
    ['a member component', 'const A = () => <Ctx.Provider value={1} />;'],
    ['an island with no children', 'const A = () => <Counter client:idle start={1} />;'],
    ['only whitespace between the tags', 'const A = () => <Leaf>\n   </Leaf>;'],
  ]) {
    it(`is a leaf call for ${what}`, () => {
      const code = compile(source);
      // _$createFn when the module's components are plain functions (below).
      assert.ok(['_$createLeaf', '_$createFn'].includes(component(source)), component(source));
      assert.ok(!Object.values(renderImports(code)).includes('_$createComponent'), 'the general call is not imported beside it');
      assert.match(code, /_\$createComponent\(/, 'the calls keep their name');
    });
  }

  for (const [what, source] of [
    ['an element child', 'const A = () => <Box><p>x</p></Box>;'],
    ['a text child', 'const A = () => <Box>hello</Box>;'],
    ['an expression child', 'const A = (p) => <Box>{p.label}</Box>;'],
    ['a component child', 'const A = () => <Box><Leaf /></Box>;'],
    ['a fragment child', 'const A = () => <Box><><i /></></Box>;'],
    ['JSX in a prop', 'const A = () => <Box header={<i />} />;'],
    ['a forwarded children prop', 'const A = (props) => <Box>{props.children}</Box>;'],
    ['a prop handed on to a component', 'const A = (props) => <Box fallback={props.fallback} />;'],
    ['one such call among leaf calls', 'const A = () => <div><Leaf /><Box><p>x</p></Box><Leaf /></div>;'],
  ]) {
    it(`is the general call for ${what}`, () => {
      assert.equal(component(source), '_$createComponent');
      assert.doesNotMatch(compile(source), /_\$createLeaf/);
    });
  }

  it('is decided by the whole module, whichever call comes first', () => {
    const general = 'const B = () => <Box><p>x</p></Box>;';
    const leaf = 'const A = () => <Leaf />;';
    assert.equal(component(`${leaf}\n${general}`), '_$createComponent');
    assert.equal(component(`${general}\n${leaf}`), '_$createComponent');
  });

  it('a hydratable module imports the hydrating call either way', () => {
    assert.equal(component('const A = () => <Leaf />;', { hydratable: true }), '_$hcreateComponent');
    assert.equal(component('const A = () => <Box><p>x</p></Box>;', { hydratable: true }), '_$hcreateComponent');
    // And the one for plain functions when every component is one.
    assert.equal(component('const Leaf = () => <i />; export const A = () => <Leaf />;', { hydratable: true }), '_$hcreateFn');
    assert.equal(component('const Box = (p) => <b>{p.children}</b>; export const A = () => <Box><p>x</p></Box>;', { hydratable: true }), '_$hcreateFn');
  });

  it('passes the leaf call the arguments the general one takes', () => {
    const code = compile('const A = () => <Leaf n={1} />;');
    assert.equal(renderImports(code)._$createComponent, '_$createLeaf');
    // (Component, props, children): the empty children array stays, so the
    // development location after it is where both calls read it.
    assert.match(code, /_\$createComponent\(Leaf, \{\s*n: 1\s*\}, \[\]\)/);
  });
});

describe('the insert a module imports', () => {
  for (const [what, source] of [
    ['a signal read', 'const A = () => <p>{count()}</p>;'],
    ['a ternary of text', 'const A = () => <p>{on() ? "yes" : "no"}</p>;'],
    ['several reads, one before an element', 'const A = () => <p>{a()}<b>x</b>{b()}</p>;'],
    ['a function the author wrote in the hole', 'const A = () => <p>{() => count()}</p>;'],
    ['a signal written as the child', 'const A = () => { const count = signal(0); return <p>{count}</p>; };'],
    ['a conditional element', 'const A = () => <p>{on() ? <b>x</b> : null}</p>;'],
  ]) {
    it(`is the reactive region for ${what}`, () => {
      const code = compile(source);
      assert.equal(insert(source), '_$reactive');
      assert.doesNotMatch(code, /[{ ]insert as /);
      assert.match(code, /_\$insert\(_el\$\d+, (?:\(\) =>|function)/, 'the calls keep their name, with a function written in place');
    });
  }

  for (const [what, source] of [
    ['a component in an element', 'const A = () => <p><Leaf /></p>;'],
    ['a value that is not reactive', 'const A = (node) => <p>{node}</p>;'],
    ['a placed prop', 'const A = (props) => <p>{props.children}</p>;'],
    ['a keyed list', 'const A = () => <ul>{rows().map((r) => <li key={r.id}>{r.t}</li>)}</ul>;'],
    ['a <For> with a fallback', 'const A = () => <ul><For each={rows} fallback={<li>none</li>}>{(r) => <li>{r}</li>}</For></ul>;'],
    ['one such hole among reactive ones', 'const A = (node) => <p>{count()}<b>x</b>{node}</p>;'],
  ]) {
    it(`is insert() for ${what}`, () => {
      assert.equal(insert(source), 'insert');
      assert.doesNotMatch(compile(source), /_\$reactive/);
    });
  }

  it('is decided by the whole module, whichever hole comes first', () => {
    const reactive = 'const A = () => <p>{count()}</p>;';
    const general = 'const B = (node) => <p>{node}</p>;';
    assert.equal(insert(`${reactive}\n${general}`), 'insert');
    assert.equal(insert(`${general}\n${reactive}`), 'insert');
  });

  it('a plain read keeps its own helper and decides nothing', () => {
    const imports = renderImports(compile('function Card(props) { return <p>{props.item.label}</p>; }'));
    assert.equal(imports._$plain, '_$plain');
    assert.equal(imports._$insert, undefined);
  });

  it('a hydratable module has no insert to choose', () => {
    const imports = renderImports(compile('const A = () => <p>{count()}</p>;', { hydratable: true }));
    assert.equal(imports._$insert, undefined);
    assert.equal(imports._$hole, '_$hole');
  });
});

describe('the setters compiled output calls, and the select code', () => {
  it('spread, setProp and setValue are imported as the compiled forms, which bring no select code', () => {
    const imports = renderImports(compile('export const A = (p) => <form><input {...p} /><a href={p.href} /><textarea value={p.text()} /></form>;'));
    assert.equal(imports._$spread, '_$spread');
    assert.equal(imports._$setProp, '_$setProp');
    assert.equal(imports._$setValue, '_$setValue');
  });

  for (const [what, source] of [
    ['the value of a select', 'export const A = (p) => <select value={p.v()}><option>a</option></select>;'],
    ['a constant value of a select', 'export const A = () => <select value="a"><option>a</option></select>;'],
    ['the value of an option', 'export const A = (p) => <option value={p.v}>a</option>;'],
    ['the selected prop of an option', 'export const A = (p) => <option selected={p.on()}>a</option>;'],
    ['a spread on an option', 'export const A = (p) => <option {...p}>a</option>;'],
    ['a spread on a select', 'export const A = (p) => <select {...p} />;'],
  ]) {
    it(`a module that writes ${what} installs the select code once, at module scope`, () => {
      const code = compile(source);
      assert.equal(renderImports(code)._$selects, '_$selects');
      assert.equal(code.match(/^_\$selects\(\);$/gm)?.length, 1, code);
    });
  }

  for (const [what, source] of [
    ['fields that are no select', 'export const A = (p) => <form><input value={p.v()} /><textarea {...p} /></form>;'],
    ['a select and options with markup attributes only', 'export const A = () => <select name="s" required><option value="a" selected>a</option></select>;'],
    ['a select whose options a list builds', 'export const A = (p) => <select name="s">{p.items().map((i) => <option key={i}>{i}</option>)}</select>;'],
  ]) {
    it(`a module with ${what} does not`, () => {
      assert.doesNotMatch(compile(source), /_\$selects/);
    });
  }
});

describe('the leaf call for a module whose every component is a plain function', () => {
  for (const [what, source] of [
    ['a function the module defines and uses only in JSX', 'function App() { return <p />; } mount(<App />, "#app");'],
    ['an arrow function', 'const App = () => <p />; export const x = <App />;'],
    ['an exported arrow function', 'export const App = () => <p />; export const x = <App />;'],
    ['a function expression', 'const App = function () { return <p />; }; mount(<App />, "#app");'],
    ['a component of what-framework', 'import { Portal } from "what-framework"; export const x = <Portal />;'],
    ['an island (what-framework\'s _$Island)', 'export const x = <Counter client:idle start={1} />;'],
  ]) {
    it(`is the one that runs no class component for ${what}`, () => {
      assert.equal(component(source), '_$createFn');
    });
  }

  for (const [what, source] of [
    ['an imported component', 'import Other from "./other.js"; export const x = <Other />;'],
    ['an exported function', 'export function App() { return <p />; } mount(<App />, "#app");'],
    ['a function passed on as a value', 'function App() { return <p />; } register(App); mount(<App />, "#app");'],
    ['a function whose prototype the module writes', 'function Legacy() {} Legacy.prototype.render = () => null; export const x = <Legacy />;'],
    ['a class', 'class Legacy { render() { return null; } } export const x = <Legacy />;'],
    ['a reassigned binding', 'let App = () => <p />; App = other; export const x = <App />;'],
    ['a member component', 'export const x = <Ctx.Provider value={1} />;'],
    ['a component defined inside another', 'function App() { const Row = () => <i />; return <div><Row /></div>; } mount(<App />, "#app");'],
    ['one plain function beside an import', 'import Other from "./other.js"; const A = () => <p />; export const x = <div><A /><Other /></div>;'],
  ]) {
    it(`is the one that runs a class component for ${what}`, () => {
      assert.equal(component(source), '_$createLeaf');
    });
  }

  it('no component what-framework or its router exports is a class component', async () => {
    for (const entry of ['what-framework', 'what-framework/router']) {
      const framework = await import(entry);
      const classes = Object.entries(framework).filter(([, v]) => typeof v === 'function' && v.prototype != null && (v.prototype.render || v.prototype.isReactComponent));
      assert.deepEqual(classes.map(([name]) => name), [], entry);
    }
  });
});

describe('the general call for a module whose every component is a plain function', () => {
  for (const [what, source] of [
    ['a function of the module handed children', 'const Box = (p) => <b>{p.children}</b>; export const x = <Box><p>x</p></Box>;'],
    ['an island with children (what-framework\'s _$Island)', 'export const x = <Counter client:idle><p>x</p></Counter>;'],
    ['a <Suspense> with a fallback', 'import { Suspense } from "what-framework"; const Leaf = () => <i />; export const x = <Suspense fallback={<p>wait</p>}><Leaf /></Suspense>;'],
    ['a router of what-framework', 'import { Router, Link } from "what-framework/router"; export const x = <div><Link href="/">home</Link><Router routes={[]} /></div>;'],
  ]) {
    it(`is the one that looks for no class component and no tag for ${what}`, () => {
      assert.equal(component(source), '_$createLazyFn');
      assert.ok(!Object.values(renderImports(compile(source))).includes('_$createComponent'), 'the general call is not imported beside it');
    });
  }

  it('is the general call once any component of the module may be something else', () => {
    assert.equal(component('import Other from "./other.js"; const Box = (p) => <b>{p.children}</b>; export const x = <Box><Other /></Box>;'), '_$createComponent');
  });
});

describe('a tag held in a binding', () => {
  it('a constant holding an element\'s name is that element, on both targets', () => {
    const source = 'const Tag = "select"; export const A = (p) => <Tag {...p} value={p.v()}><option>a</option></Tag>;';
    const code = compile(source);
    assert.match(code, /_\$template\("<select><option>a"\)/);
    assert.doesNotMatch(code, /_\$createComponent\(Tag/);
    assert.equal(code.match(/^_\$selects\(\);$/gm)?.length, 1, 'with the select code its props need');
    const ssr = compile(source, { generate: 'ssr' });
    assert.match(ssr, /\("select"/, 'the server writes a select');
    assert.doesNotMatch(ssr, /\(Tag\b/);
  });

  for (const [what, source] of [
    ['a tag read from props', 'export const A = (props) => { const Tag = props.as || "div"; return <Tag id="x">body</Tag>; };'],
    ['a binding written again', 'let Tag = "b"; Tag = "i"; export const A = () => <Tag />;'],
    ['a constant naming no element', 'const Tag = "Foo"; export const A = () => <Tag />;'],
    ['a parameter', 'export const A = ({ as: Tag }) => <Tag />;'],
  ]) {
    it(`${what} is a component call, which renders a string as its element (render.js asComponent)`, () => {
      const code = compile(source);
      assert.match(code, /_\$createComponent\(Tag/);
      assert.ok(['_$createComponent', '_$createLeaf'].includes(component(source)), component(source));
    });
  }
});
