// Template layout and the codegen fixes that came with it:
//   - insert markers only where the template needs them (T2-3),
//   - minified template markup (T2-9),
//   - compile-time namespaces: SVG/MathML roots flagged, className for HTML
//     elements (T2-7),
//   - classList objects and refs (T2-15),
//   - the keyed-only list entry for modules whose lists are all keyed .map().

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { installDOM } from '../../../test-utils/dom.js';
import { compileJSX } from '../../../test-utils/compile.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');
const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-template-layout-'));
let moduleId = 0;

async function load(source) {
  const out = compileJSX(source)
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { flushSync } = await import(pathToFileURL(CORE_INDEX).href);

const templates = (code) => [...code.matchAll(/_\$template\("((?:[^"\\]|\\.)*)"(?:, (\d))?\)/g)].map(m => [m[1].replace(/\\"/g, '"'), m[2] ? +m[2] : 0]);
const inserts = (code) => [...code.matchAll(/_\$insert\(([^\n]*)\);/g)].map(m => m[1]);

describe('insert markers', () => {
  it('gives a sole dynamic child no marker at all', () => {
    const code = compileJSX('const A = (x) => <p>{x()}</p>;');
    assert.deepEqual(templates(code), [['<p>', 0]]);
    assert.deepEqual(inserts(code), ['_el$0, () => x()']);
  });

  it('appends the last dynamic child', () => {
    const code = compileJSX('const A = (x) => <p>Count: {x()}</p>;');
    assert.deepEqual(templates(code), [['<p>Count: ', 0]]);
    assert.deepEqual(inserts(code), ['_el$0, () => x(), null']);
  });

  it('inserts before the next element or text, with no comment', () => {
    const code = compileJSX('const A = (x, y) => <p>{x()}<b/>{y()} items</p>;');
    assert.deepEqual(templates(code), [['<p><b></b> items', 0]]);
    const calls = inserts(code);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /\(\) => x\(\), _el\$\d+$/);
    assert.match(calls[1], /\(\) => y\(\), _el\$\d+$/);
    assert.doesNotMatch(code, /<!/);
  });

  it('places a placeholder only between adjacent dynamic children or between two texts', () => {
    const code = compileJSX('const A = (x, y, z) => <p>a {x()} b {y()}{z()}</p>;');
    assert.deepEqual(templates(code), [['<p>a <!> b <!>', 0]]);
  });

  it('flattens a fragment child into the template', () => {
    const code = compileJSX('const A = (x) => <div><>a<b>c</b></>{x()}</div>;');
    assert.deepEqual(templates(code), [['<div>a<b>c', 0]]);
  });

  it('keeps markers right when inserts shift the nodes after them', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const a = signal('A');
      export const b = signal('B');
      export const App = () => <p>[{a()}|{b()}<i>i</i>{a()}]</p>;
    `);
    const p = mod.App();
    assert.equal(p.textContent, '[A|BiA]');
    mod.a('A2');
    mod.b('');
    flushSync();
    assert.equal(p.textContent, '[A2|iA2]');
    assert.equal(p.querySelector('i').textContent, 'i');
  });
});

describe('template markup', () => {
  it('leaves simple attribute values unquoted and drops trailing closing tags', () => {
    const code = compileJSX('const A = () => <div id="a" class="x y" data-k="1"><span>t</span></div>;');
    assert.deepEqual(templates(code), [['<div id=a class="x y"data-k=1><span>t', 0]]);
  });

  it('quotes values that need it', () => {
    const code = compileJSX(`const A = () => <a title="" href="/p?a=1&b=2" data-q='say "hi"'>x</a>;`);
    assert.deepEqual(templates(code), [['<a title=""href="/p?a=1&amp;b=2"data-q="say &quot;hi&quot;">x', 0]]);
  });

  it('never writes a closing tag for a void element', () => {
    const code = compileJSX('const A = () => <div><br></br><input/>x</div>;');
    assert.deepEqual(templates(code), [['<div><br><input>x', 0]]);
  });

  it('round-trips through the HTML parser', async () => {
    const mod = await load(`export const A = () => <div id="a" class="x y" title='q"uote'><br></br><span>t</span>tail</div>;`);
    assert.equal(mod.A().outerHTML, '<div id="a" class="x y" title="q&quot;uote"><br><span>t</span>tail</div>');
  });
});

describe('namespaces', () => {
  it('flags an SVG root that is not <svg> and keeps <svg> roots unflagged', () => {
    const code = compileJSX('const A = () => <svg><path d="M0"/></svg>; const B = () => <circle r="1"/>;');
    assert.deepEqual(templates(code), [['<svg><path d=M0>', 0], ['<svg><circle r=1>', 2]]);
  });

  it('carries the SVG context into dynamic children and switches back at foreignObject', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const on = signal(true);
      export const A = () => (
        <svg>
          <g>{on() ? <rect width="1"/> : <circle r="1"/>}</g>
          <foreignObject><div class="html">{on() ? <p>x</p> : null}</div></foreignObject>
        </svg>
      );
    `);
    const svg = mod.A();
    const SVG = 'http://www.w3.org/2000/svg';
    assert.equal(svg.querySelector('rect').namespaceURI, SVG);
    assert.equal(svg.querySelector('div').namespaceURI, 'http://www.w3.org/1999/xhtml');
    assert.equal(svg.querySelector('p').namespaceURI, 'http://www.w3.org/1999/xhtml');
    mod.on(false);
    flushSync();
    assert.equal(svg.querySelector('circle').namespaceURI, SVG);
  });

  it('flags a MathML root that is not <math>', () => {
    const code = compileJSX('const A = () => <mi>x</mi>;');
    assert.deepEqual(templates(code), [['<math><mi>x', 2]]);
  });

  it('writes class with className on HTML and as an attribute on SVG', async () => {
    const code = compileJSX('const A = (c) => <div class={c()}><svg class={c()}><g class={c()}/></svg></div>;');
    assert.equal((code.match(/_\$className\(/g) || []).length, 1);
    assert.equal((code.match(/_\$setClass\(/g) || []).length, 2);
    const mod = await load(`
      import { signal } from 'what-framework';
      export const c = signal('one');
      export const A = () => <div class={c()}><svg class={c()}><g class={c()}/></svg></div>;
    `);
    const div = mod.A();
    mod.c('two');
    flushSync();
    assert.equal(div.className, 'two');
    assert.equal(div.querySelector('g').getAttribute('class'), 'two');
  });
});

