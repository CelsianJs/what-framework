// A createRoot() handle's root, against React 19.3.1 (the matrix fixture's
// react-dom, built for production and run in Chromium by the seventh
// review's probes, verify-wave7 wave7.jsx and wave7-extra.jsx, and the
// lane-r7 controls, lane7.jsx; each test runs the probe's own steps and
// compares the whole trace):
// - render() goes the same way whether the root is mounted or not: it
//   commits now, or, asked for while a render, a commit or its effects run
//   (a layout effect of the root's own first commit), once that commit is
//   done; the renders asked for until then are one, the last element's;
// - unmount() takes the place of a render still waiting, so nothing that
//   render would have set up runs; a passive effect that unmounts the root
//   runs before the root renders again, and that render is not done;
// - unmount() releases everything the root holds, removes only the root's
//   own nodes, and does nothing the second time on a handle (another root in
//   the same container keeps its nodes).
// Run: node --test packages/react-compat/test/root-lifecycle.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'Event', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { createElement: h, useLayoutEffect, useEffect } = React;
const { createRoot, flushSync } = ReactDOM;

afterEach(() => { document.body.textContent = ''; });
const turn = () => new Promise((r) => setTimeout(r, 0));
const box = (/** @type {string} */ tag = 'div') => document.body.appendChild(document.createElement(tag));

/** A trace, and the probes' Widget (wave7.jsx Target): layout and passive effects on its id, and a window listener the passive one adds. */
function probe() {
  /** @type {any[]} */
  const log = [];
  const note = (/** @type {any[]} */ ...v) => log.push(v);
  const fire = () => window.dispatchEvent(new window.Event('lane-r7'));
  function Widget({ id }) {
    useLayoutEffect(() => { note('layout+', id); return () => note('layout-', id); }, [id]);
    useEffect(() => {
      note('passive+', id);
      const listener = () => note('listener', id);
      window.addEventListener('lane-r7', listener);
      return () => { window.removeEventListener('lane-r7', listener); note('passive-', id); };
    }, [id]);
    return h('i', null, id);
  }
  return { log, note, fire, Widget };
}

// ---- A render asked for in the root's own first commit ----

test('a layout effect of the root\'s first commit renders a replacement: it commits once that commit is done, and unmount() releases it (React 19.3.1 mount-replace-leak)', async () => {
  const { log, note } = probe();
  const app = box();
  const root = createRoot(app);
  function Orphan() {
    useLayoutEffect(() => { note('orphan layout'); return () => note('orphan layout cleanup'); }, []);
    useEffect(() => {
      note('orphan passive');
      const listener = () => note('orphan survives');
      window.addEventListener('listener', listener);
      return () => { window.removeEventListener('listener', listener); note('orphan cleanup'); };
    }, []);
    return h('i', null, 'replacement');
  }
  function Stop() {
    useLayoutEffect(() => { root.render(h(Orphan)); }, []);
    return h('b', null, 'initial');
  }
  flushSync(() => root.render(h(Stop)));
  note('returned', app.textContent);
  await turn();
  note('settled', app.textContent);
  root.unmount();
  await turn();
  window.dispatchEvent(new window.Event('listener'));
  note('after stop', app.textContent);
  assert.deepEqual(log, [
    ['orphan layout'], ['orphan passive'], ['returned', 'replacement'], ['settled', 'replacement'],
    ['orphan layout cleanup'], ['orphan cleanup'], ['after stop', ''],
  ]);
});

test('two renders asked for in the root\'s first commit are one, the last element\'s: the first tree unmounts, its passive cleanup before the new passive effect (React 19.3.1 lane-r7 replace-in-first-layout)', async () => {
  const { log, note, fire, Widget } = probe();
  const app = box();
  const root = createRoot(app);
  function Boot() {
    useLayoutEffect(() => {
      note('boot layout');
      root.render(h(Widget, { id: 'second' }));
      note('after render', app.textContent);
      root.render(h(Widget, { id: 'third' }));
      return () => note('boot layout cleanup');
    }, []);
    useEffect(() => { note('boot passive'); return () => note('boot passive cleanup'); }, []);
    return h('b', null, 'boot');
  }
  flushSync(() => root.render(h(Boot)));
  note('returned', app.textContent);
  await turn();
  flushSync(() => root.unmount());
  fire();
  note('end', app.textContent);
  assert.deepEqual(log, [
    ['boot layout'], ['after render', 'boot'], ['boot passive'], ['boot layout cleanup'], ['layout+', 'third'],
    ['boot passive cleanup'], ['passive+', 'third'], ['returned', 'third'], ['layout-', 'third'], ['passive-', 'third'], ['end', ''],
  ]);
});

