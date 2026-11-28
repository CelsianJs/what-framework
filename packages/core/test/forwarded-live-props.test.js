// A component that forwards a prop it received (`<Leaf counts={props.data} />`)
// is compiled as a lazy slot (the prop may be JSX, which is built where it is
// placed). When the prop it forwards is a live prop (a getter over a signal
// read), the child must read the value, and read it live, wherever it reads
// it: in its body, in a binding, and through further forwarding.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { cleanup } = installDOM();
after(cleanup);

const { mount, flushSync } = await import('what-framework');

const mod = await loadCompiled(`
  import { signal } from 'what-framework';
  export const s = signal({ v: 1 });
  export const seen = [];
  function Leaf(props) {
    seen.push(typeof props.counts);
    return <b>{props.counts.v}</b>;
  }
  function Middle(props) { return <Leaf counts={props.data} />; }
  function Twice(props) { return <Middle data={props.data} />; }
  function Spread(props) { return <Middle {...props} />; }
  export function Direct() { return <p id="direct"><Middle data={s()} /></p>; }
  export function Deep() { return <p id="deep"><Twice data={s()} /></p>; }
  export function ViaSpread() { return <p id="spread"><Spread data={s()} /></p>; }
  export function Static() { return <p id="static"><Middle data={{ v: 7 }} /></p>; }
  export function Jsx() { return <p id="jsx"><Pass slot={<i>hi</i>} /></p>; }
  function Pass(props) { return <Show2 content={props.slot} />; }
  function Show2(props) { return <span>{props.content}</span>; }
`);

test('a forwarded live prop reaches the child as its value, and stays live', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const stops = ['Direct', 'Deep', 'ViaSpread', 'Static', 'Jsx'].map((name) => {
    const el = document.createElement('div');
    host.appendChild(el);
    return mount(mod[name](), el);
  });
  flushSync();
  assert.equal(host.querySelector('#direct').textContent, '1');
  assert.equal(host.querySelector('#deep').textContent, '1');
  assert.equal(host.querySelector('#spread').textContent, '1');
  assert.equal(host.querySelector('#static').textContent, '7');
  assert.equal(host.querySelector('#jsx i')?.textContent, 'hi', 'forwarded JSX is still placed');
  assert.ok(mod.seen.every((t) => t === 'object'), `the child read objects, not ${mod.seen.join(', ')}`);

  mod.s({ v: 2 });
  flushSync();
  assert.equal(host.querySelector('#direct').textContent, '2');
  assert.equal(host.querySelector('#deep').textContent, '2');
  assert.equal(host.querySelector('#spread').textContent, '2');
  for (const stop of stops) stop();
  host.remove();
});
