// Differential fuzz: compiled JSX must render the same DOM as the h() call tree
// it lowers to, before and after a signal write.
//
// "Lowers to" is load-bearing for one shape: a signal read written directly in
// JSX (`{count()}`, `title={count()}`) is auto-thunked by the compiler, so the
// h() tree it lowers to is the one that passes the thunk: `h(tag, {}, () =>
// count())`. Pairing it with the eager `h(tag, {}, count())` instead would
// assert that the auto-thunk does NOT happen, which is the opposite of the
// documented contract (docs/GOTCHAS.md section 2).
//
// That equivalence IS the compiler's contract. `<div>{a}{b}</div>` and
// `h('div', {}, a, b)` are two spellings of one tree, and the compiler's job is
// to turn the first into something observationally identical to the second. The
// assertion needs no knowledge of templates, markers, cursors or setter
// specialization, so it survives any change to how the lowering works and does
// not need updating when someone finds the next shape.
//
// The compiler's unit tests are all shape-by-shape: someone thought of a case,
// wrote the JSX, and asserted on the emitted string. That catches regressions in
// cases already thought of and is structurally blind to the ones nobody wrote —
// which is where marker-walk bugs live, because a wrong `nextSibling` chain
// still emits perfectly plausible code. Random trees do not have that blind
// spot. The generator is a seeded LCG, so a failure is reproducible from its
// case number and the whole run is deterministic across machines and CI.
//
// If this fails: print the case number, then print `jsx src` and `h src` for it.
// The two sources are the whole reproduction.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import babelPlugin from '../src/babel-plugin.js';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');
const SSR_RUNTIME = path.resolve(__dirname, '../../server/src/ssr-runtime.js');