// ---- A passive effect that unmounts the root before it renders again ----

test('a passive effect still waiting when the root renders again runs first; it unmounts the root, and the render is not done (React 19.3.1 lane-r7 passive-unmount-render)', async () => {
  const { log, note, fire, Widget } = probe();
  const app = box();
  const root = createRoot(app);
  function Stop() {
    useLayoutEffect(() => {
      note('stop layout');
      queueMicrotask(() => { note('render asked', app.textContent); root.render(h(Widget, { id: 'replacement' })); });
      return () => note('stop layout cleanup');
    }, []);
    useEffect(() => { note('stop passive'); root.unmount(); return () => note('stop passive cleanup'); }, []);
    return h('b', null, 'initial');
  }
  root.render(h(Stop));
  await turn();
  note('settled', app.textContent);
  fire();
  root.unmount();
  note('unmount again ok');
  assert.deepEqual(log, [
    ['stop layout'], ['render asked', 'initial'], ['stop passive'], ['stop layout cleanup'], ['stop passive cleanup'],
    ['settled', ''], ['unmount again ok'],
  ]);
});

test('two renders in one task, the first one\'s passive effect unmounting the root: the second is not done and nothing it set up survives the unmount (React 19.3.1 passive-unmount-race batches the two and commits only the second)', async () => {
  const { log, note } = probe();
  const app = box();
  const root = createRoot(app);
  function Orphan() {
    useLayoutEffect(() => { note('orphan layout'); return () => note('orphan layout cleanup'); }, []);
    useEffect(() => {
      const listener = () => note('orphan survives');
      window.addEventListener('listener', listener);
      return () => { window.removeEventListener('listener', listener); note('orphan cleanup'); };
    }, []);
    return h('i', null, 'replacement');
  }
  function Stop() {
    useEffect(() => { note('stop from passive'); root.unmount(); }, []);
    return h('b', null, 'initial');
  }
  // React renders neither before the task ends and commits only the second
  // (orphan layout and passive, then both cleanups at the unmount below).
  // what-react's render() commits at once: the second render runs the first
  // one's passive effect first, as React does before it renders, and that
  // effect's unmount takes the second render's place.
  root.render(h(Stop));
  root.render(h(Orphan));
  note('returned', app.textContent);
  await turn();
  note('settled', app.textContent);
  root.unmount();
  await turn();
  window.dispatchEvent(new window.Event('listener'));
  note('after stop', app.textContent);
  assert.deepEqual(log, [['stop from passive'], ['returned', ''], ['settled', ''], ['after stop', '']]);
});

// ---- Separate roots rendered from an effect ----

/**
 * The probe's Driver: from a layout effect, renders `other`, then, in a
 * nested flushSync, `third` and `other` again; `cancel` then unmounts
 * `other` (verify-wave7 wave7.jsx fresh-root, cancel-root).
 */
async function drive(cancel, mounted, single) {
  const { log, note, Widget } = probe();
  const app = box();
  const containers = [box(), box('aside')];
  const root = createRoot(app);
  const [other, third] = containers.map((c) => createRoot(c));
  const contents = () => [app, ...containers].map((c) => c.textContent);
  function Driver() {
    useLayoutEffect(() => {
      note('begin', ...contents());
      other.render(h(Widget, { id: 'intermediate' }));
      note('after first render', ...contents());
      flushSync(() => {
        if (!single) third.render(h(Widget, { id: 'third' }));
        other.render(h(Widget, { id: 'final' }));
      });
      note('after nested flush', ...contents());
      if (cancel) other.unmount();
      return () => note('driver cleanup');
    }, []);
    return h('b', null, 'driver');
  }
  if (mounted) flushSync(() => {
    other.render(h(Widget, { id: 'old2' }));
    third.render(h(Widget, { id: 'old3' }));
  });
  flushSync(() => root.render(h(Driver)));
  note('outer flush returned', ...contents());
  await turn();
  note('settled', ...contents());
  flushSync(() => { root.unmount(); other.unmount(); third.unmount(); });
  await turn();
  note('stopped', ...contents());
  return log;
}

