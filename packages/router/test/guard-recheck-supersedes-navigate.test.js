// A route guard re-runs when a signal it read changes. When the app writes
// that signal and then navigates away in the same tick (reset a draft, then go
// to what was created; sign out, then go to sign-in), the page being left
// keeps its verdict while that navigation is in flight, so the visitor lands
// where the app sent them. A navigation that never commits (cancelled, or its
// destination's guard sends it back) leaves the page shown, and its guard's
// redirect then applies; with no navigation in flight it applies at once.
//
// Own file: the router keeps module-scoped URL state.

import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/review' });
window.scrollTo = () => {};

const { h, mount, signal } = await import('what-core');
const { navigate, Router, beforeNavigate } = await import('../src/index.js');

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let cleanups = [];
afterEach(() => {
  for (const fn of cleanups) fn();
  cleanups = [];
});

// A wizard's review step, guarded by `detailsDone`, whose Create button runs
// `onCreate`. Mounted at /review.
async function wizard(onCreate, projectGuard) {
  const detailsDone = signal(true);
  const routes = [
    {
      path: '/review',
      middleware: [() => (detailsDone() ? undefined : '/details')],
      component: () => h('button', { id: 'create', onClick: () => onCreate(detailsDone) }, 'Create'),
    },
    { path: '/details', component: () => h('p', { id: 'details' }, 'Step one') },
    {
      path: '/projects/:id',
      middleware: projectGuard ? [projectGuard] : undefined,
      component: () => h('p', { id: 'project' }, 'Project'),
    },
  ];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const unmount = mount(h(Router, { routes }), container);
  cleanups.push(() => { unmount(); container.remove(); });
  await navigate('/review', { replace: true });
  await flush();
  assert.equal(location.pathname, '/review');
  return { detailsDone, container };
}

it('a navigation the app starts after clearing what a guard read is not replaced by that guard\'s redirect', async () => {
  const { container } = await wizard((detailsDone) => {
    detailsDone.set(false); // the draft is reset
    navigate('/projects/13'); // and the visitor goes to the project
  });
  container.querySelector('#create').click();
  await flush(100);
  assert.equal(location.pathname, '/projects/13');
  assert.ok(container.querySelector('#project'));
});

it('the guard\'s redirect applies once a navigation away is cancelled', async () => {
  const off = beforeNavigate((to) => !to.startsWith('/projects/'));
  cleanups.push(off);
  const { container } = await wizard((detailsDone) => {
    detailsDone.set(false);
    navigate('/projects/13');
  });
  container.querySelector('#create').click();
  await flush(100);
  assert.equal(location.pathname, '/details');
  assert.ok(container.querySelector('#details'));
});

it('the guard\'s redirect applies once the destination\'s guard sends the navigation back', async () => {
  const { container } = await wizard((detailsDone) => {
    detailsDone.set(false);
    navigate('/projects/13');
  }, () => '/review');
  container.querySelector('#create').click();
  await flush(100);
  assert.equal(location.pathname, '/details');
  assert.ok(container.querySelector('#details'));
});

it('a guard that re-runs with no navigation in flight redirects at once', async () => {
  const { container } = await wizard((detailsDone) => detailsDone.set(false));
  container.querySelector('#create').click();
  await flush(100);
  assert.equal(location.pathname, '/details');
  assert.ok(container.querySelector('#details'));
});
