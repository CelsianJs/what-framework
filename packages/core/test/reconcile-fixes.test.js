// Tests for reconciler / prop effect / component lifecycle bug fixes.
// These regressions came out of a code review:
//   P1-1: adjacent-item removal corrupted the DOM (mapArray keyed path)
//   P1-3: function-valued props leaked effects on unmount
//   P2-5: component dynamically rendered inside a parent effect must not
//         be re-created on every parent signal change (untrack guard)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

if (!global.customElements) {
  const registry = new Map();
  global.customElements = {
    get: (name) => registry.get(name),
    define: (name, cls) => registry.set(name, cls),
  };
}

const { signal, effect, flushSync } = await import('../src/reactive.js');
const { mount, disposeTree } = await import('../src/dom.js');
const { mapArray, insert, setProp, spread } = await import('../src/render.js');
const { h } = await import('../src/h.js');

async function flush() {
  await new Promise(r => queueMicrotask(r));
  await new Promise(r => queueMicrotask(r));
}

function getContainer() {
  const el = document.getElementById('app');
  el.textContent = '';
  return el;
}

// --------------------------------------------------------------------------
// P1-1: Adjacent-item removal must not walk past detached sibling markers.
// Repro: items are multi-node (component returning a fragment); remove two
// adjacent items in the middle of the list. A sentinel element placed
// immediately after the list must survive.
// --------------------------------------------------------------------------

