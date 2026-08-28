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

// Signals 0..2 hold scalars. Signal 3 always holds an array and exists so a
// `list` child has something keyed to reconcile: the second value reorders,
// grows and drops entries all at once, which is what moves a keyed list's rows
// around relative to their siblings.
const LIST_SIGNAL = 3;
const FIRST_VALUES = ['x', 0, '', ['a', 'b']];
const SECOND_VALUES = ['ZZ', 9, 'later', ['b', 'c', 'd']];
const SCALAR_SIGNALS = 3;

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

// A spec is a plain object so both emitters read the SAME tree. Nothing about
// the two sources can drift, because neither is written by hand.
function makeSpec(gen, depth, signalCount, forceElement = false) {
  const { pick, int, rnd } = gen;
  const kinds = depth > 0
    ? ['text', 'read', 'thunk', 'element', 'element', 'cond', 'fragment', 'list']
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
      then: makeSpec(gen, depth - 1, signalCount),
      else: makeSpec(gen, depth - 1, signalCount),
    };
  }
  if (kind === 'fragment') {
    const n = 1 + int(3);
    return { kind, children: Array.from({ length: n }, () => makeSpec(gen, depth - 1, signalCount)) };
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
    children: Array.from({ length: childCount }, () => makeSpec(gen, depth - 1, signalCount)),
  };
}

const q = s => JSON.stringify(s);

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

function loadJSX(spec) {
  const source = `export function build(s) { return ${emitJSX(spec)}; }`;
  const compiled = transformSync(source, {
    filename: 'fuzz.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
  return loadModule(localize(compiled));
}

function loadH(spec) {
  return loadModule(
    `import { h, Fragment } from ${q(CORE_INDEX)};\n` +
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

describe('compiler lowering parity (fuzz)', () => {
  before(async () => {
    ({ mount: mountFn } = await import('../../core/src/dom.js'));
  });

  it(`compiled JSX matches the h() tree for ${CASES} random trees`, async () => {
    const gen = makeGenerator(SEED);
    const divergent = [];

    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const spec = makeSpec(gen, 3, SCALAR_SIGNALS, true);

      const jsxMod = await loadJSX(spec);
      const hMod = await loadH(spec);

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

        const after = [serialize(jsxHost).join(''), serialize(hHost).join('')];
        if (after[0] !== after[1]) {
          divergent.push({ caseIndex, phase: 'after write', jsx: after[0], h: after[1], spec });
        }
      } finally {
        jsxHost.remove();
        hHost.remove();
      }
    }

    if (divergent.length) {
      const first = divergent[0];
      assert.fail(
        `${divergent.length}/${CASES} trees diverged.\n` +
        `first: case ${first.caseIndex} (${first.phase})\n` +
        `  jsx src: ${emitJSX(first.spec)}\n` +
        `  h   src: ${emitH(first.spec)}\n` +
        `  jsx dom: ${first.jsx}\n` +
        `  h   dom: ${first.h}`,
      );
    }
  });
});