test('a separate root\'s first render asked for in a layout effect waits for the commit, and the renders asked for until then are one: no transient setup (React 19.3.1 fresh-root, one root)', async () => {
  assert.deepEqual(await drive(false, false, true), [
    ['begin', 'driver', '', ''], ['after first render', 'driver', '', ''], ['after nested flush', 'driver', '', ''],
    ['layout+', 'final'], ['passive+', 'final'], ['outer flush returned', 'driver', 'final', ''],
    ['settled', 'driver', 'final', ''], ['driver cleanup'], ['layout-', 'final'], ['passive-', 'final'], ['stopped', '', '', ''],
  ]);
});

test('renders queued for a mounted root that is then unmounted in the same commit are not done: it unmounts in their place, before a root queued after it renders (React 19.3.1 cancel-root)', async () => {
  assert.deepEqual(await drive(true, true, false), [
    ['layout+', 'old2'], ['passive+', 'old2'], ['layout+', 'old3'], ['passive+', 'old3'],
    ['begin', 'driver', 'old2', 'old3'], ['after first render', 'driver', 'old2', 'old3'], ['after nested flush', 'driver', 'old2', 'old3'],
    ['layout-', 'old2'], ['passive-', 'old2'], ['layout-', 'old3'], ['layout+', 'third'], ['passive-', 'old3'], ['passive+', 'third'],
    ['outer flush returned', 'driver', '', 'third'], ['settled', 'driver', '', 'third'],
    ['driver cleanup'], ['layout-', 'third'], ['passive-', 'third'], ['stopped', '', '', ''],
  ]);
});

test('a separate root\'s first render and its unmount asked for in a layout effect: nothing of it is set up, and its container is emptied as React empties it (React 19.3.1 lane-r7 fresh-then-unmount)', async () => {
  const { log, note, fire, Widget } = probe();
  const app = box();
  const otherHost = box('section');
  otherHost.innerHTML = '<p>static</p>';
  const root = createRoot(app);
  const other = createRoot(otherHost);
  function Driver() {
    useLayoutEffect(() => {
      other.render(h(Widget, { id: 'fresh' }));
      other.unmount();
      note('inside', otherHost.innerHTML);
    }, []);
    return h('b', null, 'driver');
  }
  flushSync(() => root.render(h(Driver)));
  note('returned', otherHost.innerHTML);
  await turn();
  fire();
  note('settled', otherHost.innerHTML);
  root.unmount();
  assert.deepEqual(log, [['inside', '<p>static</p>'], ['returned', ''], ['settled', '']]);
});

// ---- unmount() ----

test('an old handle\'s second unmount() leaves a new root in the same container alone (React 19.3.1 old-cleanup-after-remount)', async () => {
  const { log, note } = probe();
  const host = box();
  const old = createRoot(host);
  flushSync(() => old.render(h('i', null, 'old')));
  let next;
  flushSync(() => {
    old.unmount();
    next = createRoot(host);
    next.render(h('i', null, 'new'));
  });
  note('before old cleanup', host.textContent);
  old.unmount();
  await turn();
  note('settled', host.textContent);
  next.unmount();
  assert.deepEqual(log, [['before old cleanup', 'new'], ['settled', 'new']]);
});

test('unmount() removes only the root\'s own nodes; a root that never rendered empties its container, as React\'s first commit does (React 19.3.1 lane-r7 unmount-foreign, unmount-unrendered)', () => {
  const { log, note, Widget } = probe();
  const own = box();
  const root = createRoot(own);
  flushSync(() => root.render(h(Widget, { id: 'own' })));
  own.appendChild(document.createElement('hr'));
  flushSync(() => root.unmount());
  note('after unmount', own.innerHTML);
  const server = box();
  server.innerHTML = '<p>server</p>';
  flushSync(() => createRoot(server).unmount());
  note('unrendered', server.innerHTML);
  assert.deepEqual(log, [['layout+', 'own'], ['passive+', 'own'], ['layout-', 'own'], ['passive-', 'own'], ['after unmount', '<hr>'], ['unrendered', '']]);
});
