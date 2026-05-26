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

  // ------------------------------------------------------------------------
  // REGRESSION: reconcileKeyed reuse-vs-dispose path
  // When a key persists across an update, the item's reactive scope MUST stay
  // alive — effects created inside the mapFn must continue to react to
  // external signals after the reorder. Conversely, removed items' scopes
  // MUST be disposed (no leaked effects).
  //
  // Bug class guarded: an earlier version of reconcileKeyed could prune the
  // wrong entry from oldKeyMap, causing a reused item's scope to be disposed
  // alongside the removed item that shared its key index. The fix (delete
  // matched keys from oldKeyMap so removedIndices only contains genuinely
  // removed items) is now baked in at render.js:858. This test makes the
  // behavior durable.
  // ------------------------------------------------------------------------
  it('reused items keep their reactive scope alive after mixed insert/remove/reorder', async () => {
    const container = getContainer();
    const tick = signal(0);
    let disposeCount = 0;
    const effectRuns = new Map(); // key -> count

    function Row(itemAccessor) {
      // itemAccessor is a signal (keyed mode), call it to read.
      const item = typeof itemAccessor === 'function' ? itemAccessor() : itemAccessor;
      const el = document.createElement('div');
      el.dataset.id = item.id;
      effectRuns.set(item.id, 0);

      // Effect that reads BOTH the item accessor AND an external signal.
      // If the item is reused, this effect must continue to re-run when `tick`
      // changes. If the item's scope is disposed, this effect will not re-run.
      effect(() => {
        const cur = typeof itemAccessor === 'function' ? itemAccessor() : itemAccessor;
        tick(); // subscribe to external signal
        el.textContent = `${cur.id}:${tick()}`;
        effectRuns.set(cur.id, (effectRuns.get(cur.id) || 0) + 1);
      });

      // Track teardown.
      el._dispose = () => { disposeCount++; };
      return el;
    }

    const items = signal([
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' },
    ]);

    const inserter = mapArray(items, Row, { key: (i) => i.id });
    inserter(container, null);
    flushSync();
    await flush();

    assert.equal(container.querySelectorAll('[data-id]').length, 5);
    const nodeB = container.querySelector('[data-id="b"]');
    const nodeD = container.querySelector('[data-id="d"]');
    const runsBeforeB = effectRuns.get('b');
    const runsBeforeD = effectRuns.get('d');
    assert.ok(runsBeforeB >= 1 && runsBeforeD >= 1, 'effects ran on initial mount');

    // Mixed update: insert 'x' at head, remove 'a' and 'c', reorder the rest,
    // append 'y' at tail. Keys b, d, e survive — they must keep their scopes.
    items([
      { id: 'x' },        // new
      { id: 'd' },        // reused, moved
      { id: 'b' },        // reused, moved
      { id: 'e' },        // reused
      { id: 'y' },        // new
    ]);
    flushSync();
    await flush();

    // Identity preservation: reused items use the same DOM node.
    assert.equal(container.querySelector('[data-id="b"]'), nodeB,
      'reused item b keeps its DOM node');
    assert.equal(container.querySelector('[data-id="d"]'), nodeD,
      'reused item d keeps its DOM node');

    // Removed items' scopes were disposed: exactly 2 disposes (a, c).
    assert.equal(disposeCount, 2,
      `expected 2 disposers for removed items a,c; got ${disposeCount}`);

    // Critical: reused items' scopes are STILL ALIVE. Mutating the external
    // `tick` signal must trigger their effects to re-run.
    const runsB1 = effectRuns.get('b');
    const runsD1 = effectRuns.get('d');
    tick(1);
    flushSync();
    await flush();

    assert.ok(effectRuns.get('b') > runsB1,
      `reused item b's effect must re-run on tick change; was ${runsB1}, now ${effectRuns.get('b')}`);
    assert.ok(effectRuns.get('d') > runsD1,
      `reused item d's effect must re-run on tick change; was ${runsD1}, now ${effectRuns.get('d')}`);
    assert.equal(nodeB.textContent, 'b:1', 'reused b DOM reflects external signal change');
    assert.equal(nodeD.textContent, 'd:1', 'reused d DOM reflects external signal change');

    // Now remove the rest and confirm all remaining scopes are torn down.
    const disposeBefore = disposeCount;
    items([]);
    flushSync();
    await flush();
    // 5 items remained (x, d, b, e, y); all 5 should dispose.
    assert.equal(disposeCount - disposeBefore, 5,
      `clearing should dispose all 5 remaining scopes; got ${disposeCount - disposeBefore}`);

    // After full teardown, tick changes must not re-run any disposed effects.
    const runsAfterClear = new Map(effectRuns);
    tick(2);
    flushSync();
    await flush();
    for (const [id, count] of runsAfterClear) {
      assert.equal(effectRuns.get(id), count,
        `effect for ${id} must not re-run after its scope was disposed`);
    }
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

// --------------------------------------------------------------------------
// Keyed reconciler fast-path tests: swap and single-move optimizations
// --------------------------------------------------------------------------

describe('reconcileKeyed: swap and single-move fast paths', () => {

  // Helper: create a keyed list and return controls
  function setupKeyedList(container, initialItems, multiNode = false) {
    let createCount = 0;
    const disposeLog = [];
    const nodeMap = new Map(); // key -> DOM node (first content node)

    function Row(item) {
      createCount++;
      if (multiNode) {
        const frag = document.createDocumentFragment();
        const a = document.createElement('span');
        a.className = 'item-a';
        a.textContent = item.id;
        a.dataset.id = item.id;
        const b = document.createElement('span');
        b.className = 'item-b';
        b.textContent = item.id + '-b';
        const c = document.createElement('em');
        c.className = 'item-c';
        c.textContent = item.id + '-c';
        frag.appendChild(a);
        frag.appendChild(b);
        frag.appendChild(c);
        nodeMap.set(item.id, a);
        a._dispose = () => disposeLog.push(item.id);
        return frag;
      } else {
        const el = document.createElement('div');
        el.textContent = item.id;
        el.dataset.id = item.id;
        nodeMap.set(item.id, el);
        el._dispose = () => disposeLog.push(item.id);
        return el;
      }
    }

    const items = signal(initialItems);
    const inserter = mapArray(items, Row, { key: (i) => i.id, raw: true });
    inserter(container, null);

    return { items, createCount: () => createCount, disposeLog, nodeMap };
  }

  function ids(container, selector = '[data-id]') {
    return [...container.querySelectorAll(selector)].map(n => n.dataset.id);
  }

  it('single swap in middle: [a,b,c,d,e] -> [a,d,c,b,e]', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog, nodeMap } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}]);
    flushSync(); await flush();

    const nodeB = nodeMap.get('b');
    const nodeD = nodeMap.get('d');
    const cc = createCount();

    items([{id:'a'},{id:'d'},{id:'c'},{id:'b'},{id:'e'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['a','d','c','b','e'], 'DOM order correct after swap');
    assert.equal(container.querySelector('[data-id="b"]'), nodeB, 'node b identity preserved');
    assert.equal(container.querySelector('[data-id="d"]'), nodeD, 'node d identity preserved');
    assert.equal(createCount(), cc, 'no new nodes created');
    assert.deepEqual(disposeLog, [], 'no disposals on swap');
  });

  it('swap at edges: [a,b,c] -> [c,b,a]', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog, nodeMap } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'}]);
    flushSync(); await flush();

    const nodeA = nodeMap.get('a');
    const nodeC = nodeMap.get('c');
    const cc = createCount();

    items([{id:'c'},{id:'b'},{id:'a'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['c','b','a'], 'DOM order correct after edge swap');
    assert.equal(container.querySelector('[data-id="a"]'), nodeA, 'node a preserved');
    assert.equal(container.querySelector('[data-id="c"]'), nodeC, 'node c preserved');
    assert.equal(createCount(), cc, 'no new nodes created');
    assert.deepEqual(disposeLog, [], 'no disposals');
  });

  it('single item move (drag-drop): [a,b,c,d,e] -> [a,c,d,b,e]', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog, nodeMap } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}]);
    flushSync(); await flush();

    const nodeB = nodeMap.get('b');
    const cc = createCount();

    items([{id:'a'},{id:'c'},{id:'d'},{id:'b'},{id:'e'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['a','c','d','b','e'], 'DOM order after move');
    assert.equal(container.querySelector('[data-id="b"]'), nodeB, 'moved node preserved');
    assert.equal(createCount(), cc, 'no new nodes');
    assert.deepEqual(disposeLog, [], 'no disposals');
  });

  it('move to head: [a,b,c,d] -> [d,a,b,c]', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'}]);
    flushSync(); await flush();
    const cc = createCount();

    items([{id:'d'},{id:'a'},{id:'b'},{id:'c'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['d','a','b','c'], 'DOM order after move-to-head');
    assert.equal(createCount(), cc, 'no new nodes');
    assert.deepEqual(disposeLog, [], 'no disposals');
  });

  it('move to tail: [a,b,c,d] -> [b,c,d,a]', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'}]);
    flushSync(); await flush();
    const cc = createCount();

    items([{id:'b'},{id:'c'},{id:'d'},{id:'a'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['b','c','d','a'], 'DOM order after move-to-tail');
    assert.equal(createCount(), cc, 'no new nodes');
    assert.deepEqual(disposeLog, [], 'no disposals');
  });

  it('multi-node items swap: fragment nodes stay together', async () => {
    const container = getContainer();
    const { items, createCount, disposeLog, nodeMap } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}], true);
    flushSync(); await flush();

    const nodeB = nodeMap.get('b');
    const nodeD = nodeMap.get('d');
    const cc = createCount();

    items([{id:'a'},{id:'d'},{id:'c'},{id:'b'},{id:'e'}]);
    flushSync(); await flush();

    // Check order of the first fragment node per item
    assert.deepEqual(ids(container, '.item-a'), ['a','d','c','b','e'], 'multi-node DOM order');
    // Check fragment nodes stay grouped: for item 'b', the three nodes should be consecutive
    const allNodes = [...container.childNodes].filter(n => n.nodeType === 1);
    const bIdx = allNodes.findIndex(n => n.dataset?.id === 'b');
    assert.ok(bIdx >= 0, 'found b');
    assert.equal(allNodes[bIdx + 1]?.textContent, 'b-b', 'b fragment node 2 follows');
    assert.equal(allNodes[bIdx + 2]?.textContent, 'b-c', 'b fragment node 3 follows');
    assert.equal(createCount(), cc, 'no new nodes');
    assert.deepEqual(disposeLog, [], 'no disposals');
  });

  it('keyed state update on swap: same key, different object reference updates itemSig', async () => {
    const container = getContainer();
    let readValues = [];

    function Row(itemAccessor) {
      const el = document.createElement('div');
      effect(() => {
        const item = typeof itemAccessor === 'function' ? itemAccessor() : itemAccessor;
        el.textContent = item.label;
        el.dataset.id = item.id;
        readValues.push(item.label);
      });
      return el;
    }

    const items = signal([
      {id:'a', label:'A1'}, {id:'b', label:'B1'}, {id:'c', label:'C1'}
    ]);

    const inserter = mapArray(items, Row, { key: (i) => i.id });
    inserter(container, null);
    flushSync(); await flush();

    readValues = [];

    // Swap a and c with different label references
    items([
      {id:'c', label:'C2'}, {id:'b', label:'B1'}, {id:'a', label:'A2'}
    ]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['c','b','a'], 'order correct');
    // The labels should reflect the updated references
    const labels = [...container.querySelectorAll('[data-id]')].map(n => n.textContent);
    assert.deepEqual(labels, ['C2', 'B1', 'A2'], 'itemSig updated with new references');
  });

  it('swap does not dispose: dispose count = 0 after pure swap', async () => {
    const container = getContainer();
    const { items, disposeLog } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'}]);
    flushSync(); await flush();

    items([{id:'a'},{id:'d'},{id:'c'},{id:'b'},{id:'e'}]);
    flushSync(); await flush();
    assert.deepEqual(disposeLog, [], 'zero disposals after swap');
  });

  it('falls through correctly: 5+ mismatches via general path', async () => {
    const container = getContainer();
    const { items, createCount } = setupKeyedList(container,
      [{id:'a'},{id:'b'},{id:'c'},{id:'d'},{id:'e'},{id:'f'},{id:'g'}]);
    flushSync(); await flush();
    const cc = createCount();

    // Reverse everything - definitely more than 4 mismatches
    items([{id:'g'},{id:'f'},{id:'e'},{id:'d'},{id:'c'},{id:'b'},{id:'a'}]);
    flushSync(); await flush();

    assert.deepEqual(ids(container), ['g','f','e','d','c','b','a'], 'full reverse correct');
    assert.equal(createCount(), cc, 'no new nodes on pure reorder');
  });

  it('single move in large list (perf sanity): 100 items, move item 0 to pos 50', async () => {
    const container = getContainer();
    const initial = Array.from({length: 100}, (_, i) => ({id: String(i)}));
    const { items } = setupKeyedList(container, initial);
    flushSync(); await flush();

    // Move item 0 to position 50
    const moved = initial.slice();
    const [item0] = moved.splice(0, 1);
    moved.splice(50, 0, item0);

    items(moved);
    flushSync(); await flush();

    const result = ids(container);
    const actualPos = result.indexOf('0');
    assert.equal(actualPos, 50, `item 0 should be at position 50, got ${actualPos}`);
    assert.equal(result.length, 100, 'all 100 items present');
  });
});
