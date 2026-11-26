// no-prop-read-once, no-state-read-once and no-cleanup-reads-live report the
// read-once shapes what-compiler reports at build time (ERR_PROP_READ_ONCE,
// ERR_STATE_READ_ONCE, ERR_CLEANUP_READS_LIVE), for code the compiler does
// not build: the islands template's automatic JSX runtime and h() files,
// which lint with the `recommended` preset. The `compiler` preset leaves them
// to the compiler.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const HEAD = "import { useState, useSignal, useEffect, computed, untrack, h, Show } from 'what-framework';\n";
const RULES = ['what/no-prop-read-once', 'what/no-state-read-once', 'what/no-cleanup-reads-live'];

function lint(code, { preset = 'recommended', head = HEAD } = {}) {
  return new Linter()
    .verify(head + code, [plugin.configs[preset]], { filename: 'src/islands/Island.jsx' })
    .filter((m) => RULES.includes(m.ruleId) || m.fatal)
    .map((m) => `${m.ruleId.replace('what/', '')} ${m.message.match(/^`([^`]+)`|reads `([^`]+)`/).slice(1).find(Boolean)}`);
}

describe('read-once lint rules', () => {
  for (const [shape, code, expected] of [
    ['an early return on state', 'export function Users() { const [loading] = useState(true); if (loading()) return <p>Loading</p>; return <ul />; }', ['no-state-read-once loading()']],
    ['a returned ternary on state', 'export const Modal = () => { const open = useSignal(false); return open() ? <dialog /> : null; };', ['no-state-read-once open()']],
    ['a value derived from state and shown', "export function Signup() { const [name] = useState(''); const valid = name().length > 0; return <button disabled={!valid}>Go</button>; }", ['no-state-read-once name()']],
    ['an early return on a prop', 'export function Modal(props) { if (!props.open) return null; return <dialog />; }', ['no-prop-read-once props.open']],
    ['an early return on a destructured prop, through memo()', 'export const Modal = memo(({ open }) => { if (!open) return null; return <dialog />; });', ['no-prop-read-once open']],
    ['an h() component', "export function Badge({ count }) { return count > 0 ? h('b', null, count) : null; }", ['no-prop-read-once count']],
    ['a cleanup that reads the prop its run reads', 'export function Room(props) { useEffect(() => { join(props.room); return () => leave(props.room); }); return <p />; }', ['no-cleanup-reads-live props.room']],
    ['a cleanup that reads state its run reads', 'export function Room() { const [room] = useState(1); useEffect(() => { join(room()); return () => leave(room()); }, [room]); return <p />; }', ['no-cleanup-reads-live room()']],
  ]) {
    it(`reports ${shape}`, () => assert.deepEqual(lint(code), expected));
  }

  it('says why and how to fix it', () => {
    const [m] = new Linter().verify(HEAD + 'export function Users() { const [loading] = useState(true); if (loading()) return <p>Loading</p>; return <ul />; }', [plugin.configs.recommended], { filename: 'a.jsx' })
      .filter((x) => x.ruleId === 'what/no-state-read-once');
    assert.equal(m.message, '`loading()`, state of <Users>, is read once: it decides what the component returns. Fix: branch where it renders, `<>{() => (loading() ? <A /> : <B />)}</>` or `<Show when={() => loading()}>`.');
    assert.equal(plugin.rules['no-state-read-once'].meta.docs.code, 'ERR_STATE_READ_ONCE');
    assert.equal(plugin.rules['no-prop-read-once'].meta.docs.code, 'ERR_PROP_READ_ONCE');
    assert.equal(plugin.rules['no-cleanup-reads-live'].meta.docs.code, 'ERR_CLEANUP_READS_LIVE');
  });

  for (const [why, code] of [
    ['a branch where it renders', 'export function Users() { const [loading] = useState(true); return <>{() => (loading() ? <p>Loading</p> : <ul />)}</>; }'],
    ['a read inside a function', 'export function Users() { const [n] = useState(0); const first = untrack(() => n()); const later = () => n() + 1; return <p title={first}>{later}</p>; }'],
    ['a derived value that JSX does not show', "export function Log() { const [name] = useState(''); const initial = name(); console.debug(initial); return <p />; }"],
    ['a computed derived value', "export function Signup() { const [name] = useState(''); const valid = computed(() => name().length > 0); return <button disabled={() => !valid()}>Go</button>; }"],
    ['an effect that runs once, or a cleanup that reads what the run kept', 'export function Room(props) { useEffect(() => { join(props.room); return () => leave(props.room); }, []); useEffect(() => { const used = props.room; join(used); return () => leave(used); }); return <p />; }'],
    ['a function that is not a component', 'export function useThing(props) { if (!props.open) return null; return 1; } function helper(x) { if (x.open) return 1; return 2; }'],
    ['a capitalized function that renders nothing itself', 'export const Outlet = ({ children }) => children || null; export function Activity(props) { return props.mode === \'hidden\' ? null : props.children; }'],
    ['state What did not make', "import { useState as useReactState } from 'some-lib';\nexport function A() { const [loading] = useReactState(true); if (loading()) return <p />; return <ul />; }"],
  ]) {
    it(`does not report ${why}`, () => assert.deepEqual(lint(code), []));
  }

  it('leaves a React file alone', () => {
    assert.deepEqual(lint("export function Modal({ open }) { const [n] = useState(0); if (!open || n) return null; return <dialog />; }", { head: "import { useState } from 'react';\n" }), []);
  });

  it('is on in recommended and strict, and off in the compiler preset (the compiler reports these)', () => {
    for (const rule of RULES) {
      assert.equal(plugin.configs.recommended.rules[rule], 'warn');
      assert.equal(plugin.configs.strict.rules[rule], 'error');
      assert.equal(plugin.configs.compiler.rules[rule], 'off');
    }
    assert.deepEqual(lint('export function Modal(props) { if (!props.open) return null; return <dialog />; }', { preset: 'compiler' }), []);
  });
});
