// ERR_REBUILT_COMPONENT reports a region that builds again a component whose
// state its last run held. The router's page region runs again only to show
// another page: another route, whose <ErrorBoundary> (every route with
// `error:` has one) is a new boundary, not the last route's with its state
// lost, or the same route for other params, which is built for them. Neither
// is reported. A change of query alone keeps the page, with its state.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

const { h } = await import('../../core/src/h.js');
const { mount } = await import('../../core/src/dom.js');
const { signal } = await import('../../core/src/reactive.js');
const { subscribeDiagnostics } = await import('../../core/src/index.js');
const { Router, navigate } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

function page(name) {
  return function Page() {
    const draft = signal('');
    return h('section', { id: name }, h('input', { value: () => draft(), oninput: (e) => draft(e.target.value) }));
  };
}
const Failed = () => h('p', null, 'failed');
const routes = [
  { path: '/a', component: page('a'), error: Failed },
  { path: '/b', component: page('b'), error: Failed },
  { path: '/p/:id', component: page('p'), error: Failed },
];

let unmount = null;
let reports = [];
let off = null;

beforeEach(async () => {
  history.replaceState(null, '', '/a');
  await navigate('/a', { replace: true, transition: false });
  const app = document.getElementById('app');
  app.textContent = '';
  unmount = mount(h(Router, { routes }), app);
  await flush();
  reports = [];
  off = subscribeDiagnostics((event) => { if (event.code === 'ERR_REBUILT_COMPONENT') reports.push(event); });
});

afterEach(() => {
  off();
  unmount();
});

describe('ERR_REBUILT_COMPONENT across navigations', () => {
  it('is not reported for the next route\'s ErrorBoundary', async () => {
    await navigate('/b', { transition: false });
    await flush();
    assert.ok(document.getElementById('b'), 'the next page shows');
    await navigate('/a', { transition: false });
    await flush();
    assert.ok(document.getElementById('a'));
    assert.deepEqual(reports.map((r) => r.data.component), []);
  });

  it('is not reported for a change of query, which keeps the page and its state', async () => {
    const input = document.querySelector('#a input');
    input.value = 'kept';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await navigate('/a?tab=2', { transition: false });
    await flush();
    assert.equal(document.querySelector('#a input'), input);
    assert.equal(input.value, 'kept');
    assert.deepEqual(reports.map((r) => r.data.component), []);
  });

  it('is not reported for the same route with other params, whose page is built for them', async () => {
    await navigate('/p/1', { transition: false });
    await flush();
    const first = document.querySelector('#p input');
    await navigate('/p/2', { transition: false });
    await flush();
    assert.notEqual(document.querySelector('#p input'), first, 'a page is built for each params');
    assert.deepEqual(reports.map((r) => r.data.component), []);
  });
});