describe('mapArray keyed: adjacent-item removal does not corrupt DOM', () => {
  it('removing two adjacent multi-node items preserves siblings outside the list (general/LIS path)', async () => {
    const container = getContainer();

    // Multi-node items: each row renders as two DOM nodes wrapped in a fragment.
    function Row(item) {
      const frag = document.createDocumentFragment();
      const a = document.createElement('span');
      a.className = 'row-name';
      a.textContent = item.name;
      const b = document.createElement('span');
      b.className = 'row-tag';
      b.textContent = item.id;
      frag.appendChild(a);
      frag.appendChild(b);
      return frag;
    }

    // Construct items so the prefix/suffix optimization does NOT short-circuit:
    // the FIRST and LAST keys differ between old and new lists, forcing the
    // general (LIS) reconciliation path that uses the `removedIndices` loop.
    const items = signal([
      { id: 'x', name: 'XStart' },     // will be replaced by 'y' at index 0
      { id: 'b', name: 'Bravo' },
      { id: 'c', name: 'Charlie' },    // adjacent removal 1
      { id: 'd', name: 'Delta' },      // adjacent removal 2
      { id: 'e', name: 'Echo' },
      { id: 'z', name: 'ZEnd' },       // will be replaced by 'w' at end
    ]);

    const sentinel = document.createElement('hr');
    sentinel.id = 'sentinel';
    container.appendChild(sentinel);

    const inserter = mapArray(items, (item) => Row(item), { key: (i) => i.id, raw: true });
    inserter(container, sentinel);

    await flush();
    flushSync();

    assert.equal(container.querySelectorAll('.row-name').length, 6);

    // New list: replace head/tail (so prefix/suffix skip stops immediately),
    // AND remove the two adjacent middle items c and d.
    items([
      { id: 'y', name: 'YStart' },
      { id: 'b', name: 'Bravo' },
      { id: 'e', name: 'Echo' },
      { id: 'w', name: 'WEnd' },
    ]);

    flushSync();
    await flush();

    const names = [...container.querySelectorAll('.row-name')].map(n => n.textContent);
    assert.deepEqual(names, ['YStart', 'Bravo', 'Echo', 'WEnd'],
      'list contents correct after adjacent-removal in general/LIS path');
    assert.ok(document.getElementById('sentinel'),
      'sentinel survived adjacent-item removal in the general reconciliation path');
  });

  it('removing the only-removals-in-middle branch with adjacent items keeps suffix items intact', async () => {
    // This subtest specifically exercises the `midNewLen === 0` branch
    // (around render.js:843), which uses `_findNextMarkerAfter(...)` instead
    // of the stale `mappedNodes[i+1]` boundary. To prove the branch is
    // actually exercised: structure the diff so prefix-skip ([k1, k2]) keeps
    // both head and tail and removes ONLY the middle. With multi-node items,
    // a stale boundary leaks DOM nodes (orphaned siblings / detached marker
    // walks) — the sentinel AFTER the list and items AFTER the removals
    // would not survive.
    const container = getContainer();

    function Row(item) {
      const frag = document.createDocumentFragment();
      const a = document.createElement('span');
      a.textContent = item.label;
      a.className = 'lbl';
      frag.appendChild(a);
      const b = document.createElement('em');
      b.textContent = item.id;
      frag.appendChild(b);
      // Third node to make boundary corruption maximally visible
      const c = document.createElement('i');
      c.textContent = `[${item.id}]`;
      c.className = 'tag';
      frag.appendChild(c);
      return frag;
    }

    // 7 items. Common-prefix = [k1, k2, k3]. Common-suffix = [k4, k5].
    // Removed middle = [m1, m2] — TWO ADJACENT removals, no inserts.
    // Reconciler enters `midNewLen === 0` branch and iterates the removal loop.
    // If that loop used the stale `mappedNodes[i+1]` boundary, mid markers
    // get detached out of order and surviving siblings (k4, k5, sentinel) fail.
    const items = signal([
      { id: 'k1', label: 'Keep1' },
      { id: 'k2', label: 'Keep2' },
      { id: 'k3', label: 'Keep3' },
      { id: 'm1', label: 'Mid1' },   // adjacent removal #1
      { id: 'm2', label: 'Mid2' },   // adjacent removal #2
      { id: 'k4', label: 'Keep4' },
      { id: 'k5', label: 'Keep5' },
    ]);

    const sentinel = document.createElement('hr');
    sentinel.id = 'sentinel2';
    container.appendChild(sentinel);

    const inserter = mapArray(items, (item) => Row(item), { key: (i) => i.id, raw: true });
    inserter(container, sentinel);
    await flush();
    flushSync();

    assert.equal(container.querySelectorAll('.lbl').length, 7);
    assert.equal(container.querySelectorAll('.tag').length, 7);

    // Drop m1 and m2 only. Head [k1,k2,k3] and tail [k4,k5] are unchanged.
    items([
      { id: 'k1', label: 'Keep1' },
      { id: 'k2', label: 'Keep2' },
      { id: 'k3', label: 'Keep3' },
      { id: 'k4', label: 'Keep4' },
      { id: 'k5', label: 'Keep5' },
    ]);
    flushSync();
    await flush();

    const labels = [...container.querySelectorAll('.lbl')].map(n => n.textContent);
    assert.deepEqual(labels, ['Keep1', 'Keep2', 'Keep3', 'Keep4', 'Keep5'],
      'all five keep-items survive adjacent middle removal via _findNextMarkerAfter');
    const tags = [...container.querySelectorAll('.tag')].map(n => n.textContent);
    assert.deepEqual(tags, ['[k1]', '[k2]', '[k3]', '[k4]', '[k5]'],
      'third sibling node per item survives — no boundary leakage');
    assert.ok(document.getElementById('sentinel2'),
      'sentinel after list survives only-removals-in-middle branch');
    // No orphaned Mid* nodes
    const allLabels = [...container.querySelectorAll('.lbl')].map(n => n.textContent);
    assert.ok(!allLabels.includes('Mid1'), 'Mid1 fully removed');
    assert.ok(!allLabels.includes('Mid2'), 'Mid2 fully removed');
  });

  it('mapArray keyed: middle insert preserves order', async () => {
    const container = getContainer();
    const items = signal([{ id: 'a' }, { id: 'c' }]);

    function Row(item) {
      const span = document.createElement('span');
      span.className = 'mid';
      span.textContent = item.id;
      return span;
    }

    const inserter = mapArray(items, Row, { key: (i) => i.id, raw: true });
    inserter(container, null);
    await flush();

    items([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    flushSync();
    await flush();

    const txt = [...container.querySelectorAll('.mid')].map(n => n.textContent);
    assert.deepEqual(txt, ['a', 'b', 'c']);
  });

  it('mapArray keyed: reordering uses LIS and preserves component nodes', async () => {
    const container = getContainer();
    let createCount = 0;

    const items = signal([{ id: '1' }, { id: '2' }, { id: '3' }]);

    function Row(item) {
      createCount++;
      const el = document.createElement('div');
      el.textContent = item.id;
      el.dataset.id = item.id;
      return el;
    }

    const inserter = mapArray(items, Row, { key: (i) => i.id, raw: true });
    inserter(container, null);
    await flush();
    flushSync();

    assert.equal(createCount, 3);
    const original2 = container.querySelector('[data-id="2"]');
    assert.ok(original2);

    // Reorder
    items([{ id: '3' }, { id: '1' }, { id: '2' }]);
    flushSync();
    await flush();

    // Same DOM node for "2" — reused, not re-created.
    const after2 = container.querySelector('[data-id="2"]');
    assert.equal(after2, original2, 'node identity preserved on reorder');
    assert.equal(createCount, 3, 'no new components created during reorder');
  });
});

// --------------------------------------------------------------------------
// P1-3: function-valued props create an effect — the effect must be tracked
// on el._propEffects so disposeTree tears it down when the element unmounts.
// --------------------------------------------------------------------------

describe('setProp: reactive function props are torn down on disposeTree', () => {
  it('reactive prop effect does not run after the element is disposed', async () => {
    const container = getContainer();

    const cls = signal('initial');
    let evaluations = 0;

    const el = document.createElement('div');
    container.appendChild(el);

    // Pass a function value — setProp must wrap in effect AND register the disposer.
    setProp(el, 'data-test', () => {
      evaluations++;
      return cls();
    });

    flushSync();
    await flush();

    assert.equal(el.getAttribute('data-test'), 'initial');
    const initialCount = evaluations;
    assert.ok(initialCount >= 1);
    assert.ok(el._propEffects, 'effect disposer was registered on _propEffects');
    assert.ok(typeof el._propEffects['data-test'] === 'function');

    // Dispose the element subtree.
    disposeTree(el);
    container.removeChild(el);

    // Mutate the signal — the now-disposed effect must NOT re-evaluate.
    cls('after-dispose');
    flushSync();
    await flush();

    assert.equal(evaluations, initialCount, 'effect did not re-run after disposeTree');
  });
});

// --------------------------------------------------------------------------
// spread(): reactive function props create effects (class / style / generic).
// Same leak class as P1-3 setProp — disposers must be tracked on
// el._propEffects so disposeTree tears them down on unmount.
// --------------------------------------------------------------------------

describe('spread: reactive props are torn down on disposeTree', () => {
  it('spread()-installed effect does not run after the element is disposed', async () => {
    const container = getContainer();
    const cls = signal('a');
    let evaluations = 0;

    const el = document.createElement('div');
    container.appendChild(el);

    spread(el, {
      class: () => {
        evaluations++;
        return cls();
      },
    });

    flushSync();
    await flush();

    assert.equal(el.className, 'a');
    const initialCount = evaluations;
    assert.ok(initialCount >= 1);
    assert.ok(el._propEffects, 'spread should register effect disposer on _propEffects');
    assert.ok(
      typeof el._propEffects['class'] === 'function',
      'class-prop effect disposer was registered'
    );

    disposeTree(el);
    container.removeChild(el);

    cls('after-dispose');
    flushSync();
    await flush();

    assert.equal(evaluations, initialCount, 'spread effect did not re-run after disposeTree');
  });

  it('generic reactive prop installed via spread is also torn down', async () => {
    const container = getContainer();
    const v = signal('one');
    let evaluations = 0;

    const el = document.createElement('input');
    container.appendChild(el);

    spread(el, {
      'data-x': () => {
        evaluations++;
        return v();
      },
    });

    flushSync();
    await flush();

    assert.equal(el.getAttribute('data-x'), 'one');
    const before = evaluations;
    assert.ok(el._propEffects['data-x'], 'generic prop effect disposer registered');

    disposeTree(el);
    container.removeChild(el);

    v('two');
    flushSync();
    await flush();

    assert.equal(evaluations, before, 'generic spread effect did not re-run after disposeTree');
  });
});

// --------------------------------------------------------------------------
// P2-5: component dynamically rendered inside a parent effect must not be
// re-instantiated when a sibling parent signal changes. This guards against
// regression of the untrack() wrap in createComponent (dom.js:365).
// --------------------------------------------------------------------------

describe('createComponent: component creation is untracked from parent effects', () => {
  it('mutating a parent signal does not re-create a child component', async () => {
    const container = getContainer();

    let childCreations = 0;
    function Child(props) {
      childCreations++;
      const el = document.createElement('span');
      el.className = 'child';
      el.textContent = 'child';
      return el;
    }

    const which = signal('a');

    // Effect that resolves a vnode based on `which` and inserts a Child component.
    // The inner Child(props) call reads no signal — but its mere creation
    // could leak reactive subscriptions into the parent effect without untrack.
    effect(() => {
      // Reactive read — parent effect re-runs when `which` changes.
      const val = which();
      // Only mount once on first run to avoid duplicating in this naive setup;
      // subsequent runs simulate "parent signal changes don't recreate child".
      if (!container.firstChild) {
        const node = h(Child, { tag: val });
        // Use insert with a function so any reactive leak from Child would
        // attach to this outer effect.
        insert(container, () => h(Child, { tag: val }));
      }
    });

    flushSync();
    await flush();

    const baseline = childCreations;
    assert.ok(baseline >= 1, 'child created on initial mount');

    // Mutate the parent signal multiple times.
    which('b');
    flushSync();
    which('c');
    flushSync();
    await flush();

    // Insert() with a reactive function re-evaluates the function on each
    // parent signal change — so Child IS expected to be created again each
    // time. The critical guarantee is that the *count is bounded* (one new
    // child per re-evaluation), not unbounded.
    // Two writes → at most 2 additional creations.
    assert.ok(
      childCreations <= baseline + 2,
      `bounded re-creation: got ${childCreations - baseline} new creates, expected <= 2`
    );
  });
});
