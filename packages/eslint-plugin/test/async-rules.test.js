// The rules for the async surface's React habits (docs/ASYNC.md), through the
// real Linter with the compiler preset, which what_lint runs: an async
// component, a promise returned from useMemo, useOptimistic given a value read
// once, a plain computed that returns a promise (a waterfall), and the
// accessors useTransition and useOptimistic return, with pending() as a
// method of an async computed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const lint = (code, rule) => new Linter()
  .verify(code, [plugin.configs.compiler], { filename: 'app.jsx' })
  .filter((m) => rule === undefined || m.ruleId === rule);
const fixed = (code) => new Linter().verifyAndFix(code, [plugin.configs.compiler], { filename: 'app.jsx' }).output;
const imports = "import { computed, signal, useMemo, useState, useTransition, useOptimistic, startTransition } from 'what-framework';\n";

describe('what/no-async-component', () => {
  it('reports an async function component, declared or assigned', () => {
    const messages = lint(imports + [
      'export async function Profile() { const u = await load(); return <h1>{u.name}</h1>; }',
      'const Card = async () => <p />;',
    ].join('\n'), 'what/no-async-component');
    assert.deepEqual(messages.map((m) => m.line), [2, 3]);
    assert.match(messages[0].message, /"Profile" is an async function/);
  });

  it('stays silent for async helpers and handlers, and for components that read an async value', () => {
    assert.deepEqual(lint(imports + [
      'async function loadUser() { return fetch("/u"); }',
      'const save = async () => {};',
      'function Profile() { const user = computed(async () => loadUser()); return <h1>{user().name}</h1>; }',
    ].join('\n'), 'what/no-async-component'), []);
  });
});

describe('what/no-promise-in-usememo', () => {
  it('reports useMemo with an async function, or one returning fetch(), .then() or a Promise', () => {
    const messages = lint(imports + [
      'function A() {',
      '  const a = useMemo(async () => load());',
      "  const b = useMemo(() => fetch('/u').then((r) => r.json()));",
      '  const c = useMemo(() => { return new Promise(() => {}); });',
      '  const d = useMemo(() => Promise.all([x, y]));',
      '  return <p />;',
      '}',
    ].join('\n'), 'what/no-promise-in-usememo');
    assert.deepEqual(messages.map((m) => m.line), [3, 4, 5, 6]);
  });

  it('stays silent for a synchronous useMemo and for computed() over a promise', () => {
    assert.deepEqual(lint(imports + [
      'function A() {',
      '  const a = useMemo(() => items().length);',
      "  const b = computed(async () => fetch('/u'));",
      '  return <p>{a()}</p>;',
      '}',
    ].join('\n'), 'what/no-promise-in-usememo'), []);
  });
});

describe('what/no-optimistic-snapshot', () => {
  it('reports a state read once, and the fix passes the accessor', () => {
    const code = imports + [
      'function Likes() {',
      '  const [likes] = useState(0);',
      '  const [shown, add] = useOptimistic(likes(), (n, d) => n + d);',
      '  return <p>{shown()}</p>;',
      '}',
    ].join('\n');
    assert.deepEqual(lint(code, 'what/no-optimistic-snapshot').map((m) => m.line), [4]);
    assert.match(fixed(code), /useOptimistic\(likes, \(n, d\) => n \+ d\)/);
  });

  it('stays silent for an accessor, a computed and a plain value', () => {
    assert.deepEqual(lint(imports + [
      'function Likes(props) {',
      '  const [likes] = useState(0);',
      '  const total = computed(async () => load());',
      '  const [a] = useOptimistic(likes, (n, d) => n + d);',
      '  const [b] = useOptimistic(total);',
      '  const [c] = useOptimistic(props.initial);',
      '  return <p>{a()}{b()}{c()}</p>;',
      '}',
    ].join('\n'), 'what/no-optimistic-snapshot'), []);
  });
});

describe('what/prefer-async-computed', () => {
  it('reports a plain function that returns fetch() or .then(), and the fix makes it async', () => {
    const code = imports + [
      "const a = computed(() => fetch('/a').then((r) => r.json()));",
      "const b = computed(() => { return fetch('/b'); });",
    ].join('\n');
    assert.deepEqual(lint(code, 'what/prefer-async-computed').map((m) => m.line), [2, 3]);
    assert.match(fixed(code), /computed\(async \(\) => fetch\('\/a'\)/);
  });

  it('stays silent for an async function, one that takes { signal }, a synchronous one, and an unknown call', () => {
    assert.deepEqual(lint(imports + [
      "const a = computed(async () => fetch('/a'));",
      "const b = computed(({ signal }) => fetch('/b', { signal }));",
      'const c = computed(() => a() + 1);',
      'const d = computed(() => api.user(1));',
    ].join('\n'), 'what/prefer-async-computed'), []);
  });
});

describe('accessors of the async surface in no-uncalled-signals', () => {
  it('useTransition()[0] and useOptimistic()[0] are accessors', () => {
    const messages = lint(imports + [
      'function Tabs(props) {',
      '  const [isPending, start] = useTransition();',
      '  const [items] = useOptimistic(props.items);',
      '  if (isPending) start(() => {});',
      '  return <div>{isPending && <i />}<b>{isPending ? 1 : 2}</b><button disabled={isPending} />{items.length}</div>;',
      '}',
    ].join('\n'), 'what/no-uncalled-signals');
    assert.deepEqual(messages.map((m) => m.message.split(' — ')[0]), [
      '"isPending" is a signal', '"isPending" is a signal', '"isPending" is a signal', '"items" is a signal',
    ]);
  });

  it('pending() is a method of an async computed, not a missing call', () => {
    assert.deepEqual(lint(imports + [
      'function Users() {',
      '  const users = computed(async () => load());',
      '  return <p class={users.pending() ? "stale" : ""}>{users().length}</p>;',
      '}',
    ].join('\n'), 'what/no-uncalled-signals'), []);
  });

  it('memo is React\'s component memo: what it returns is a component, not a signal', () => {
    assert.deepEqual(lint("import { memo } from 'what-framework';\n" + [
      'const Row = memo((props) => <li>{props.label}</li>);',
      'export function List() { return <ul>{Row && <Row label="a" />}</ul>; }',
    ].join('\n'), 'what/no-uncalled-signals'), []);
  });
});
