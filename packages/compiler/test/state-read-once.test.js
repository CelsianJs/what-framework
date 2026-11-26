// ERR_STATE_READ_ONCE: state a component reads once in its body, where
// React would read it on every render. Two shapes ported from React run and
// silently stick: a return decided by the component's own state, and a value
// derived from it in the body and shown in JSX. Each is reported once, at
// build time, in development; what reads state where it renders, or reads it
// inside a function, is not.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';

let file = 0;
function warnings(source, options = {}) {
  const warn = console.warn;
  const seen = [];
  console.warn = (...args) => seen.push(args.join(' '));
  try {
    compileJSX(source, { filename: `/proj/src/state-${file++}.jsx`, ...options });
  } finally {
    console.warn = warn;
  }
  return seen.filter((w) => w.includes('ERR_STATE_READ_ONCE'));
}

const HOOKS = `import { useState, useSignal, useMemo, computed, signal, untrack, useEffect, Show } from 'what-framework';\n`;

describe('ERR_STATE_READ_ONCE: a return decided by the component\'s state', () => {
  for (const [shape, body, read] of [
    ['an early return', `const [loading, setLoading] = useState(true); if (loading()) return <p>Loading</p>; return <ul />;`, 'loading()'],
    ['a returned ternary', `const open = useSignal(false); return open() ? <dialog /> : null;`, 'open()'],
    ['a returned logical', `const [items] = useState([]); return items().length > 0 && <ul />;`, 'items()'],
    ['a negated read', `const [ready] = useState(false); if (!ready()) return null; return <b />;`, 'ready()'],
    ['a computed', `const n = signal(0); const big = computed(() => n() > 5); if (!big()) return null; return <b />;`, 'big()'],
  ]) {
    it(`reports ${shape}`, () => {
      const found = warnings(`${HOOKS}export function Panel() { ${body} }`);
      assert.equal(found.length, 1, found.join('\n'));
      assert.ok(found[0].includes(`\`${read}\``) && found[0].includes('<Panel>') && found[0].includes('decides what the component returns'), found[0]);
      assert.match(found[0], /state-\d+\.jsx:2:\d+/, 'names where the test is');
    });
  }
});

describe('ERR_STATE_READ_ONCE: the fix quotes the condition', () => {
  it('writes the whole test in the suggested branch', () => {
    const [found] = warnings(`${HOOKS}export function Panel() { const [items] = useState([]); if (items().length === 0) return <p>None</p>; return <ul />; }`);
    assert.ok(found.includes('`<>{() => (items().length === 0 ? <A /> : <B />)}</>`'), found);
  });
});

describe('ERR_STATE_READ_ONCE: a value derived in the body and shown in JSX', () => {
  it('reports it, naming the value and how to derive it', () => {
    const found = warnings(`${HOOKS}export function Signup() {
  const [name, setName] = useState('');
  const valid = name().length > 0;
  return <button disabled={!valid}>Sign up</button>;
}`);
    assert.equal(found.length, 1, found.join('\n'));
    assert.ok(found[0].includes('`name()`') && found[0].includes('`valid` is computed from it') && found[0].includes('useMemo'), found[0]);
  });

  it('reports one shown as a child or read by a handler in JSX', () => {
    assert.equal(warnings(`${HOOKS}export function A() { const [n] = useState(1); const label = 'n=' + n(); return <p>{label}</p>; }`).length, 1);
    assert.equal(warnings(`${HOOKS}export function B() { const [n] = useState(1); const twice = n() * 2; return <button onClick={() => alert(twice)} />; }`).length, 1);
  });
});

describe('ERR_STATE_READ_ONCE: what is not reported', () => {
  for (const [shape, source] of [
    ['a branch written in JSX', `${HOOKS}export function A() { const [loading] = useState(true); return <>{() => (loading() ? <p /> : <ul />)}</>; }`],
    ['<Show>', `${HOOKS}export function A() { const [open] = useState(false); return <Show when={open()}><dialog /></Show>; }`],
    ['a value derived with useMemo or computed', `${HOOKS}export function A() { const [n] = useState(1); const twice = useMemo(() => n() * 2); const thrice = computed(() => n() * 3); return <p>{twice()}{thrice()}</p>; }`],
    ['a read inside untrack', `${HOOKS}export function A() { const [n] = useState(1); const first = untrack(() => n()); return <p>{first}</p>; }`],
    ['a value read in the body and used outside JSX', `${HOOKS}export function A() { const [n] = useState(1); const start = n(); useEffect(() => console.log(start)); return <p>{n()}</p>; }`],
    ['a return decided by a module-scope flag', `${HOOKS}const enabled = true; export function A() { if (!enabled) return null; return <p />; }`],
    ['state from another library', `import { useState } from 'react';\nexport function A() { const [loading] = useState(true); if (loading) return <p />; return <ul />; }`],
    ['a lower-case helper', `${HOOKS}export function helper() { const [loading] = useState(true); if (loading()) return <p />; return <ul />; }`],
    ['a list row', `${HOOKS}export function A() { const [rows] = useState([]); return <ul>{rows().map((row) => { const [open] = useState(false); return open() ? <li key={row.id} /> : null; })}</ul>; }`],
  ]) {
    it(shape, () => {
      assert.deepEqual(warnings(source), []);
    });
  }

  it('a production build reports nothing', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      assert.deepEqual(warnings(`${HOOKS}export function A() { const [loading] = useState(true); if (loading()) return <p />; return <ul />; }`, { production: true }), []);
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
