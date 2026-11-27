// The stack a recursive component takes while it is built, level by level.
// Each level of a component that renders itself again holds its frames until
// the deepest level is built, so frames per level bound how deep a tree can
// go before the engine's stack runs out (in Chromium, a keyed tree overflowed
// near 210 levels at 21 frames a level). The counts here are what each shape
// costs now: a rise shows in this test before it shows as a shallower limit.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { mount, flushSync } = await import('../src/index.js');

const mod = await loadCompiled(`
  import { signal } from 'what-framework';
  let frames = -1;
  export const deepest = () => frames;
  function Leaf() { frames = new Error().stack.split('\\n').length; return <i id="leaf" />; }

  let budget = 0;
  function Chain() { const d = budget--; return <div>{d > 0 ? <Chain /> : <Leaf />}</div>; }
  export const chain = (n) => { budget = n; return <Chain />; };

  function Nested(props) { return <div>{props.d > 0 ? <Nested d={props.d - 1} /> : <Leaf />}</div>; }
  export const nested = (n) => <Nested d={n} />;

  const open = signal(true);
  function TreeNode({ node }) {
    return (
      <li>
        <span>{node.name}</span>
        {node.dir && open() ? <ul>{node.children.map((c) => <TreeNode key={c.id} node={c} />)}</ul> : <Leaf />}
      </li>
    );
  }
  export const tree = (n) => {
    let node = { id: n, name: 'n' + n, dir: false, children: [] };
    for (let i = n - 1; i >= 0; i--) node = { id: i, name: 'n' + i, dir: true, children: [node] };
    return <ul><TreeNode node={node} /></ul>;
  };
`);

// The frames a chain of `n` levels of `shape` holds at its deepest level.
function framesAt(shape, n) {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = Infinity;
  const el = document.createElement('div');
  document.body.appendChild(el);
  try {
    const dispose = mount(() => mod[shape](n), el);
    flushSync();
    assert.ok(el.querySelector('#leaf'), `${shape}: the deepest level was built`);
    dispose();
    return mod.deepest();
  } finally {
    Error.stackTraceLimit = limit;
    el.remove();
  }
}

const perLevel = (shape) => (framesAt(shape, 60) - framesAt(shape, 10)) / 50;

describe('the stack frames each level of a recursive component holds while it is built', () => {
  it('a component whose child is the next level: 4', () => {
    assert.equal(perLevel('chain'), 4);
  });

  it('a conditional on a prop that renders the next level: 8', () => {
    assert.equal(perLevel('nested'), 8);
  });

  it("a keyed list of the next level's components behind a condition (a file tree): 17", () => {
    assert.equal(perLevel('tree'), 17);
  });
});
