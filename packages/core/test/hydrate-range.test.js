// _hydrateRange (render.js): a hydration walk over the server's nodes between
// two markers, after what-core's own walk is done. what-react's islands use it
// to hydrate a native component a React tree renders inside the bracket the
// server wrote for it (packages/react-compat/src/hydrate.js), so its nodes,
// bindings and the focus in them survive as under hydrate().
// Run: node --test packages/core/test/hydrate-range.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.__WHAT_DEV__ = true;

const { h, signal, flushSync, onMount } = await import('../src/index.js');
const render = await import('../src/render.js');
const server = await import('../../server/src/index.js');

function nodesOf(root) {
  const out = [];
  const walker = document.createTreeWalker(root, 5);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n);
  return out;
}

test('_hydrateRange adopts the server\'s nodes between two markers for what the function builds', () => {
  assert.equal(typeof render._hydrateRange, 'function', 'render.js exports _hydrateRange');
  const count = signal(1);
  let mounted = 0;
  function Badge(props) {
    onMount(() => { mounted++; });
    return h('em', { class: 'badge' }, props.label, () => count());
  }
  // The server's bracket for it, between other nodes, as what-react's server writes it.
  const html = '<b>before</b><!--[]-->' + server.renderToHydratableString(h(Badge, { label: 'n' })) + '<!--/[]--><i>after</i>';
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  const before = new Set(nodesOf(host));
  const open = host.childNodes[1];
  const close = [...host.childNodes].find((n) => n.nodeType === 8 && n.data === '/[]');
  const errors = [];
  const value = render._hydrateRange(open, close, () => render._$hcreateComponent(Badge, { label: 'n' }, null), (info) => errors.push(info));
  flushSync();
  assert.deepEqual(errors, []);
  assert.deepEqual(nodesOf(host).filter((n) => !before.has(n)), [], 'no node created');
  const em = host.querySelector('em');
  assert.equal([].concat(value)[0], em, 'it returns the server\'s nodes');
  assert.equal(mounted, 1);
  count(2);
  flushSync();
  assert.equal(em.textContent, 'n2', 'the binding writes the server\'s node');
  assert.equal(host.querySelector('em'), em);
  assert.equal(host.lastChild.textContent, 'after', 'the walk stayed in its range');
});

test('_hydrateRange reports and removes what the client does not render in its range, and nothing outside it', () => {
  const host = document.createElement('div');
  host.innerHTML = '<!--[]--><em>x</em><s>extra</s><!--/[]--><i>after</i>';
  document.body.appendChild(host);
  const [open, , , close] = host.childNodes;
  const errors = [];
  render._hydrateRange(open, close, () => render._$hcreateComponent(() => h('em', null, 'x'), {}, null), (info) => errors.push(info.kind));
  assert.deepEqual(errors, ['extra-nodes']);
  assert.equal(host.innerHTML, '<!--[]--><em>x</em><!--/[]--><i>after</i>');
});