const { signal, flushSync } = await import('../../core/src/reactive.js');
const { renderToString, renderToHydratableString, renderToStream, renderToStringAsync, renderDocument } = await import('../../server/src/index.js');
const { stableIds } = await import('../../server/test/stream-helpers.js');
// The server arms build one wrapper vnode by hand (see the `nested` route).
const { h } = await import('../../core/src/index.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-lowering-fuzz-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

// The committed run is sized to stay a few seconds. A longer sweep is one env
// var away, and a divergence it finds is reproducible from the seed alone:
//   WHAT_FUZZ_CASES=20000 WHAT_FUZZ_SEED=1 node --test <this file>
const CASES = Number(process.env.WHAT_FUZZ_CASES) || 500;
const SEED = Number(process.env.WHAT_FUZZ_SEED) || 987654321;

// Separate counts and seeds per arm, so widening one grammar cannot shift the
// trees another arm generates. Each arm compiles and imports two ES modules per
// case, which is what the wall clock is spent on; these sizes keep the file a
// few seconds. The env vars scale all three at once for a longer sweep.
const COMPONENT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 400;
const COMPONENT_SEED = Number(process.env.WHAT_FUZZ_SEED) || 24681357;
// Islands are the narrowest grammar of the three (one component, one directive)
// and each case additionally waits a macrotask for hydration, so fewer trees
// buy the same coverage.
const ISLAND_CASES = Number(process.env.WHAT_FUZZ_CASES) || 150;
const ISLAND_SEED = Number(process.env.WHAT_FUZZ_SEED) || 13572468;
// The server arms load the same two modules per case and compare six renders
// (three renderers, two routes) instead of mounting. The component, import,
// layout and island grammars reuse their DOM arms' seeds, so the trees are the
// same ones the client back end is checked on.
const SSR_CASES = Number(process.env.WHAT_FUZZ_CASES) || 250;
const SSR_SEED = Number(process.env.WHAT_FUZZ_SEED) || 86420975;
const SSR_COMPONENT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 200;
const SSR_IMPORT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 150;
const SSR_LAYOUT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 200;
const SSR_ISLAND_CASES = Number(process.env.WHAT_FUZZ_CASES) || 100;
const IMPORT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 300;
const IMPORT_SEED = Number(process.env.WHAT_FUZZ_SEED) || 55511133;
// Template layout and the lowerings that came with it: JSX text next to
// dynamic children, flattened fragments, attribute values the minifier must
// quote, void elements, classList objects, auto-selector lists and SVG subtrees.
const LAYOUT_CASES = Number(process.env.WHAT_FUZZ_CASES) || 300;
const LAYOUT_SEED = Number(process.env.WHAT_FUZZ_SEED) || 31415927;

// Signals 0..2 hold scalars. Signal 3 always holds an array and exists so a
// `list` child has something keyed to reconcile: the second value reorders,
// grows and drops entries all at once, which is what moves a keyed list's rows
// around relative to their siblings.
const LIST_SIGNAL = 3;
// Signal 4 is the selection a `selList` row compares its key with: 'b' is in
// both list values, so a write moves the selection from one surviving row to a
// row that only exists after the write.
const SELECT_SIGNAL = 4;
const FIRST_VALUES = ['x', 0, '', ['a', 'b'], 'b'];
const SECOND_VALUES = ['ZZ', 9, 'later', ['b', 'c', 'd'], 'c'];
const SCALAR_SIGNALS = 3;

// Components and islands are lowered by two code paths of their own, neither of
// which the element grammar above reaches. Both paths merge props, and both got
// that merge wrong in ways nobody noticed until someone hit them by hand: a
// spread dropped entirely, then only the LAST of several spreads kept, then
// explicit attributes applied after a spread regardless of where they were
// written. Those were found one at a time, in a browser. Generated together
// they fall out in a single run.
//
// The component bodies live in fixtures/fuzz-components.js and are imported by
// BOTH arms, so the only thing that differs between the two modules is how the
// call site was lowered.
const COMPONENTS = ['Box', 'Wrap'];
const FIXTURE = path.resolve(__dirname, 'fixtures/fuzz-components.js');

// Hyphenated names are in the pool deliberately. A component prop key that is
// not a valid identifier has to be emitted as a string literal, and that guard
// is one `t.identifier()` away from being lost — which is exactly the state the
// island branch was in.
const PROP_NAMES = ['label', 'extra', 'value', 'data-x', 'aria-label'];
// An island's props also take the names of the island's own options: they are
// the component's, as on any component.
const ISLAND_PROP_NAMES = [...PROP_NAMES, 'name', 'mode', 'component', 'mediaQuery'];

// Imported bindings. The compiler sees an import only by name, so a string
// constant, a signal, a computed and a plain function all look the same to it,
// and each has to lower to what the same value means in the h() tree. The
// compiled module imports them through a RELATIVE specifier, because that is
// what makes the compiler track an import as possibly reactive; the path is
// rewritten to the real fixture only after compiling.
const IMPORTS_FIXTURE = path.resolve(__dirname, 'fixtures/fuzz-imports.js');
const IMPORT_SPECIFIER = './fuzz-imports.js';
const IMPORT_REFS = ['STR', 'NUM', 'NIL', 'sig', 'comp', 'fn', 'DFLT', 'NS.STR', 'NS.sig'];
const importHeader = specifier =>
  `import { STR, NUM, NIL, sig, comp, fn } from ${q(specifier)};\n` +
  `import DFLT from ${q(specifier)};\n` +
  `import * as NS from ${q(specifier)};\n`;

// --- generator --------------------------------------------------------------

// No `p`. `<p>` may only hold phrasing content, so `<p><div/></p>` is markup the
// HTML parser legally restructures — a different failure (ERR_INVALID_HTML_NESTING,
// which this fuzzer found) with its own test in invalid-html-nesting.test.js.
// Generating it here would report a parser rule as a lowering divergence.
const TAGS = ['div', 'span', 'section'];
const STATIC_TEXT = ['A', 'B', 'static-', ' ', ''];
const ATTR_NAMES = ['id', 'title', 'data-x', 'class'];

function makeGenerator(seed) {
  let state = seed >>> 0;
  const rnd = () => (state = (state * 1664525 + 1013904223) >>> 0) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const int = n => Math.floor(rnd() * n);
  return { rnd, pick, int };
}

// One prop position, in the order it was written: either a single explicit prop
// or one spread carrying several keys.
//
// Spreads carry MORE THAN ONE key on purpose, drawn from a pool small enough
// that they collide with each other and with explicit props constantly. Both
// halves of the collision matter, and they fail differently. Which one wins is
// precedence. A key carried ONLY by an earlier spread is the one that silently
// vanishes when a lowering keeps just the last spread, and a single-key spread
// cannot see that class at all — it was the more serious half of #69 and it is
// the reason `entries` is a list rather than one name.
//
// Every spread SOURCE is an inline object literal, so each one is a fresh object
// per evaluation. Aliased sources (`const cfg = { a: 1 }; <Box {...cfg}>`) are
// a different bug class: `_$createComponent` used to write `children` onto the
// object it was handed. That is fixed in packages/core/src/render.js (copy
// before attach) and in this compiler (a lone non-literal spread is
// Object.assign'd). The fuzzer still inlines so a lowering divergence cannot
// be a props-identity accident.
function makePropItems(gen, signalCount, names = PROP_NAMES) {
  const { pick, int, rnd } = gen;
  const items = [];
  const count = int(5);
  for (let i = 0; i < count; i += 1) {
    if (rnd() < 0.35) {
      const entries = [];
      const used = new Set();
      const entryCount = 1 + int(3);
      for (let e = 0; e < entryCount; e += 1) {
        const name = pick(names);
        // One object literal cannot carry a key twice and mean both, so a
        // repeat inside a SINGLE spread is dropped rather than emitted.
        if (used.has(name)) continue;
        used.add(name);
        entries.push({ name, value: `sp${int(3)}` });
      }
      if (entries.length > 0) {
        items.push({ spread: entries });
        continue;
      }
    }
    const name = pick(names);
    const roll = rnd();
    // `label={s0()}` — read once, when the props object is built. The compiler
    // does not auto-thunk a component PROP the way it auto-thunks an element
    // attribute, so the h() spelling of this is the eager read too.
    if (roll < 0.34) items.push({ name, read: int(signalCount) });
    // `label={s0}` — the accessor itself, which is how this framework spells a
    // reactive prop. A merge that called accessors instead of copying them
    // through would trade an ordering bug for silently frozen output, so the
    // digest in the fixture calls every function-valued prop and the write half
    // of each arm checks that the text actually moved.
    else if (roll < 0.67) items.push({ name, accessor: int(signalCount) });
    else items.push({ name, static: `v${int(3)}` });
  }
  return items;
}

// A spec is a plain object so both emitters read the SAME tree. Nothing about
// the two sources can drift, because neither is written by hand.
function makeSpec(gen, depth, signalCount, forceElement = false, withComponents = false) {
  const { pick, int, rnd } = gen;
  const kinds = depth > 0
    ? (withComponents
      // Components sit in the SAME pool as elements rather than in a grammar of
      // their own, so components nest inside elements, elements inside
      // components, and both inside a fragment or a conditional arm, without
      // anyone having to enumerate those combinations.
      ? ['text', 'read', 'thunk', 'element', 'element', 'cond', 'fragment', 'list',
        'component', 'component', 'component']
      : ['text', 'read', 'thunk', 'element', 'element', 'cond', 'fragment', 'list'])
    : ['text', 'read', 'thunk'];
  // `return {expr};` is not JSX and a bare `<>...</>` root skips the element and
  // attribute paths, so the root is always an element.
  const kind = forceElement ? 'element' : pick(kinds);

  if (kind === 'text') return { kind, text: pick(STATIC_TEXT) };
  // `{s0()}`, which the compiler wraps in a thunk for you.
  if (kind === 'read') return { kind, signal: int(signalCount) };
  // `{() => s0()}`, the same thing spelled out.
  if (kind === 'thunk') return { kind, signal: int(signalCount) };
  if (kind === 'cond') {
    return {
      kind,
      signal: int(signalCount),
      then: makeSpec(gen, depth - 1, signalCount, false, withComponents),
      else: makeSpec(gen, depth - 1, signalCount, false, withComponents),
    };
  }
  if (kind === 'fragment') {
    const n = 1 + int(3);
    return {
      kind,
      children: Array.from({ length: n }, () => makeSpec(gen, depth - 1, signalCount, false, withComponents)),
    };
  }
  // `<Box a {...s} b>children</Box>`. Children go through the component's
  // `props.children`, a different insertion path from an element's children,
  // and the fixture renders them BETWEEN two static siblings so an insertion at
  // the wrong offset cannot hide.
  if (kind === 'component') {
    return {
      kind,
      comp: pick(COMPONENTS),
      items: makePropItems(gen, signalCount),
      children: Array.from(
        { length: int(3) },
        () => makeSpec(gen, depth - 1, signalCount, false, withComponents),
      ),
    };
  }
  // A keyed `.map()`, which the compiler auto-lowers to _$mapArray while the
  // h() spelling stays a plain reactive region. The two only agree if the
  // lowered list keeps the same position among its siblings across a write.
  if (kind === 'list') return { kind };

  const attrs = [];
  const attrCount = int(4);
  // Names already claimed by a signal-valued attribute on this element. A
  // spread must not reuse one: a reactive attribute is applied by an effect
  // that re-runs on every write, so it wins over a spread written AFTER it as
  // soon as the signal changes, while the h() tree keeps the spread's value
  // forever. That divergence is real and predates spread generation here; it
  // needs the runtime to record which keys a spread owns, so it is not
  // something this file can assert on today.
  const reactiveNames = new Set();
  for (let i = 0; i < attrCount; i += 1) {
    // A spread anywhere in the list. Names deliberately collide with the STATIC
    // attributes: which one survives is decided by written order, and that is
    // the whole point of generating them together. Duplicate plain names are
    // allowed too, because JSX resolves those by order as well.
    if (rnd() < 0.25) {
      const free = ATTR_NAMES.filter(n => !reactiveNames.has(n));
      if (free.length) {
        attrs.push({ spread: { name: pick(free), value: `sp${int(3)}` } });
        continue;
      }
    }
    const name = pick(ATTR_NAMES);
    // Half static, half a signal read, because the two take different setter
    // paths (baked into the template string vs a setProp/setClass call).
    if (rnd() < 0.5) {
      attrs.push({ name, static: `v${int(3)}` });
    } else {
      reactiveNames.add(name);
      attrs.push({ name, signal: int(signalCount) });
    }
  }
  const childCount = int(4);
  return {
    kind: 'element',
    tag: pick(TAGS),
    attrs,
    children: Array.from(
      { length: childCount },
      () => makeSpec(gen, depth - 1, signalCount, false, withComponents),
    ),
  };
}

// `<Chart client:load ... />`, wrapped in an element so the root still takes the
// element path. Only `client:load` is generated: every other mode waits on an
// idle callback, an IntersectionObserver or a media query, and the thing being
// tested is which props reach Island, not the browser API that triggers it.
function makeIslandSpec(gen, signalCount) {
  const { int } = gen;
  return {
    kind: 'element',
    tag: 'div',
    attrs: [],
    children: [{
      kind: 'island',
      items: makePropItems(gen, signalCount, ISLAND_PROP_NAMES),
      children: Array.from({ length: int(3) }, () => makeSpec(gen, 1, signalCount)),
    }],
  };
}

// The layout arm's grammar. Static text is written as JSX text here (the other
// arms spell it `{"A"}`), so it lands in the template next to dynamic children
// and decides where markers go. Two JSX texts written side by side are one text
// in the source, so this arm compares text content with adjacent text nodes
// merged: how many nodes a run of text occupies is not observable.
const RAW_TEXT = ['A', 'B', 'Cd'];
// Every kind of attribute value the template minifier has to handle: simple
// (unquoted), with a space, a quote, an ampersand, an equals sign, and empty.
const LAYOUT_VALUES = ['v0', 'a b', 'q"t', "it's", 'x&y', 'p=q', ''];
const LAYOUT_ATTRS = ['id', 'title', 'data-x'];
const SVG_TAGS = ['g', 'text', 'circle'];

function makeLayoutAttrs(gen, svg) {
  const { pick, int, rnd } = gen;
  const attrs = [];
  const names = new Set();
  for (let i = int(3); i > 0; i -= 1) {
    const name = pick(svg ? [...LAYOUT_ATTRS, 'class'] : LAYOUT_ATTRS);
    if (names.has(name)) continue;
    names.add(name);
    attrs.push(rnd() < 0.5 ? { name, static: pick(LAYOUT_VALUES) } : { name, signal: int(SCALAR_SIGNALS) });
  }
  // classList on HTML elements, never next to a reactive class (two writers of
  // one attribute would make the outcome depend on effect order).
  if (!svg && rnd() < 0.3) {
    attrs.push({ classList: [
      { key: 'on', signal: int(SCALAR_SIGNALS) },
      { key: 'two words', constant: rnd() < 0.5 },
    ] });
  }
  return attrs;
}

function makeLayoutSpec(gen, depth, svg = false, forceElement = false) {
  const { pick, int } = gen;
  const kinds = depth > 0
    ? (svg
      ? ['raw', 'read', 'thunk', 'svgElement', 'svgElement', 'cond', 'fragment']
      : ['raw', 'raw', 'text', 'read', 'thunk', 'element', 'element', 'fragment', 'cond', 'selList', 'svg', 'void'])
    : (svg ? ['raw', 'read', 'thunk'] : ['raw', 'text', 'read', 'thunk', 'void']);
  const kind = forceElement ? 'element' : pick(kinds);
  const children = (n) => Array.from({ length: n }, () => makeLayoutSpec(gen, depth - 1, svg));

  if (kind === 'raw') return { kind, text: pick(RAW_TEXT) };
  if (kind === 'text') return { kind, text: pick(STATIC_TEXT) };
  if (kind === 'read' || kind === 'thunk') return { kind, signal: int(SCALAR_SIGNALS) };
  if (kind === 'selList') return { kind: 'list', selector: true };
  if (kind === 'void') return { kind: 'element', tag: 'br', attrs: makeLayoutAttrs(gen, false), children: [] };
  if (kind === 'fragment') return { kind, children: children(1 + int(3)) };
  if (kind === 'cond') {
    return {
      kind, signal: int(SCALAR_SIGNALS), arms: svg ? ['g', 'text'] : ['b', 'i'],
      then: makeLayoutSpec(gen, depth - 1, svg), else: makeLayoutSpec(gen, depth - 1, svg),
    };
  }
  if (kind === 'svg' || kind === 'svgElement') {
    const tag = kind === 'svg' ? 'svg' : pick(SVG_TAGS);
    return { kind: 'element', tag, attrs: makeLayoutAttrs(gen, true), children: tag === 'circle' ? [] : (() => {
      const kids = [];
      for (let i = int(4); i > 0; i -= 1) kids.push(makeLayoutSpec(gen, depth - 1, true));
      return kids;
    })() };
  }
  return { kind: 'element', tag: pick(TAGS), attrs: makeLayoutAttrs(gen, false), children: children(int(5)) };
}

// Turns some of a generated tree's signal reads into imported bindings: an
// element attribute, a child, or a component prop. Only positions that already
// held a signal are replaced, so an attribute name a spread was kept away from
// (see reactiveNames in makeSpec) stays reserved for a reactive writer.
function withImports(spec, gen) {
  const { rnd, pick } = gen;
  if (spec.kind === 'read' && rnd() < 0.5) return { kind: 'imported', ref: pick(IMPORT_REFS) };
  if (spec.kind === 'element') {
    spec.attrs = spec.attrs.map(a => (a.signal !== undefined && rnd() < 0.7)
      ? { name: a.name, imported: pick(IMPORT_REFS) }
      : a);
  }
  if (spec.kind === 'component') {
    spec.items = spec.items.map(i => ((i.read !== undefined || i.accessor !== undefined) && rnd() < 0.7)
      ? { name: i.name, imported: pick(IMPORT_REFS) }
      : i);
  }
  for (const key of ['then', 'else']) {
    if (spec[key]) spec[key] = withImports(spec[key], gen);
  }
  if (Array.isArray(spec.children)) spec.children = spec.children.map(child => withImports(child, gen));
  return spec;
}

const q = s => JSON.stringify(s);

const spreadEntries = entries => entries.map(e => `${q(e.name)}: ${q(e.value)}`).join(', ');

// Shared by the component and island emitters so the two cannot drift apart in
// how a prop position is spelled.
function emitPropsJSX(items) {
  return items.map(item => {
    if (item.spread) return ` {...{ ${spreadEntries(item.spread)} }}`;
    if (item.read !== undefined) return ` ${item.name}={s[${item.read}]()}`;
    if (item.accessor !== undefined) return ` ${item.name}={s[${item.accessor}]}`;
    if (item.imported !== undefined) return ` ${item.name}={${item.imported}}`;
    return ` ${item.name}=${q(item.static)}`;
  }).join('');
}

// `live`: a component's props, where a value that reads a signal is a live
// prop, a getter over the read (dom.js isLivePropValue). An island's props
// are its serialized data, read when it is created.
function emitPropsH(items, live = false) {
  return items.map(item => {
    if (item.spread) return `...{ ${spreadEntries(item.spread)} }`;
    if (item.read !== undefined) return live ? `get ${q(item.name)}() { return s[${item.read}](); }` : `${q(item.name)}: s[${item.read}]()`;
    if (item.accessor !== undefined) return `${q(item.name)}: s[${item.accessor}]`;
    if (item.imported !== undefined) return `${q(item.name)}: ${item.imported}`;
    return `${q(item.name)}: ${q(item.static)}`;
  }).join(', ');
}

// A JSX attribute string cannot escape a quote, so it is written with the
// quote character the value does not contain.
const jsxAttrString = v => (v.includes('"') ? `'${v}'` : `"${v}"`);

const classListObject = entries => `{ ${entries.map(e => `${q(e.key)}: ${e.signal !== undefined ? `s[${e.signal}]()` : String(e.constant)}`).join(', ')} }`;

function emitJSX(spec) {
  switch (spec.kind) {
    case 'raw': return spec.text;
    case 'text': return spec.text === '' ? '{""}' : `{${q(spec.text)}}`;
    case 'read': return `{s[${spec.signal}]()}`;
    case 'thunk': return `{() => s[${spec.signal}]()}`;
    case 'imported': return `{${spec.ref}}`;
    case 'cond': {
      const [a, b] = spec.arms || ['b', 'i'];
      return `{() => s[${spec.signal}]() ? <${a}>${emitJSX(spec.then)}</${a}> : <${b}>${emitJSX(spec.else)}</${b}>}`;
    }
    case 'fragment':
      return `<>${spec.children.map(emitJSX).join('')}</>`;
    case 'list':
      return spec.selector
        ? `{() => s[${LIST_SIGNAL}]().map(v => <li key={v} class={sel() === v ? "on" : "off"}>{v}</li>)}`
        : `{() => s[${LIST_SIGNAL}]().map(v => <li key={v}>{v}</li>)}`;
    case 'component': {
      const props = emitPropsJSX(spec.items);
      const kids = spec.children.map(emitJSX).join('');
      // Self-closing when there are no children: that is the shape a caller
      // writes, and it lowers to a different children argument.
      return kids
        ? `<${spec.comp}${props}>${kids}</${spec.comp}>`
        : `<${spec.comp}${props} />`;
    }
    case 'island': {
      const props = emitPropsJSX(spec.items);
      const kids = spec.children.map(emitJSX).join('');
      return kids
        ? `<Chart client:load${props}>${kids}</Chart>`
        : `<Chart client:load${props} />`;
    }
    default: {
      const attrs = spec.attrs.map(a => {
        if (a.spread) return ` {...{ ${q(a.spread.name)}: ${q(a.spread.value)} }}`;
        if (a.classList) return ` classList={${classListObject(a.classList)}}`;
        if (a.imported !== undefined) return ` ${a.name}={${a.imported}}`;
        return a.static !== undefined
          ? ` ${a.name}=${jsxAttrString(a.static)}`
          : ` ${a.name}={s[${a.signal}]()}`;
      }).join('');
      return `<${spec.tag}${attrs}>${spec.children.map(emitJSX).join('')}</${spec.tag}>`;
    }
  }
}

function jsxChildren(children) {
  const out = [];
  for (const child of children) {
    const last = out[out.length - 1];
    if (child.kind === 'raw' && last !== undefined && last.kind === 'raw') out[out.length - 1] = { kind: 'raw', text: last.text + child.text };
    else out.push(child);
  }
  return out;
}

// An element's children as both targets lay them out: a fragment among them
// is its own children, in its place (dom.js layoutChildren, ssr.js
// appendChildList), so its h() spelling spreads them into the element's.
function inElement(children) {
  return children.flatMap((child) => (child.kind === 'fragment' ? inElement(jsxChildren(child.children)) : [child]));
}

function emitH(spec) {
  switch (spec.kind) {
    case 'raw': return q(spec.text);
    case 'text': return q(spec.text);
    // Identical on purpose: `read` and `thunk` are two JSX spellings of one
    // tree, and this is the tree. See the note at the top of the file.
    case 'read': return `(() => s[${spec.signal}]())`;
    case 'thunk': return `(() => s[${spec.signal}]())`;
    // `{STR}` is one spelling of the child STR, whatever STR turns out to be.
    case 'imported': return spec.ref;
    case 'cond': {
      const [a, b] = spec.arms || ['b', 'i'];
      const arm = (child) => inElement([child]).map(emitH).join(', ');
      return `(() => s[${spec.signal}]() ? h(${q(a)}, {}, ${arm(spec.then)}) : h(${q(b)}, {}, ${arm(spec.else)}))`;
    }
    // Raw text written side by side in JSX is one text child, so the
    // fragment's children are counted as JSX counts them: a component hands a
    // single child over as itself, and several as an array.
    case 'fragment':
      return `h(Fragment, {}, ${jsxChildren(spec.children).map(emitH).join(', ') || 'null'})`;
    case 'list':
      return spec.selector
        ? `(() => s[${LIST_SIGNAL}]().map(v => h("li", { key: v, class: () => (s[${SELECT_SIGNAL}]() === v ? "on" : "off") }, v)))`
        : `(() => s[${LIST_SIGNAL}]().map(v => h("li", { key: v }, v)))`;
    // `<Box a {...s} b>kid</Box>` is one spelling of `h(Box, { a, ...s, b }, kid)`.
    //
    // The merge is written as an object literal with a spread in it, NOT as the
    // Object.assign the compiler happens to emit. Those evaluate identically,
    // but only one of them is the oracle: `{ a, ...s, b }` is the language's own
    // definition of what the JSX means, while Object.assign is the current
    // implementation. Writing the implementation into the oracle would make the
    // comparison agree with whatever the compiler does, which is the one thing a
    // differential test must never do.
    //
    // A prop that reads a signal is live: `<Box a={s[0]()} />` is one
    // spelling of `h(Box, { get a() { return s[0](); } })`, the component
    // reading the current value wherever it reads `props.a`. The object has
    // no prototype, which is how a props object keeps its getters through the
    // renderer's copy (what-core dom.js _copyProps).
    case 'component': {
      const props = emitPropsH(spec.items, true);
      const kids = spec.children.map(emitH).join(', ');
      return `h(${spec.comp}, {__proto__: null${props ? ', ' : ''}${props}}${kids ? `, ${kids}` : ''})`;
    }
    // An island IS a component: the directive only decides WHEN it hydrates.
    // `component` and `mode` come from the tag and the directive, and
    // the caller's props are an object of their own beside them, so a prop
    // called `mode` or `component`, written or spread, is the component's.
    case 'island': {
      const props = emitPropsH(spec.items);
      const kids = spec.children.map(emitH).join(', ');
      const island = `{"component": Chart, "mode": "load", "props": {${props}}}`;
      return `h(Island, ${island}${kids ? `, ${kids}` : ''})`;
    }
    default: {
      const props = spec.attrs.map(a => {
        if (a.spread) return `...{ ${q(a.spread.name)}: ${q(a.spread.value)} }`;
        if (a.classList) return `"classList": () => (${classListObject(a.classList)})`;
        if (a.imported !== undefined) return `${q(a.name)}: ${a.imported}`;
        return a.static !== undefined
          ? `${q(a.name)}: ${q(a.static)}`
          : `${q(a.name)}: (() => s[${a.signal}]())`;
      }).join(', ');
      const kids = inElement(spec.children).map(emitH).join(', ');
      return `h(${q(spec.tag)}, {${props}}${kids ? `, ${kids}` : ''})`;
    }
  }
}

// --- module loading ---------------------------------------------------------

let moduleId = 0;

function localize(code) {
  return code
    .replaceAll(q(IMPORT_SPECIFIER), q(IMPORTS_FIXTURE))
    .replaceAll(`'${IMPORT_SPECIFIER}'`, q(IMPORTS_FIXTURE))
    .replaceAll('"what-framework/ssr-runtime"', q(SSR_RUNTIME))
    .replaceAll('"what-framework/render"', q(CORE_RENDER))
    .replaceAll("'what-framework/render'", q(CORE_RENDER))
    .replaceAll('"what-framework"', q(CORE_INDEX))
    .replaceAll("'what-framework'", q(CORE_INDEX));
}

async function loadModule(code) {
  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, code);
  return import(pathToFileURL(file).href);
}

