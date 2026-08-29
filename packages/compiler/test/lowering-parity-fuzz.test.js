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

const { signal, flushSync } = await import('../../core/src/reactive.js');

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

// Signals 0..2 hold scalars. Signal 3 always holds an array and exists so a
// `list` child has something keyed to reconcile: the second value reorders,
// grows and drops entries all at once, which is what moves a keyed list's rows
// around relative to their siblings.
const LIST_SIGNAL = 3;
const FIRST_VALUES = ['x', 0, '', ['a', 'b']];
const SECOND_VALUES = ['ZZ', 9, 'later', ['b', 'c', 'd']];
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
function makePropItems(gen, signalCount) {
  const { pick, int, rnd } = gen;
  const items = [];
  const count = int(5);
  for (let i = 0; i < count; i += 1) {
    if (rnd() < 0.35) {
      const entries = [];
      const used = new Set();
      const entryCount = 1 + int(3);
      for (let e = 0; e < entryCount; e += 1) {
        const name = pick(PROP_NAMES);
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
    const name = pick(PROP_NAMES);
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
      items: makePropItems(gen, signalCount),
      children: Array.from({ length: int(3) }, () => makeSpec(gen, 1, signalCount)),
    }],
  };
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
    return ` ${item.name}=${q(item.static)}`;
  }).join('');
}

function emitPropsH(items) {
  return items.map(item => {
    if (item.spread) return `...{ ${spreadEntries(item.spread)} }`;
    if (item.read !== undefined) return `${q(item.name)}: s[${item.read}]()`;
    if (item.accessor !== undefined) return `${q(item.name)}: s[${item.accessor}]`;
    return `${q(item.name)}: ${q(item.static)}`;
  }).join(', ');
}

function emitJSX(spec) {
  switch (spec.kind) {
    case 'text': return spec.text === '' ? '{""}' : `{${q(spec.text)}}`;
    case 'read': return `{s[${spec.signal}]()}`;
    case 'thunk': return `{() => s[${spec.signal}]()}`;
    case 'cond':
      return `{() => s[${spec.signal}]() ? <b>${emitJSX(spec.then)}</b> : <i>${emitJSX(spec.else)}</i>}`;
    case 'fragment':
      return `<>${spec.children.map(emitJSX).join('')}</>`;
    case 'list':
      return `{() => s[${LIST_SIGNAL}]().map(v => <li key={v}>{v}</li>)}`;
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
        return a.static !== undefined
          ? ` ${a.name}=${q(a.static)}`
          : ` ${a.name}={s[${a.signal}]()}`;
      }).join('');
      return `<${spec.tag}${attrs}>${spec.children.map(emitJSX).join('')}</${spec.tag}>`;
    }
  }
}

function emitH(spec) {
  switch (spec.kind) {
    case 'text': return q(spec.text);
    // Identical on purpose: `read` and `thunk` are two JSX spellings of one
    // tree, and this is the tree. See the note at the top of the file.
    case 'read': return `(() => s[${spec.signal}]())`;
    case 'thunk': return `(() => s[${spec.signal}]())`;
    case 'cond':
      return `(() => s[${spec.signal}]() ? h("b", {}, ${emitH(spec.then)}) : h("i", {}, ${emitH(spec.else)}))`;
    case 'fragment':
      return `h(Fragment, {}, ${spec.children.map(emitH).join(', ') || 'null'})`;
    case 'list':
      return `(() => s[${LIST_SIGNAL}]().map(v => h("li", { key: v }, v)))`;
    // `<Box a {...s} b>kid</Box>` is one spelling of `h(Box, { a, ...s, b }, kid)`.
    //
    // The merge is written as an object literal with a spread in it, NOT as the
    // Object.assign the compiler happens to emit. Those evaluate identically,
    // but only one of them is the oracle: `{ a, ...s, b }` is the language's own
    // definition of what the JSX means, while Object.assign is the current
    // implementation. Writing the implementation into the oracle would make the
    // comparison agree with whatever the compiler does, which is the one thing a
    // differential test must never do.
    case 'component': {
      const props = emitPropsH(spec.items);
      const kids = spec.children.map(emitH).join(', ');
      return `h(${spec.comp}, {${props}}${kids ? `, ${kids}` : ''})`;
    }
    // An island IS a component: the directive only decides WHEN it hydrates.
    // `component` and `mode` come from the tag and the directive rather than
    // from the caller, so they are written LAST, which is also the rule that
    // keeps a caller from reaching the hydration machinery by spreading a key
    // called `component` over it.
    case 'island': {
      const props = emitPropsH(spec.items);
      const kids = spec.children.map(emitH).join(', ');
      const merged = `{${props}${props ? ', ' : ''}"component": Chart, "mode": "load"}`;
      return `h(Island, ${merged}${kids ? `, ${kids}` : ''})`;
    }
    default: {
      const props = spec.attrs.map(a => {
        if (a.spread) return `...{ ${q(a.spread.name)}: ${q(a.spread.value)} }`;
        return a.static !== undefined
          ? `${q(a.name)}: ${q(a.static)}`
          : `${q(a.name)}: (() => s[${a.signal}]())`;
      }).join(', ');
      const kids = spec.children.map(emitH).join(', ');
      return `h(${q(spec.tag)}, {${props}}${kids ? `, ${kids}` : ''})`;
    }
  }
}

