// ERR_REBUILT_COMPONENT: a reactive region that runs again and rebuilds a
// component holding state reports it, with the rewrite that keeps the
// component (a ternary or <Show>, the value read in the props). Development
// only.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { h, mount, flushSync, getDiagnostics, clearDiagnostics } = await import('what-framework');

const mod = await loadCompiled(`
  import { signal, Show } from 'what-framework';
  export const q = signal(1);
  export function Counter(props) {
    const clicks = signal(0);
    return <b>{props.n}:{clicks()}</b>;
  }
  export function Plain(props) { return <i>{props.n}</i>; }
  export function Other() { const s = signal(0); return <u>{s()}</u>; }
  export function BlockRegion() {
    return <div>{() => { const n = q(); if (n < 0) return <p>none</p>; return <Counter n={n} />; }}</div>;
  }
  export function Ternary() {
    return <div>{q() < 0 ? <p>none</p> : <Counter n={q()} />}</div>;
  }
  export function Shown() {
    return <div><Show when={q() >= 0} fallback={<p>none</p>}><Counter n={q()} /></Show></div>;
  }
  export function Stateless() {
    return <div>{() => { const n = q(); return <Plain n={n} />; }}</div>;
  }
  export function Switching() {
    return <div>{() => (q() % 2 ? <Counter n={q()} /> : <Other />)}</div>;
  }
`);

function run(Component, writes) {
  mod.q(1);
  flushSync();
  clearDiagnostics();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stop = mount(h(Component, {}), host);
  for (const v of writes) { mod.q(v); flushSync(); }
  const text = host.textContent;
  stop();
  host.remove();
  return { text, reports: getDiagnostics().events.filter((e) => e.code === 'ERR_REBUILT_COMPONENT') };
}

test('a block function region that rebuilds a component holding state reports it, once per region', () => {
  const { text, reports } = run(mod.BlockRegion, [2, 3, 4]);
  assert.equal(text, '4:0');
  assert.equal(reports.length, 1, JSON.stringify(reports));
  assert.equal(reports[0].count, 3, 'repeats fold into one report');
  assert.match(reports[0].message, /rebuilt <Counter> when it ran again/);
  assert.match(reports[0].fix ?? reports[0].suggestion ?? '', /ternary or <Show>/);
});

test('a ternary and <Show> keep the component, so nothing is reported', () => {
  assert.deepEqual(run(mod.Ternary, [2, 3]).reports, []);
  assert.deepEqual(run(mod.Shown, [2, 3]).reports, []);
  assert.equal(run(mod.Ternary, [2, 3]).text, '3:0');
});

test('a stateless component rebuilt, or a region switching between components, reports nothing', () => {
  assert.deepEqual(run(mod.Stateless, [2, 3]).reports, []);
  assert.deepEqual(run(mod.Switching, [2, 3, 4]).reports, []);
});
