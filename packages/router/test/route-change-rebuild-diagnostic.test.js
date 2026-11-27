// ERR_REBUILT_COMPONENT reports a region that builds again a component whose
// state its last run held. A navigation to another route shows another page:
// its route's <ErrorBoundary> (every route with `error:` has one) is a new
// boundary, not the last route's with its state lost, so nothing is reported.
// A navigation that renders the same route again (another query) rebuilds
// its page, whose state is then gone, and that is still reported.
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

  it('is reported when the same route renders again and its page loses its state', async () => {
    await navigate('/a?tab=2', { transition: false });
    await flush();
    assert.deepEqual(reports.map((r) => r.data.component), ['ErrorBoundary']);
  });
});