// --- module loading ---------------------------------------------------------

let moduleId = 0;

function localize(code) {
  return code
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

function loadJSX(spec, imports = '') {
  const source = `${fixtureImport(imports)}export function build(s) { return ${emitJSX(spec)}; }`;
  return loadModule(localize(compileJSX(source)));
}

function loadH(spec, imports = '', coreNames = 'h, Fragment') {
  return loadModule(
    `import { ${coreNames} } from ${q(CORE_INDEX)};\n` +
    fixtureImport(imports) +
    `export function build(s) { return ${emitH(spec)}; }`,
  );
}

// --- observation ------------------------------------------------------------

// What is observable to a user: elements, their attributes, and text. Comment
// markers are the compiler's bookkeeping and the h() path does not need the same
// ones, so comparing raw innerHTML would compare implementations rather than
// behaviour. Empty text nodes are likewise invisible.
function serialize(node, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      if (child.data !== '') out.push(`#${child.data}`);
      continue;
    }
    if (child.nodeType === 1) {
      const attrs = [...child.attributes]
        .map(a => `${a.name}=${a.value}`)
        .sort()
        .join(' ');
      out.push(`<${child.localName}${attrs ? ` ${attrs}` : ''}>`);
      serialize(child, out);
      out.push(`</${child.localName}>`);
      continue;
    }
    serialize(child, out);
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
async function runParity({ cases, seed, makeCase, imports, coreNames, needsSettle = false }) {
  const gen = makeGenerator(seed);
  const divergent = [];
  const specs = [];

  for (let caseIndex = 0; caseIndex < cases; caseIndex += 1) {
    const spec = makeCase(gen);
    specs.push(spec);

    let jsxMod;
    let hMod;
    try {
      jsxMod = await loadJSX(spec, imports);
      hMod = await loadH(spec, imports, coreNames);
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

      const before = [serialize(jsxHost).join(''), serialize(hHost).join('')];
      if (before[0] !== before[1]) {
        divergent.push({ caseIndex, phase: 'initial', jsx: before[0], h: before[1], spec });
        continue;
      }

      // The reactive half of the contract: a write must move both trees the
      // same way. A lowering that renders correctly once and then updates the
      // wrong node is the bug class this half exists for.
      SECOND_VALUES.forEach((v, i) => { jsxSignals[i](v); hSignals[i](v); });
      flushSync();
      if (needsSettle) { await settle(); flushSync(); }

      const after = [serialize(jsxHost).join(''), serialize(hHost).join('')];
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
      coreNames: 'h, Fragment, Island',
      needsSettle: true,
    });

    assertCorpusCovers(specs, [
      'explicit-then-spread', 'spread-then-explicit', 'spread-then-spread',
      'multi-key-spread', 'accessor-prop', 'hyphenated-prop',
    ]);
    reportDivergence(divergent, ISLAND_CASES);
  });
});
