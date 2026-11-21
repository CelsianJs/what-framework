// Rules that used to exist only as regex checks inside what_lint. They are the
// single implementation now: what_lint runs these through ESLint, so the two
// cannot disagree. Linted the way what_lint and a scaffolded project lint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import what from '../src/index.js';

function lint(code, rules) {
  return new Linter().verify(code, [{
    files: ['**/*.jsx'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { what },
    rules: Object.fromEntries(rules.map((r) => [`what/${r}`, 'warn'])),
  }], { filename: 'snippet.jsx' });
}

test('no-signal-write-in-render: handlers, effects and store actions write freely', () => {
  const ok = [
    'function A() { const c = signal(0); return <button onClick={() => c(1)}>{c()}</button>; }',
    'function A() { const c = signal(0); function add() { c(c() + 1); } return <button onClick={add}>+</button>; }',
    'function A() { const c = signal(0); const add = () => c(1); return <button onClick={add}>+</button>; }',
    'function A() { const c = signal(0); effect(() => { c(1); }); onMount(() => c(2)); return <p />; }',
    'const items = signal([]); export function addItem(x) { items((i) => [...i, x]); }',
    'const c = signal(0); c(5);',
  ];
  for (const code of ok) assert.deepEqual(lint(code, ['no-signal-write-in-render']), [], code);
});

test('no-signal-write-in-render: writes that run while the component renders', () => {
  const bad = [
    'function A() { const c = signal(0); c(1); return <p />; }',
    'const A = () => { const c = signal(0); c.set(1); return <p />; };',
    'function A(props) { const c = signal(0); props.items.forEach((i) => c(i)); return <p />; }',
    'function A() { const c = signal(0); (() => c(1))(); return <p />; }',
    'function A() { const c = signal(0); untrack(() => c(1)); return <p />; }',
  ];
  for (const code of bad) {
    const reports = lint(code, ['no-signal-write-in-render']);
    assert.equal(reports.length, 1, code);
    assert.match(reports[0].message, /while A renders/);
  }
});

test('no-effect-self-write flags a tracked read plus a write of the same signal', () => {
  assert.equal(lint('const count = signal(0); effect(() => { count(count() + 1); });', ['no-effect-self-write']).length, 1);
  assert.equal(lint('const count = signal(0); effect(() => { if (count() > 9) count.set(count() + 1); });', ['no-effect-self-write']).length, 1, 'a guarded write that still reads the signal loops');
  assert.equal(lint('const count = signal(0); effect(() => { if (count() > 9) count((c) => c + 1); });', ['no-effect-self-write']).length, 1, 'a guarded updater loops');

  for (const code of [
    'const count = signal(0); effect(() => { count(untrack(count) + 1); });',
    'const count = signal(0); effect(() => { count(untrack(() => count()) + 1); });',
    'const count = signal(0); const total = signal(0); effect(() => { total(count()); });',
    'const count = signal(0); effect(() => { count((c) => c + 1); });',
    'const count = signal(0); effect(() => { el.onclick = () => count(count() + 1); });',
  ]) assert.deepEqual(lint(code, ['no-effect-self-write']), [], code);
});

test('no-effect-self-write accepts a write a test of the same signal guards, which settles', () => {
  for (const code of [
    'const count = signal(0); effect(() => { if (count() > 9) count.set(0); });',
    'const open = signal(false); effect(() => { if (open()) { open(false); throw new Error("x"); } });',
    'const open = signal(false); effect(() => { open() && open(false); });',
    'const n = signal(0); effect(() => { n() < 0 ? n(0) : null; });',
  ]) assert.deepEqual(lint(code, ['no-effect-self-write']), [], code);
});

test('effect-cleanup wants a cleanup for listeners and intervals', () => {
  assert.equal(lint("effect(() => { window.addEventListener('resize', h); });", ['effect-cleanup']).length, 1);
  assert.equal(lint('effect(() => { setInterval(tick, 1000); });', ['effect-cleanup']).length, 1);
  for (const code of [
    "effect(() => { window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); });",
    'effect(() => { const id = setInterval(tick, 1000); onCleanup(() => clearInterval(id)); });',
    'effect(() => () => clear());',
    'effect(() => { setTimeout(focus, 0); });',
  ]) assert.deepEqual(lint(code, ['effect-cleanup']), [], code);
});

test('no-unsafe-innerhtml requires the __html marker', () => {
  assert.equal(lint('const a = <div innerHTML={userInput} />;', ['no-unsafe-innerhtml']).length, 1);
  assert.equal(lint('const a = <div innerHTML="<b>x</b>" />;', ['no-unsafe-innerhtml']).length, 1);
  assert.deepEqual(lint('const a = <div innerHTML={{ __html: clean }} />;', ['no-unsafe-innerhtml']), []);
});

test('signal-debug-name flags only unnamed module-scope signals', () => {
  const reports = lint("export const todos = signal([]); export const count = signal(0, 'count'); function A() { const local = signal(0); return local; }", ['signal-debug-name']);
  assert.deepEqual(reports.map((r) => r.message.match(/'(\w+)'/)[1]), ['todos']);
});

test('prefer-computed flags an effect that only writes one signal', () => {
  assert.equal(lint('const items = signal([]); const total = signal(0); effect(() => { total(items().length); });', ['prefer-computed']).length, 1);
  assert.equal(lint('const items = signal([]); const total = signal(0); effect(() => total(items().length));', ['prefer-computed']).length, 1);
  assert.deepEqual(lint('const total = signal(0); effect(() => { total(1); log(); });', ['prefer-computed']), []);
});

test('every rule that has a catalogue code declares it in meta.docs.code', async () => {
  const { ERROR_CODES } = await import('../../core/src/errors.js');
  const known = new Set(Object.values(ERROR_CODES).map((d) => d.code));
  for (const [name, rule] of Object.entries(what.rules)) {
    if (rule.meta.docs.code) assert.ok(known.has(rule.meta.docs.code), `${name}: ${rule.meta.docs.code}`);
  }
});