describe('classList', () => {
  it('toggles classes instead of writing [object Object]', async () => {
    const mod = await load(`
      import { signal } from 'what-framework';
      export const active = signal(false);
      export const A = () => <div class="base" classList={{ active: active(), 'x y': true }} />;
    `);
    const el = mod.A();
    assert.equal(el.getAttribute('class'), 'base x y');
    mod.active(true);
    flushSync();
    assert.equal(el.getAttribute('class'), 'base x y active');
    assert.doesNotMatch(el.outerHTML, /object Object/);
  });
});

describe('refs', () => {
  it('assigns the element to a let binding', async () => {
    const mod = await load(`
      export function A() {
        let el;
        const node = <div id="r" ref={el} />;
        return { node, el };
      }
    `);
    const { node, el } = mod.A();
    assert.equal(el, node);
  });

  it('calls an inline ref once, without evaluating it three times', async () => {
    const code = compileJSX('const A = (log) => <div ref={(el) => log(el)} />;');
    assert.equal((code.match(/log\(el\)/g) || []).length, 1);
    assert.match(code, /\(el => log\(el\)\)\(_el\$0\)/);
  });

  it('evaluates a ref expression once and supports ref objects and callbacks', async () => {
    const mod = await load(`
      export const made = [];
      const makeRef = () => { const r = { current: null }; made.push(r); return r; };
      export const cb = [];
      export const A = () => <div><p ref={makeRef()} /><i ref={(el) => cb.push(el)} /></div>;
    `);
    const div = mod.A();
    assert.equal(mod.made.length, 1);
    assert.equal(mod.made[0].current, div.firstChild);
    assert.deepEqual(mod.cb, [div.lastChild]);
  });

  it('ignores an unset ref object binding instead of throwing', async () => {
    const mod = await load('export const A = (props) => <div ref={props.ref} />;');
    assert.doesNotThrow(() => mod.A({}));
  });
});

describe('list entry', () => {
  it('imports the keyed-only entry when every list is a keyed .map()', () => {
    const code = compileJSX('const A = (r) => <ul>{r().map(x => <li key={x}>{x}</li>)}</ul>;');
    assert.match(code, /_\$mapKeyed as _\$mapArray/);
  });

  it('imports mapArray when a <For> or a hand-written mapArray is present', () => {
    const forCode = compileJSX(`
      import { For } from 'what-framework';
      const A = (r) => <ul>{r().map(x => <li key={x}>{x}</li>)}<For each={r}>{(x) => <li>{x}</li>}</For></ul>;
    `);
    assert.match(forCode, /mapArray as _\$mapArray/);
    assert.doesNotMatch(forCode, /_\$mapKeyed/);
  });
});