// The component fixture is imported only by the arms that generate components,
// so the element-only arm keeps emitting exactly the module it emitted before
// and its seed still produces the same trees.
const fixtureImport = names => (names ? `import { ${names} } from ${q(FIXTURE)};\n` : '');

function compileJSX(source) {
  return transformSync(source, {
    filename: 'fuzz.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

// `prelude` runs at the top of build(), before the tree is returned.
function loadJSX(spec, imports = '', header = '', prelude = '') {
  const source = `${fixtureImport(imports)}${header}export function build(s) { ${prelude}return ${emitJSX(spec)}; }`;
  return loadModule(localize(compileJSX(source)));
}

function loadH(spec, imports = '', coreNames = 'h, Fragment', header = '', prelude = '') {
  return loadModule(
    `import { ${coreNames} } from ${q(CORE_INDEX)};\n` +
    fixtureImport(imports) +
    header +
    `export function build(s) { ${prelude}return ${emitH(spec)}; }`,
  );
}

// --- observation ------------------------------------------------------------

// What is observable to a user: elements, their attributes, and text. Comment
// markers are the compiler's bookkeeping and the h() path does not need the same
// ones, so comparing raw innerHTML would compare implementations rather than
// behaviour. Empty text nodes are likewise invisible. An element outside the
// HTML namespace (SVG, MathML) is marked with it, since an <svg> child created
// in the wrong namespace looks identical and renders nothing. With `mergeText`,
// adjacent text nodes count as one.
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

function serialize(node, out = [], mergeText = false) {
  for (const child of node.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      if (child.data === '') continue;
      const last = out.length - 1;
      if (mergeText && last >= 0 && out[last].startsWith('#')) out[last] += child.data;
      else out.push(`#${child.data}`);
      continue;
    }
    if (child.nodeType === 1) {
      const attrs = [...child.attributes]
        .map(a => `${a.name}=${a.value}`)
        .sort()
        .join(' ');
      const ns = child.namespaceURI === XHTML_NS ? '' : `@${child.namespaceURI}`;
      out.push(`<${child.localName}${ns}${attrs ? ` ${attrs}` : ''}>`);
      serialize(child, out, mergeText);
      out.push(`</${child.localName}>`);
      continue;
    }
    serialize(child, out, mergeText);
  }
  return out;
}

function mountInto(built, container) {
  if (built && typeof built.nodeType === 'number') {
    container.appendChild(built);
    return;
  }
  if (Array.isArray(built)) {
    for (const item of built) mountInto(item, container);
    return;
  }
  // h() returns a VNode; mount() is its only public entry point.
  mountFn(built, container);
}

let mountFn;

// Islands hydrate on a microtask (`client:load`), so both arms need one turn of
// the macrotask queue before they can be compared. Everything else here is
// synchronous.
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

// Build one tree in each arm, mount both, compare, write every signal, compare
// again. Returns the trees that disagreed rather than throwing on the first, so
// a divergence count is a measure of how wide the bug is and not just that one
// exists — 1 tree in 500 and 400 in 500 are very different findings.
async function runParity({
  cases, seed, makeCase, imports, coreNames, needsSettle = false,
  jsxHeader = '', hHeader = '', reset = () => {}, write = () => {},
  jsxPrelude = '', hPrelude = '', mergeText = false,
}) {
  const gen = makeGenerator(seed);
  const divergent = [];
  const specs = [];

  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const spec = makeCase(gen);
    specs.push(spec);

    let jsxMod;
    let hMod;
    try {
      jsxMod = await loadJSX(spec, imports, jsxHeader, jsxPrelude);
      hMod = await loadH(spec, imports, coreNames, hHeader, hPrelude);
    } catch (err) {
      // A module that will not even parse is the most severe divergence there
      // is, and it is how an attribute name emitted as a bare identifier shows
      // up: the compiled file is not JavaScript. Recorded rather than thrown so
      // the count still reflects how many trees are affected.
      divergent.push({
        caseIndex, phase: 'load', spec,
        jsx: `${err.constructor.name}: ${err.message.split('\n')[0]}`,
        h: '(loaded)',
      });
      continue;
    }

    const jsxSignals = FIRST_VALUES.map((v, i) => signal(v, `jsx${i}`));
    const hSignals = FIRST_VALUES.map((v, i) => signal(v, `h${i}`));
    reset();

    const jsxHost = document.createElement('div');
    const hHost = document.createElement('div');
    document.body.append(jsxHost, hHost);

    try {
      try {
        mountInto(jsxMod.build(jsxSignals), jsxHost);
        mountInto(hMod.build(hSignals), hHost);
      } catch (err) {
        assert.fail(
          `case ${caseIndex} threw while building:\n` +
          `  ${err.message}\n` +
          `  jsx src: ${emitJSX(spec)}\n` +
          `  h   src: ${emitH(spec)}`,
        );
      }
      flushSync();
      if (needsSettle) { await settle(); flushSync(); }

      const before = [serialize(jsxHost, [], mergeText).join(''), serialize(hHost, [], mergeText).join('')];
      if (before[0] !== before[1]) {
        divergent.push({ caseIndex, phase: 'initial', jsx: before[0], h: before[1], spec });
        continue;
      }

      // The reactive half of the contract: a write must move both trees the
      // same way. A lowering that renders correctly once and then updates the
      // wrong node is the bug class this half exists for.
      SECOND_VALUES.forEach((v, i) => { jsxSignals[i](v); hSignals[i](v); });
      write();
      flushSync();
      if (needsSettle) { await settle(); flushSync(); }

      const after = [serialize(jsxHost, [], mergeText).join(''), serialize(hHost, [], mergeText).join('')];
      if (after[0] !== after[1]) {
        divergent.push({ caseIndex, phase: 'after write', jsx: after[0], h: after[1], spec });
      }
    } finally {
      jsxHost.remove();
      hHost.remove();
    }
  }

  return { divergent, specs };
}

function reportDivergence(divergent, cases) {
  if (divergent.length === 0) return;
  const first = divergent[0];
  assert.fail(
    `${divergent.length}/${cases} trees diverged.\n` +
    `first: case ${first.caseIndex} (${first.phase})\n` +
    `  jsx src: ${emitJSX(first.spec)}\n` +
    `  h   src: ${emitH(first.spec)}\n` +
    `  jsx dom: ${first.jsx}\n` +
    `  h   dom: ${first.h}`,
  );
}

// Which of the prop interleavings a spec actually contains. A fuzzer that
// quietly stops generating the interesting shape still passes, so the corpus is
// checked for the shapes that matter instead of being taken on trust.
function shapesIn(spec, found = new Set()) {
  if (!spec || typeof spec !== 'object') return found;
  if (spec.kind === 'component' || spec.kind === 'island') {
    const items = spec.items;
    const spreads = items.filter(i => i.spread);
    if (spreads.length > 1) found.add('spread-then-spread');
    if (spreads.some(s => s.spread.length > 1)) found.add('multi-key-spread');
    if (items.some(i => i.accessor !== undefined)) found.add('accessor-prop');
    if (items.some(i => i.name && i.name.includes('-'))) found.add('hyphenated-prop');
    if (items.some(i => i.spread && i.spread.some(e => e.name.includes('-')))) {
      found.add('hyphenated-in-spread');
    }
    const optionNamed = name => ISLAND_PROP_NAMES.indexOf(name) >= PROP_NAMES.length;
    if (items.some(i => optionNamed(i.name))) found.add('option-named-prop');
    if (items.some(i => i.spread && i.spread.some(e => optionNamed(e.name)))) found.add('option-named-in-spread');
    if (items.length === 1 && items[0].spread && spec.children.length > 0) {
      found.add('lone-spread-with-children');
    }
    for (let i = 0; i < items.length - 1; i += 1) {
      if (!items[i].spread && items[i + 1].spread) found.add('explicit-then-spread');
      if (items[i].spread && !items[i + 1].spread) found.add('spread-then-explicit');
    }
    for (let i = 0; i < items.length - 2; i += 1) {
      if (items[i].spread && !items[i + 1].spread && items[i + 2].spread) {
        found.add('spread-explicit-spread');
      }
    }
  }
  for (const key of ['children', 'then', 'else']) {
    const value = spec[key];
    if (Array.isArray(value)) value.forEach(child => shapesIn(child, found));
    else if (value) shapesIn(value, found);
  }
  return found;
}

function assertCorpusCovers(specs, required) {
  const found = new Set();
  for (const spec of specs) shapesIn(spec, found);
  const missing = required.filter(shape => !found.has(shape));
  assert.deepEqual(
    missing, [],
    `the generated corpus never produced: ${missing.join(', ')}. ` +
    'The arm would pass without ever exercising those shapes, so the generator ' +
    'is what needs fixing, not the assertion.',
  );
}

describe('compiler lowering parity (fuzz)', () => {
  before(async () => {
    ({ mount: mountFn } = await import('../../core/src/dom.js'));
  });

  it(`compiled JSX matches the h() tree for ${CASES} random trees`, async () => {
    const { divergent } = await runParity({
      cases: CASES,
      seed: SEED,
      makeCase: gen => makeSpec(gen, 3, SCALAR_SIGNALS, true),
    });
    reportDivergence(divergent, CASES);
  });

  it(`components, props and spreads match the h() tree for ${COMPONENT_CASES} random trees`, async () => {
    const { divergent, specs } = await runParity({
      cases: COMPONENT_CASES,
      seed: COMPONENT_SEED,
      makeCase: gen => makeSpec(gen, 3, SCALAR_SIGNALS, true, true),
      imports: COMPONENTS.join(', '),
    });

    assertCorpusCovers(specs, [
      'explicit-then-spread', 'spread-then-explicit', 'spread-then-spread',
      'spread-explicit-spread', 'multi-key-spread', 'lone-spread-with-children',
      'accessor-prop', 'hyphenated-prop', 'hyphenated-in-spread',
    ]);
    reportDivergence(divergent, COMPONENT_CASES);
  });

  it(`islands match the h(Island) tree for ${ISLAND_CASES} random trees`, async () => {
    const { divergent, specs } = await runParity({
      cases: ISLAND_CASES,
      seed: ISLAND_SEED,
      makeCase: gen => makeIslandSpec(gen, SCALAR_SIGNALS),
      imports: 'Chart',
      coreNames: 'h, Fragment',
      hHeader: `import { _$Island as Island } from ${q(CORE_RENDER)};\n`,
      needsSettle: true,
    });

    assertCorpusCovers(specs, [
      'explicit-then-spread', 'spread-then-explicit', 'spread-then-spread',
      'multi-key-spread', 'accessor-prop', 'hyphenated-prop',
      'option-named-prop', 'option-named-in-spread',
    ]);
    reportDivergence(divergent, ISLAND_CASES);
  });

  // Every imported binding kind in every position a bare identifier can sit in.
  // An import is the one binding the compiler can neither prove is a signal nor
  // rule out, and a lowering that guessed "signal" called string constants and
  // threw at runtime. The fixture's signal is shared by both arms, so `write`
  // moves the two trees together.
  it(`imported bindings match the h() tree for ${IMPORT_CASES} random trees`, async () => {
    const { resetImports, writeImports } = await import(pathToFileURL(IMPORTS_FIXTURE).href);
    const { divergent, specs } = await runParity({
      cases: IMPORT_CASES,
      seed: IMPORT_SEED,
      makeCase: gen => withImports(makeSpec(gen, 3, SCALAR_SIGNALS, true, true), gen),
      imports: COMPONENTS.join(', '),
      jsxHeader: importHeader(IMPORT_SPECIFIER),
      hHeader: importHeader(IMPORTS_FIXTURE),
      reset: resetImports,
      write: writeImports,
    });

    const found = new Set();
    const walk = spec => {
      if (!spec || typeof spec !== 'object') return;
      if (spec.kind === 'imported') found.add(`child:${spec.ref}`);
      for (const a of spec.attrs || []) if (a.imported) found.add(`attr:${a.imported}`);
      for (const i of spec.items || []) if (i.imported) found.add(`prop:${i.imported}`);
      for (const key of ['then', 'else']) walk(spec[key]);
      (spec.children || []).forEach(walk);
    };
    specs.forEach(walk);
    const required = [
      ...IMPORT_REFS.map(ref => `attr:${ref}`),
      ...IMPORT_REFS.map(ref => `child:${ref}`),
      'prop:STR', 'prop:sig', 'prop:fn',
    ];
    const missing = required.filter(shape => !found.has(shape));
    assert.deepEqual(missing, [], `the generated corpus never produced: ${missing.join(', ')}`);
    reportDivergence(divergent, IMPORT_CASES);
  });

  it(`template layout and its lowerings match the h() tree for ${LAYOUT_CASES} random trees`, async () => {
    const { divergent, specs } = await runParity({
      cases: LAYOUT_CASES,
      seed: LAYOUT_SEED,
      makeCase: gen => makeLayoutSpec(gen, 3, false, true),
      // `sel` is a computed, so the auto-selector rewrites the comparison in a
      // selList row; the h() spelling compares with the signal directly.
      jsxHeader: `import { computed } from 'what-framework';\n`,
      jsxPrelude: `const sel = computed(() => s[${SELECT_SIGNAL}]()); `,
      mergeText: true,
    });

    const found = new Set();
    const walk = (spec, parent) => {
      if (!spec || typeof spec !== 'object') return;
      if (spec.kind === 'list' && spec.selector) found.add('selector-list');
      if (spec.kind === 'raw' && parent) {
        const at = parent.indexOf(spec);
        if (parent.some((s, i) => Math.abs(i - at) === 1 && s.kind !== 'raw' && s.kind !== 'element')) found.add('text-beside-dynamic');
      }
      if (spec.tag === 'svg') found.add('svg');
      if (spec.kind === 'cond' && spec.arms && spec.arms[0] === 'g') found.add('svg-root-template');
      if (spec.tag === 'br') found.add('void');
      for (const a of spec.attrs || []) {
        if (a.classList) found.add('classList');
        if (a.static !== undefined && a.static !== '' && !/^[\w-]+$/.test(a.static)) found.add('quoted-value');
      }
      for (const key of ['then', 'else']) walk(spec[key], null);
      (spec.children || []).forEach(child => walk(child, spec.children));
    };
    specs.forEach(spec => walk(spec, null));
    const required = ['selector-list', 'text-beside-dynamic', 'svg', 'svg-root-template', 'void', 'classList', 'quoted-value'];
    assert.deepEqual(required.filter(shape => !found.has(shape)), [], 'the generated corpus never produced these shapes');

    // The selector list must actually take the rewritten path.
    const probe = compileJSX(`import { computed } from 'what-framework';\nexport function build(s) { const sel = computed(() => s[4]()); return <ul>${emitJSX({ kind: 'list', selector: true })}</ul>; }`);
    assert.match(probe, /_\$createSelector\(sel\)/);
    reportDivergence(divergent, LAYOUT_CASES);
  });

});

// --- server target --------------------------------------------------------------
//
// The same specs, compiled with `generate: "ssr"`, must server-render to the
// same bytes as the h() tree the JSX lowers to, in every renderer. That is the
// oracle the earlier refusal arm was shaped to become once a server target
// existed: the spec and both emitters are the ones the DOM arms use, so the
// server back end is held to exactly the tree the client back end is.
//
// Two routes into the renderer per tree, because compiled markup reaches it
// two ways:
//   direct  the compiled root IS the value handed to the renderer (and was
//           built before the render began, so it has to be lazy);
//   nested  it arrives through a reactive thunk inside an h() element, which
//           is how a page embeds one compiled component.
// Strings are compared from renderToString and renderToHydratableString (the
// markers the client's hydrate() reads, data-hk included), the stream's output
// as the concatenation of its chunks, renderToStringAsync's settled body, and
// the whole document renderDocument writes for a page that returns the tree.

function compileSSR(source) {
  return transformSync(source, {
    filename: 'fuzz.jsx',
    plugins: [[babelPlugin, { production: false, generate: 'ssr' }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

function loadJSXServer(spec, imports = '', header = '', prelude = '') {
  const source = `${fixtureImport(imports)}${header}export function build(s) { ${prelude}return ${emitJSX(spec)}; }`;
  return loadModule(localize(compileSSR(source)));
}

async function streamed(tree) {
  let out = '';
  for await (const chunk of renderToStream(tree, { onError: () => {} })) out += chunk;
  return stableIds(out);
}

const SERVER_RENDERERS = [
  ['string', (tree) => renderToString(tree)],
  ['hydratable', (tree) => renderToHydratableString(tree)],
  ['stream', streamed],
  ['async', async (tree) => (await renderToStringAsync(tree, undefined, { onError: () => {} })).body],
  ['document', (tree) => renderDocument({ default: () => tree }, {}, { onError: () => {} })],
];

const SERVER_ROUTES = {
  direct: (mod, signals) => mod.build(signals),
  nested: (mod, signals) => h('main', null, () => mod.build(signals)),
};

async function runServerParity({ cases, seed, makeCase, imports, coreNames, jsxHeader = '', hHeader = '', reset = () => {}, jsxPrelude = '', hPrelude = '' }) {
  const gen = makeGenerator(seed);
  const divergent = [];
  const specs = [];
  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const spec = makeCase(gen);
    specs.push(spec);
    let jsxMod;
    let hMod;
    try {
      jsxMod = await loadJSXServer(spec, imports, jsxHeader, jsxPrelude);
      hMod = await loadH(spec, imports, coreNames, hHeader, hPrelude);
    } catch (err) {
      divergent.push({ caseIndex, spec, detail: `load: ${err.constructor.name}: ${err.message.split('\n')[0]}` });
      continue;
    }
    reset();
    const jsxSignals = FIRST_VALUES.map((v, i) => signal(v, `ssrjsx${i}`));
    const hSignals = FIRST_VALUES.map((v, i) => signal(v, `ssrh${i}`));
    for (const [route, build] of Object.entries(SERVER_ROUTES)) {
      for (const [mode, render] of SERVER_RENDERERS) {
        let compiled;
        let expected;
        try {
          compiled = await render(build(jsxMod, jsxSignals));
          expected = await render(build(hMod, hSignals));
        } catch (err) {
          divergent.push({ caseIndex, spec, detail: `${route}/${mode} threw: ${err.code || err.constructor.name}: ${err.message.split('\n')[0]}` });
          continue;
        }
        if (unsalted(compiled) !== unsalted(expected)) {
          divergent.push({ caseIndex, spec, detail: `${route}/${mode}\n  compiled: ${compiled}\n  h()     : ${expected}` });
        }
      }
    }
  }
  return { divergent, specs };
}

// Each render salts its keyed lists' digests (<!--k:SALT:DIGESTS-->), so two
// renders compare by the shape of their keys: how many rows, and which of
// them share a key.
function unsalted(html) {
  return html.replace(/<!--k:[^:>]*:([^>]*)-->/g, (_, digests) => {
    const seen = new Map();
    const shape = (digests.match(/.{11}/g) || []).map((d) => {
      if (!seen.has(d)) seen.set(d, seen.size);
      return seen.get(d);
    });
    return `<!--k:${shape.join(',')}-->`;
  });
}

function reportServerDivergence(divergent, cases) {
  if (divergent.length === 0) return;
  const first = divergent[0];
  assert.fail(
    `${divergent.length} renders diverged over ${cases} trees.\n` +
    `first: case ${first.caseIndex}\n` +
    `  jsx src: ${emitJSX(first.spec)}\n` +
    `  h   src: ${emitH(first.spec)}\n` +
    `  ${first.detail}`,
  );
}

describe('server target parity (fuzz)', () => {
  it(`compiled server markup matches the h() tree for ${SSR_CASES} random trees`, async () => {
    const { divergent } = await runServerParity({
      cases: SSR_CASES,
      seed: SSR_SEED,
      makeCase: gen => makeSpec(gen, 3, SCALAR_SIGNALS, true),
    });
    reportServerDivergence(divergent, SSR_CASES);
  });

  it(`components, props and spreads server-render like the h() tree for ${SSR_COMPONENT_CASES} random trees`, async () => {
    const { divergent, specs } = await runServerParity({
      cases: SSR_COMPONENT_CASES,
      seed: COMPONENT_SEED,
      makeCase: gen => makeSpec(gen, 3, SCALAR_SIGNALS, true, true),
      imports: COMPONENTS.join(', '),
    });
    assertCorpusCovers(specs, ['explicit-then-spread', 'spread-then-explicit', 'spread-then-spread', 'multi-key-spread', 'accessor-prop']);
    reportServerDivergence(divergent, SSR_COMPONENT_CASES);
  });

  it(`imported bindings server-render like the h() tree for ${SSR_IMPORT_CASES} random trees`, async () => {
    const { resetImports } = await import(pathToFileURL(IMPORTS_FIXTURE).href);
    const { divergent } = await runServerParity({
      cases: SSR_IMPORT_CASES,
      seed: IMPORT_SEED,
      makeCase: gen => withImports(makeSpec(gen, 3, SCALAR_SIGNALS, true, true), gen),
      imports: COMPONENTS.join(', '),
      jsxHeader: importHeader(IMPORT_SPECIFIER),
      hHeader: importHeader(IMPORTS_FIXTURE),
      reset: resetImports,
    });
    reportServerDivergence(divergent, SSR_IMPORT_CASES);
  });

  it(`template layout, classList, SVG, void elements and lists server-render like the h() tree for ${SSR_LAYOUT_CASES} random trees`, async () => {
    const { divergent } = await runServerParity({
      cases: SSR_LAYOUT_CASES,
      seed: LAYOUT_SEED,
      makeCase: gen => makeLayoutSpec(gen, 3, false, true),
      jsxHeader: `import { computed } from 'what-framework';\n`,
      jsxPrelude: `const sel = computed(() => s[${SELECT_SIGNAL}]()); `,
    });
    reportServerDivergence(divergent, SSR_LAYOUT_CASES);
  });

  it(`islands server-render like the h(Island) tree for ${SSR_ISLAND_CASES} random trees`, async () => {
    const { divergent } = await runServerParity({
      cases: SSR_ISLAND_CASES,
      seed: ISLAND_SEED,
      makeCase: gen => makeIslandSpec(gen, SCALAR_SIGNALS),
      imports: 'Chart',
      coreNames: 'h, Fragment',
      hHeader: `import { _$Island as Island } from ${q(CORE_RENDER)};\n`,
    });
    reportServerDivergence(divergent, SSR_ISLAND_CASES);
  });
});

// --- server target: semantics ------------------------------------------------
//
// The arms above check the shapes a client tree is made of. This one checks
// what a server render does with them, against the same oracle (the h() tree
// the JSX lowers to), and adds what only a server render has to get right:
//
//   - values that mean something to the HTML parser, in every position: text,
//     plain, URL, class, style, aria and refused (srcdoc, outerHTML)
//     attributes, innerHTML, and the raw text of <style> and <script>;
//   - <For>, <Show>, <Switch>, .map() with rows that return markup, strings,
//     a conditional of both, or nothing; <Suspense>, <ErrorBoundary>,
//     <Portal>, a context provider, components, an async component;
//   - holes that throw, as reactive children and attributes and as plain
//     values inside a try/catch; JSX built in a loop and from a variable
//     reassigned after it was written;
//   - the order every expression runs in: each one that has a side effect
//     records it (fixtures/fuzz-semantics.js), and the two logs must match,
//     renderer by renderer, as the output must;
//   - every renderer: renderToString, renderToHydratableString,
//     renderToStream, renderToStringAsync and renderDocument.
//
// Two checks do not compare with h(), because they hold for any correct
// output: the parsed page has no element an injected value could have
// created, and the text of each <style> and <script> is the text the tree
// gave it.

const SEMANTICS_CASES = Number(process.env.WHAT_FUZZ_CASES) || 160;
const SEMANTICS_SEED = Number(process.env.WHAT_FUZZ_SEED) || 19283746;
const SEMANTICS_FIXTURE = path.resolve(__dirname, 'fixtures/fuzz-semantics.js');
const SEMANTICS_NAMES = 'L, log, boom, boomPlain, Register, readRegistry, resetSemantics, Boom, Slow, makeSlow, Ctx, ReadCtx, AsyncBox';

// The values a case hands its tree, four per case.
const HOSTILE = [
  '<img src=x onerror=alert(1)>', '</style><img src=x onerror=alert(2)>', '</script><img src=x onerror=alert(3)>',
  '<!--<script>', 'a & b < c > d "q" \'s\'', 'javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,x',
  '-->', 'x', '', 0, 7, true, false, null,
];
// The list signal: rows hold markup-significant strings.
const SEMANTIC_LIST = [['<img src=x onerror=alert(4)>', 'b'], ['b', '</li><img src=x onerror=alert(5)>', 'c']];
const SAFE_HTML = '<b>trusted</b>';
const RAW_STATIC = ['x y', 'a{b:c}', ' p "q" ', 'e > f'];
const SEM_ATTRS = ['title', 'data-x', 'class', 'href', 'src', 'style', 'aria-label', 'outerHTML', 'srcdoc', 'hidden', 'id'];

function makeSemAttrs(gen) {
  const { pick, int, rnd } = gen;
  const attrs = [];
  const used = new Set();
  for (let i = int(4); i > 0; i -= 1) {
    const name = pick(SEM_ATTRS);
    if (used.has(name)) continue;
    used.add(name);
    const roll = rnd();
    if (name === 'style' && roll < 0.3) attrs.push({ name, styleObject: int(4) });
    else if (roll < 0.35) attrs.push({ name, value: int(4) });
    else if (roll < 0.55) attrs.push({ name, reactive: int(4) });
    else if (roll < 0.65) attrs.push({ name, throws: true });
    else if (roll < 0.75) attrs.push({ name, log: `a${int(9)}` });
    else if (roll < 0.85) attrs.push({ name, logR: `ar${int(9)}` });
    else if (name !== 'outerHTML' && name !== 'srcdoc' && name !== 'href' && name !== 'src') attrs.push({ name, static: `v${int(3)}` });
  }
  if (rnd() < 0.12) attrs.push(rnd() < 0.5 ? { name: 'innerHTML', html: true } : { name: 'innerHTML', value: int(4) });
  return attrs;
}

let rawId = 0;

function makeSemSpec(gen, depth) {
  const { pick, int, rnd } = gen;
  const leaves = ['text', 'value', 'value', 'reactive', 'throw', 'log', 'logR'];
  const kinds = depth > 0
    ? [...leaves, 'element', 'element', 'element', 'raw', 'show', 'switch', 'for', 'map', 'mapPlain', 'boundary',
      'suspense', 'portal', 'context', 'register', 'fragment', 'component', 'held', 'async']
    : leaves;
  const kind = pick(kinds);
  const children = (n, d = depth - 1) => Array.from({ length: n }, () => makeSemSpec(gen, d));
  switch (kind) {
    case 'text': return { kind, text: pick(['A', 'b c', ' ']) };
    case 'value': return { kind, v: int(4) };
    case 'reactive': return { kind, v: int(4) };
    case 'throw': return { kind };
    case 'log': return { kind, tag: `p${int(9)}` };
    case 'logR': return { kind, tag: `r${int(9)}` };
    case 'raw': {
      const pieces = [];
      for (let i = 1 + int(3); i > 0; i -= 1) {
        const roll = rnd();
        if (roll < 0.3) pieces.push({ text: pick(RAW_STATIC) });
        else if (roll < 0.6) pieces.push({ v: int(4) });
        else if (roll < 0.85) pieces.push({ reactive: int(4) });
        else pieces.push({ throws: true });
      }
      return { kind, tag: pick(['style', 'script']), id: rawId++, pieces };
    }
    case 'show': return { kind, fn: rnd() < 0.25, children: children(1 + int(3), Math.min(depth - 1, 1)) };
    case 'switch': return { kind, a: children(1 + int(2), 0), b: children(1, 0) };
    case 'for': return { kind, keyed: rnd() < 0.5, row: pick(['li', 'string', 'cond', 'null', 'li']) };
    case 'map': return { kind, block: rnd() < 0.5 };
    case 'mapPlain': return { kind };
    case 'boundary': return { kind, children: [...children(1 + int(2)), ...(rnd() < 0.4 ? [{ kind: 'boom' }] : [])] };
    case 'suspense': return { kind, children: [...children(int(2)), pick([{ kind: 'slow' }, { kind: 'slowRead' }, { kind: 'logR', tag: 'rs' }])] };
    case 'portal': return { kind };
    case 'context': return { kind, v: int(4) };
    case 'register': return { kind };
    case 'fragment': return { kind, children: children(1 + int(3)) };
    case 'component': return { kind, comp: pick(['Box', 'Wrap']), children: children(int(3)) };
    case 'held': return { kind, which: pick(['loop', 'held', 'tryCatch']) };
    case 'async': return rnd() < 0.3 ? { kind } : { kind: 'value', v: int(4) };
    default: return { kind: 'element', tag: pick(['div', 'span', 'section']), attrs: makeSemAttrs(gen), children: children(int(4)) };
  }
}

const semR = (v) => `s[0]() ? V[${v}] : V[${(v + 1) % 4}]`;

function semAttrJSX(a) {
  if (a.html) return ` innerHTML={{ __html: ${q(SAFE_HTML)} }}`;
  if (a.styleObject !== undefined) return ` style={{ color: V[${a.styleObject}] }}`;
  if (a.value !== undefined) return ` ${a.name}={V[${a.value}]}`;
  if (a.reactive !== undefined) return ` ${a.name}={${semR(a.reactive)}}`;
  if (a.throws) return ` ${a.name}={boom()}`;
  if (a.log) return ` ${a.name}={log(${q(a.log)})}`;
  if (a.logR) return ` ${a.name}={s[0]() ? log(${q(a.logR)}) : ''}`;
  return ` ${a.name}=${q(a.static)}`;
}

function semAttrH(a) {
  if (a.html) return `"innerHTML": { __html: ${q(SAFE_HTML)} }`;
  if (a.styleObject !== undefined) return `"style": { color: V[${a.styleObject}] }`;
  if (a.value !== undefined) return `${q(a.name)}: V[${a.value}]`;
  if (a.reactive !== undefined) return `${q(a.name)}: () => ${semR(a.reactive)}`;
  if (a.throws) return `${q(a.name)}: () => boom()`;
  if (a.log) return `${q(a.name)}: log(${q(a.log)})`;
  if (a.logR) return `${q(a.name)}: () => s[0]() ? log(${q(a.logR)}) : ''`;
  return `${q(a.name)}: ${q(a.static)}`;
}

const ROW_JSX = { li: '<li>{ITEM}</li>', string: 'ITEM', cond: `ITEM === 'b' ? <li>{ITEM}</li> : ITEM`, null: 'null' };
// HOLE is ITEM as a child: a keyed row's `{item()}` is a call, which the
// compiler auto-thunks, so its h() spelling is the thunk.
const ROW_H = { li: 'h("li", null, HOLE)', string: 'ITEM', cond: `ITEM === 'b' ? h("li", null, HOLE) : ITEM`, null: 'null' };

function semJSX(spec) {
  const kids = (list) => list.map(semJSX).join('');
  switch (spec.kind) {
    case 'text': return spec.text;
    case 'value': return `{V[${spec.v}]}`;
    case 'reactive': return `{${semR(spec.v)}}`;
    case 'throw': return '{boom()}';
    case 'log': return `{log(${q(spec.tag)})}`;
    case 'logR': return `{s[0]() ? log(${q(spec.tag)}) : log(${q(spec.tag)})}`;
    case 'raw': return `<${spec.tag} data-raw="${spec.id}">${spec.pieces.map((p) => (p.text !== undefined ? `{${q(p.text)}}`
      : p.v !== undefined ? `{V[${p.v}]}` : p.reactive !== undefined ? `{${semR(p.reactive)}}` : '{boom()}')).join('')}</${spec.tag}>`;
    case 'show': return spec.fn
      ? '<Show when={s[0]()} fallback={<i>fb</i>}>{(v) => <b>{String(v)}</b>}</Show>'
      : `<Show when={s[0]()} fallback={<i>fb</i>}>${kids(spec.children)}<>f{V[0]}</></Show>`;
    case 'switch': return `<Switch fallback={<i>none</i>}><Match when={s[0]()}>${kids(spec.a)}</Match><Match when={s[1]()}>${kids(spec.b)}<b>B</b></Match></Switch>`;
    case 'for': {
      const item = spec.keyed ? 'item()' : 'item';
      return `<For each={s[3]}${spec.keyed ? ' key={(x) => x}' : ''} fallback={<i>empty</i>}>{(item, i) => ${ROW_JSX[spec.row].replaceAll('ITEM', item)}}</For>`;
    }
    case 'map': return spec.block
      ? `{s[3]().map((item) => { if (item === 'b') return item; if (item === 'c') return null; return <li>{item}</li>; })}`
      : '{s[3]().map((item) => <li title={item}>{item}</li>)}';
    case 'mapPlain': return '{A.map((item) => <li>{item}</li>)}';
    case 'boundary': return `<ErrorBoundary fallback={<i>caught</i>}>${kids(spec.children)}</ErrorBoundary>`;
    case 'boom': return '<Boom />';
    case 'suspense': return `<Suspense fallback={<i>wait</i>}>${kids(spec.children)}</Suspense>`;
    case 'slow': return '<Slow />';
    case 'slowRead': return '{slow()}';
    case 'portal': return '<Portal><b>portal</b></Portal>';
    case 'context': return `<Ctx.Provider value={V[${spec.v}]}><ReadCtx />{useContext(Ctx)}</Ctx.Provider>`;
    case 'register': return '<Register />{readRegistry(1)}{s[0]() ? readRegistry(2) : readRegistry(2)}';
    case 'fragment': return `<>${kids(spec.children)}</>`;
    case 'component': return spec.children.length ? `<${spec.comp}>${kids(spec.children)}</${spec.comp}>` : `<${spec.comp} />`;
    case 'held': return `{${spec.which}}`;
    case 'async': return '<AsyncBox />';
    default: return `<${spec.tag}${spec.attrs.map(semAttrJSX).join('')}>${kids(spec.children)}</${spec.tag}>`;
  }
}

function semH(spec) {
  const kids = (list) => list.map(semH).join(', ');
  const content = (list) => (list.length === 1 ? semH(list[0]) : `[${kids(list)}]`);
  switch (spec.kind) {
    case 'text': return q(spec.text);
    case 'value': return `V[${spec.v}]`;
    case 'reactive': return `(() => ${semR(spec.v)})`;
    case 'throw': return '(() => boom())';
    case 'log': return `log(${q(spec.tag)})`;
    case 'logR': return `(() => s[0]() ? log(${q(spec.tag)}) : log(${q(spec.tag)}))`;
    case 'raw': return `h(${q(spec.tag)}, { "data-raw": "${spec.id}" }, ${spec.pieces.map((p) => (p.text !== undefined ? q(p.text)
      : p.v !== undefined ? `V[${p.v}]` : p.reactive !== undefined ? `(() => ${semR(p.reactive)})` : '(() => boom())')).join(', ')})`;
    case 'show': return spec.fn
      // String(v) converts a value nobody proved static: wrapped.
      ? '(() => { const v = s[0](); return v ? ((v) => h("b", null, () => String(v)))(v) : h("i", null, "fb"); })'
      : `(() => { const v = s[0](); return v ? [${kids(spec.children)}, h(Fragment, null, "f", V[0])] : h("i", null, "fb"); })`;
    case 'switch': return `(() => s[0]() ? ${content(spec.a)} : s[1]() ? [${kids(spec.b)}, h("b", null, "B")] : h("i", null, "none"))`;
    case 'for': {
      const row = ROW_H[spec.row].replaceAll('HOLE', spec.keyed ? '() => item()' : 'item').replaceAll('ITEM', spec.keyed ? 'item()' : 'item');
      const map = spec.keyed ? `list.map((x, i) => ((item) => ${row})(() => x))` : `list.map((item, i) => ${row})`;
      return `(() => { const list = s[3](); if (!list || list.length === 0) return h("i", null, "empty"); return ${map}; })`;
    }
    case 'map': return spec.block
      ? `(() => s[3]().map((item) => { if (item === 'b') return item; if (item === 'c') return null; return h("li", null, item); }))`
      : '(() => s[3]().map((item) => h("li", { title: item }, item)))';
    // A, a parameter of build(), is an array nobody proved static (its
    // map could be any object's): the compiler wraps the call.
    case 'mapPlain': return '(() => A.map((item) => h("li", null, item)))';
    case 'boundary': return `h(ErrorBoundary, { fallback: h("i", null, "caught") }, ${kids(spec.children)})`;
    case 'boom': return 'h(Boom, null)';
    case 'suspense': return `h(Suspense, { fallback: h("i", null, "wait") }, ${kids(spec.children) || 'null'})`;
    case 'slow': return 'h(Slow, null)';
    case 'slowRead': return '(() => slow())';
    case 'portal': return 'h(Portal, null, h("b", null, "portal"))';
    case 'context': return `h(Ctx.Provider, { value: V[${spec.v}] }, h(ReadCtx, null), () => useContext(Ctx))`;
    case 'register': return 'h(Register, null), readRegistry(1), (() => s[0]() ? readRegistry(2) : readRegistry(2))';
    case 'fragment': return `h(Fragment, null, ${kids(spec.children)})`;
    case 'component': return `h(${spec.comp}, null${spec.children.length ? `, ${kids(spec.children)}` : ''})`;
    case 'held': return spec.which;
    case 'async': return 'h(AsyncBox, null)';
    default: return `h(${q(spec.tag)}, {${spec.attrs.map(semAttrH).join(', ')}}${spec.children.length ? `, ${kids(inElement(spec.children))}` : ''})`;
  }
}

// JSX built before the tree: in a loop with a `var`, from a variable written
// again afterwards, and inside a try/catch whose hole throws.
const SEM_PRELUDE_JSX = `const slow = makeSlow();
  const loop = []; for (var i = 0; i < 3; i++) loop.push(<b>{i}</b>);
  let label = V[0]; const held = <u>{label}</u>; label = 'changed';
  let tryCatch; try { tryCatch = <s>{boomPlain('t')}</s>; } catch (e) { tryCatch = <s>caught</s>; }
  `;
const SEM_PRELUDE_H = `const slow = makeSlow();
  const loop = []; for (var i = 0; i < 3; i++) loop.push(h("b", null, i));
  let label = V[0]; const held = h("u", null, label); label = 'changed';
  let tryCatch; try { tryCatch = h("s", null, boomPlain('t')); } catch (e) { tryCatch = h("s", null, "caught"); }
  `;

async function loadSemantics(spec) {
  const fixture = `import { ${SEMANTICS_NAMES} } from ${q(SEMANTICS_FIXTURE)};\nimport { Box, Wrap } from ${q(FIXTURE)};\n`;
  const jsxSource = `${fixture}import { For, Show, Switch, Match, Suspense, ErrorBoundary, Portal, useContext } from 'what-framework';\n`
    + `export function build(s, V, A) { ${SEM_PRELUDE_JSX}return ${semJSX(spec)}; }`;
  const hSource = `import { h, Fragment, Suspense, ErrorBoundary, Portal, useContext } from ${q(CORE_INDEX)};\n${fixture}`
    + `export function build(s, V, A) { ${SEM_PRELUDE_H}return ${semH(spec)}; }`;
  return [await loadModule(localize(compileSSR(jsxSource))), await loadModule(hSource)];
}

// The text each <style> / <script> holds, from the spec: what the client sets
// as its textContent.
function rawTexts(spec, V, first, out = new Map()) {
  if (!spec || typeof spec !== 'object') return out;
  if (spec.kind === 'raw') {
    const text = (v) => (v == null || typeof v === 'boolean' ? '' : String(v));
    out.set(String(spec.id), spec.pieces.map((p) => (p.text !== undefined ? p.text
      : p.v !== undefined ? text(V[p.v]) : p.reactive !== undefined ? text(first[0] ? V[p.reactive] : V[(p.reactive + 1) % 4]) : '')).join(''));
  }
  for (const key of ['children', 'a', 'b']) if (Array.isArray(spec[key])) spec[key].forEach((child) => rawTexts(child, V, first, out));
  return out;
}

// What any correct output satisfies, whatever h() renders: no element a value
// could have injected, no refused attribute, and raw text that decodes to the
// text the tree gave it.
function checkPage(html, expectedRaw) {
  const doc = new window.DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html');
  const problems = [];
  if (doc.querySelector('img[onerror]')) problems.push('an injected <img onerror> was parsed');
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of el.attributes) if (attr.name === 'srcdoc' || attr.name === 'outerhtml') problems.push(`a ${attr.name} attribute was written`);
  }
  for (const el of doc.querySelectorAll('[data-raw]')) {
    const expected = expectedRaw.get(el.getAttribute('data-raw'));
    let text = el.textContent.replace(/<\\\//g, '</');
    if (el.localName === 'script') text = text.replace(/\\u003C!--/g, '<!--');
    if (expected !== undefined && text !== expected) problems.push(`<${el.localName}> holds ${JSON.stringify(el.textContent)}, not ${JSON.stringify(expected)}`);
  }
  return problems;
}

function semShapes(spec, found = new Set()) {
  if (!spec || typeof spec !== 'object') return found;
  found.add(spec.kind === 'for' ? `for:${spec.row}` : spec.kind === 'held' ? `held:${spec.which}` : spec.kind === 'raw' ? `raw:${spec.tag}` : spec.kind);
  for (const a of spec.attrs || []) {
    found.add(`attr:${a.name}`);
    if (a.throws) found.add('attr:throws');
    if (a.logR) found.add('attr:reactive-log');
  }
  for (const key of ['children', 'a', 'b']) if (Array.isArray(spec[key])) spec[key].forEach((child) => semShapes(child, found));
  return found;
}

async function runSemantics({ cases, seed }) {
  const gen = makeGenerator(seed);
  const fixture = await import(pathToFileURL(SEMANTICS_FIXTURE).href);
  const divergent = [];
  const specs = [];
  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const spec = { kind: 'element', tag: 'div', attrs: makeSemAttrs(gen), children: Array.from({ length: 1 + gen.int(4) }, () => makeSemSpec(gen, 3)) };
    const V = Array.from({ length: 4 }, () => gen.pick(HOSTILE));
    const A = ['x', '<img src=x onerror=alert(6)>'];
    specs.push(spec);
    let jsxMod;
    let hMod;
    try {
      [jsxMod, hMod] = await loadSemantics(spec);
    } catch (err) {
      divergent.push({ caseIndex, spec, detail: `load: ${err.code || err.constructor.name}: ${err.message.split('\n')[0]}` });
      continue;
    }
    const first = [true, false, 'x', SEMANTIC_LIST[0]];
    const expectedRaw = rawTexts(spec, V, first);
    for (const [mode, render] of SERVER_RENDERERS) {
      const results = [];
      for (const mod of [jsxMod, hMod]) {
        fixture.resetSemantics();
        const signals = first.map((v, i) => signal(v, `sem${i}`));
        let html;
        try {
          html = await render(mod.build(signals, V, A));
        } catch (err) {
          html = `THREW ${err instanceof Error ? err.message.split('\n')[0] : typeof err.then === 'function' ? 'a thenable' : String(err)}`;
        }
        results.push({ html, log: fixture.L.join(' ') });
      }
      const [compiled, expected] = results;
      // A compiled keyed <For> writes its rows' keys (what-server rowKeys);
      // the h() program it stands for hands its rows over as plain values,
      // which carry none. Everything else is compared as written.
      if (compiled.html.replace(/<!--k(?::[^>]*|!)-->/g, '') !== expected.html) {
        divergent.push({ caseIndex, spec, detail: `${mode}\n  compiled: ${compiled.html}\n  h()     : ${expected.html}` });
      } else if (compiled.log !== expected.log) {
        divergent.push({ caseIndex, spec, detail: `${mode}: evaluation order\n  compiled: ${compiled.log}\n  h()     : ${expected.log}` });
      } else if (!compiled.html.startsWith('THREW')) {
        const problems = checkPage(compiled.html, expectedRaw);
        if (problems.length) divergent.push({ caseIndex, spec, detail: `${mode}: ${problems.join('; ')}\n  output: ${compiled.html}` });
      }
    }
  }
  return { divergent, specs };
}

describe('server target semantics (fuzz)', () => {
  it(`hostile values, control flow, boundaries, throws and evaluation order match the h() tree in every renderer for ${SEMANTICS_CASES} random trees`, async () => {
    const { divergent, specs } = await runSemantics({ cases: SEMANTICS_CASES, seed: SEMANTICS_SEED });
    const found = new Set();
    specs.forEach((spec) => semShapes(spec, found));
    const required = [
      'raw:style', 'raw:script', 'show', 'switch', 'for:li', 'for:string', 'for:cond', 'for:null', 'map', 'mapPlain',
      'boundary', 'boom', 'suspense', 'slow', 'slowRead', 'portal', 'context', 'register', 'fragment', 'component',
      'held:loop', 'held:held', 'held:tryCatch', 'async', 'throw', 'log', 'logR', 'value', 'reactive',
      ...SEM_ATTRS.map((name) => `attr:${name}`), 'attr:innerHTML', 'attr:throws', 'attr:reactive-log',
    ];
    assert.deepEqual(required.filter((shape) => !found.has(shape)), [], 'the generated corpus never produced these shapes');
    if (divergent.length) {
      const first = divergent[0];
      assert.fail(`${divergent.length} renders diverged over ${SEMANTICS_CASES} trees.\nfirst: case ${first.caseIndex}\n  jsx src: ${semJSX(first.spec)}\n  h   src: ${semH(first.spec)}\n  ${first.detail}`);
    }
  });

  // An island's props are serialized for the browser; JSX in one is refused on
  // both targets (ERR_JSX_ISLAND_PROP), never sent as an empty object.
  it('refuses JSX as an island prop on both targets, wherever it is in the value', () => {
    const gen = makeGenerator(SEMANTICS_SEED);
    for (let i = 0; i < 40; i += 1) {
      const element = semJSX({ kind: 'element', tag: gen.pick(['b', 'i']), attrs: [], children: [makeSemSpec(gen, 1)] });
      const value = gen.pick([`{${element}}`, `{ok ? ${element} : null}`, `{[${element}]}`, `{{ icon: ${element} }}`]);
      for (const generate of ['dom', 'ssr']) {
        assert.throws(
          () => transformSync(`const a = <Chart client:load icon=${value} />;`, { filename: 'island.jsx', plugins: [[babelPlugin, { generate }]], parserOpts: { plugins: ['jsx'] }, configFile: false, babelrc: false }),
          (e) => e.code === 'ERR_JSX_ISLAND_PROP' && /"icon"/.test(e.message),
          `${generate}: icon=${value}`,
        );
      }
    }
  });
});

// --- client target: control-flow children --------------------------------------
//
// <Show> and <Switch> arms are content: text, expressions, elements and
// fragments, in order, unless the only child is a render function. Compared
// with the h() tree they lower to, as the arms above are.

function makeFlowSpec(gen) {
  const { int, rnd } = gen;
  const arm = () => Array.from({ length: 1 + int(3) }, () => (rnd() < 0.25
    ? { kind: 'fragment', children: Array.from({ length: 1 + int(2) }, () => makeSpec(gen, 0, SCALAR_SIGNALS)) }
    : makeSpec(gen, 1, SCALAR_SIGNALS)));
  const flow = rnd() < 0.6
    ? { kind: 'show', signal: int(SCALAR_SIGNALS), fn: rnd() < 0.2, children: arm() }
    : { kind: 'switch', a: { signal: int(SCALAR_SIGNALS), children: arm() }, b: { signal: int(SCALAR_SIGNALS), children: arm() } };
  return { kind: 'element', tag: 'div', attrs: [], children: [{ kind: 'text', text: 'A' }, flow, { kind: 'text', text: 'B' }] };
}

function flowJSX(spec) {
  if (spec.kind === 'show') {
    return spec.fn
      ? `<Show when={s[${spec.signal}]()} fallback={<i>fb</i>}>{(v) => <b>{String(v)}</b>}</Show>`
      : `<Show when={s[${spec.signal}]()} fallback={<i>fb</i>}>${spec.children.map(emitJSX).join('')}</Show>`;
  }
  if (spec.kind === 'switch') {
    return `<Switch fallback={<i>none</i>}><Match when={s[${spec.a.signal}]()}>${spec.a.children.map(emitJSX).join('')}</Match>`
      + `<Match when={s[${spec.b.signal}]()}>${spec.b.children.map(emitJSX).join('')}</Match></Switch>`;
  }
  if (spec.kind === 'element') return `<${spec.tag}>${spec.children.map(flowJSX).join('')}</${spec.tag}>`;
  return emitJSX(spec);
}

function flowH(spec) {
  const content = (list) => (list.length === 1 ? emitH(list[0]) : `[${list.map(emitH).join(', ')}]`);
  if (spec.kind === 'show') {
    return spec.fn
      ? `(() => { const v = s[${spec.signal}](); return v ? h("b", null, String(v)) : h("i", null, "fb"); })`
      : `(() => s[${spec.signal}]() ? ${content(spec.children)} : h("i", null, "fb"))`;
  }
  if (spec.kind === 'switch') {
    return `(() => s[${spec.a.signal}]() ? ${content(spec.a.children)} : s[${spec.b.signal}]() ? ${content(spec.b.children)} : h("i", null, "none"))`;
  }
  if (spec.kind === 'element') return `h(${q(spec.tag)}, {}, ${spec.children.map(flowH).join(', ')})`;
  return emitH(spec);
}

const FLOW_CASES = Number(process.env.WHAT_FUZZ_CASES) || 150;
const FLOW_SEED = Number(process.env.WHAT_FUZZ_SEED) || 4242;

describe('client target control flow (fuzz)', () => {
  before(async () => {
    ({ mount: mountFn } = await import('../../core/src/dom.js'));
  });

  it(`<Show> and <Switch> content matches the h() tree for ${FLOW_CASES} random trees`, async () => {
    const gen = makeGenerator(FLOW_SEED);
    const divergent = [];
    for (let caseIndex = 0; caseIndex < FLOW_CASES; caseIndex += 1) {
      const spec = makeFlowSpec(gen);
      const jsxMod = await loadModule(localize(compileJSX(`import { Show, Switch, Match } from 'what-framework';\nexport function build(s) { return ${flowJSX(spec)}; }`)));
      const hMod = await loadModule(`import { h, Fragment } from ${q(CORE_INDEX)};\nexport function build(s) { return ${flowH(spec)}; }`);
      const jsxSignals = FIRST_VALUES.map((v, i) => signal(v, `fj${i}`));
      const hSignals = FIRST_VALUES.map((v, i) => signal(v, `fh${i}`));
      const jsxHost = document.createElement('div');
      const hHost = document.createElement('div');
      document.body.append(jsxHost, hHost);
      try {
        mountInto(jsxMod.build(jsxSignals), jsxHost);
        mountInto(hMod.build(hSignals), hHost);
        flushSync();
        for (const phase of ['initial', 'after write']) {
          const [a, b] = [serialize(jsxHost, [], true).join(''), serialize(hHost, [], true).join('')];
          if (a !== b) {
            divergent.push({ caseIndex, phase, a, b, spec });
            break;
          }
          SECOND_VALUES.forEach((v, i) => { jsxSignals[i](v); hSignals[i](v); });
          flushSync();
        }
      } finally {
        jsxHost.remove();
        hHost.remove();
      }
    }
    if (divergent.length) {
      const first = divergent[0];
      assert.fail(`${divergent.length}/${FLOW_CASES} trees diverged.\nfirst: case ${first.caseIndex} (${first.phase})\n  jsx src: ${flowJSX(first.spec)}\n  h   src: ${flowH(first.spec)}\n  jsx dom: ${first.a}\n  h   dom: ${first.b}`);
    }
  });
});
