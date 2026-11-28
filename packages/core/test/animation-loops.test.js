// what-framework/motion's frame loops and gestures, run frame by frame:
// requestAnimationFrame queues its callback and frame(time) runs what is
// queued. spring() settles on its target and stops asking for frames; tween()
// follows its easing over its duration; both stop with their owner.
// useGesture reports drags, taps, swipes and long presses.
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
let queued = [];
let nextId = 1;
globalThis.requestAnimationFrame = window.requestAnimationFrame = (cb) => { const id = nextId++; queued.push({ id, cb }); return id; };
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = (id) => { queued = queued.filter((f) => f.id !== id); };
function frame(time) {
  const due = queued;
  queued = [];
  for (const f of due) f.cb(time);
}

const { spring, tween, useGesture } = await import('../src/animation.js');
const { createRoot, h, mount, useRef, signal: makeSignal } = await import('../src/index.js');
const { loadCompiled } = await import('../../../test-utils/load-compiled.js');

beforeEach(() => { queued = []; });

describe('spring', () => {
  it('moves toward its target, settles on it exactly and stops asking for frames', () => {
    const s = spring(0, { stiffness: 170, damping: 26 });
    s.set(100);
    assert.equal(s.isAnimating(), true);
    let time = 0;
    const seen = [];
    for (let i = 0; i < 500 && queued.length; i++) { frame(time); time += 16; seen.push(s.current()); }
    assert.equal(queued.length, 0, 'no frame left once settled');
    assert.equal(s.current(), 100);
    assert.equal(s.velocity(), 0);
    assert.equal(s.isAnimating(), false);
    assert.ok(seen[5] > 0 && seen[5] < 100, 'in between on the way');
  });

  it('a new target while it moves keeps one frame loop; stop() and snap() end it', () => {
    const s = spring(0);
    s.set(10);
    s.set(20);
    assert.equal(queued.length, 1, 'one loop');
    frame(0);
    frame(16);
    assert.equal(s.target(), 20);
    s.stop();
    assert.equal(queued.length, 0);
    assert.equal(s.isAnimating(), false);
    s.snap(5);
    assert.deepEqual([s.current(), s.target(), s.velocity()], [5, 5, 0]);
  });

  it('stops when its owner is disposed', () => {
    let s;
    const dispose = createRoot((d) => { s = spring(0); return d; });
    s.set(50);
    assert.equal(queued.length, 1);
    dispose();
    assert.equal(queued.length, 0);
  });
});

describe('tween', () => {
  it('follows its easing from `from` to `to` over the duration, then completes', () => {
    const updates = [];
    let completed = 0;
    const tw = tween(0, 100, { duration: 100, easing: (t) => t, onUpdate: (v, t) => updates.push([v, t]), onComplete: () => completed++ });
    frame(1000);
    frame(1050);
    assert.deepEqual(updates, [[0, 0], [50, 0.5]]);
    assert.equal(tw.isAnimating(), true);
    frame(1100);
    assert.equal(tw.value(), 100);
    assert.equal(tw.progress(), 1);
    assert.equal(tw.isAnimating(), false);
    assert.equal(completed, 1);
    assert.equal(queued.length, 0);
  });

  it('with a zero duration ends on its target', () => {
    const tw = tween(0, 100, { duration: 0 });
    frame(5);
    assert.equal(tw.value(), 100);
    assert.equal(tw.isAnimating(), false);
  });

  it('cancel() stops it, and so does its owner going away', () => {
    const tw = tween(0, 1, { duration: 100 });
    tw.cancel();
    assert.equal(queued.length, 0);
    assert.equal(tw.isAnimating(), false);
    let owned;
    const dispose = createRoot((d) => { owned = tween(0, 1, { duration: 100 }); return d; });
    frame(0);
    dispose();
    assert.equal(queued.length, 0);
    assert.equal(owned.isAnimating(), false);
  });
});

describe('useGesture', () => {
  const at = (type, x, y, target = window) => target.dispatchEvent(Object.assign(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y })));

  it('reports a drag, a swipe, a tap and a long press, each from its own start', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let now = 0;
    const realNow = performance.now;
    performance.now = () => now;
    try {
      const el = document.createElement('div');
      document.body.append(el);
      const log = [];
      const dispose = createRoot((d) => {
        useGesture(el, {
          onDragStart: (p) => log.push(['start', p.x, p.y]),
          onDrag: (p) => log.push(['drag', p.deltaX, p.deltaY]),
          onDragEnd: (p) => log.push(['end', p.deltaX, p.deltaY]),
          onSwipe: (p) => log.push(['swipe', p.direction]),
          onTap: (p) => log.push(['tap', p.x, p.y]),
          onLongPress: (p) => log.push(['long', p.x, p.y]),
        });
        return d;
      });

      // A fast drag to the right: a swipe.
      at('mousedown', 10, 10, el);
      now = 10;
      at('mousemove', 60, 12);
      at('mouseup', 60, 12);
      // A tap: no movement.
      now = 1000;
      at('mousedown', 5, 5, el);
      now = 1100;
      at('mouseup', 5, 5);
      // A long press: held still for 500 ms.
      at('mousedown', 7, 7, el);
      mock.timers.tick(500);
      at('mouseup', 7, 7);

      assert.deepEqual(log.slice(0, 8), [
        ['start', 10, 10], ['drag', 50, 2], ['swipe', 'right'], ['end', 50, 2],
        ['start', 5, 5], ['tap', 5, 5], ['end', 0, 0],
        ['start', 7, 7],
      ]);
      assert.deepEqual(log.slice(8), [['long', 7, 7], ['end', 0, 0]], 'a long press is not also a tap');

      const count = log.length;
      dispose();
      at('mousedown', 1, 1, el);
      at('mouseup', 1, 1);
      assert.equal(log.length, count, 'no listener after the owner is disposed');
      el.remove();
    } finally {
      performance.now = realNow;
      mock.timers.reset();
    }
  });

  // The component body runs before its element exists: a ref is read once the
  // output is in place, as useEffect runs.
  it('attaches to a ref object, a ref function and a signal once the element exists', async () => {
    const log = [];
    const compiled = await loadCompiled(`
      import { useRef } from 'what-framework';
      import { useGesture } from 'what-framework/motion';
      export function Compiled(p) {
        const ref = useRef(null);
        useGesture(ref, { onTap: () => p.log.push('compiled') });
        return <div id="compiled" ref={ref}>x</div>;
      }
      export function Getter(p) {
        let el;
        useGesture(() => el, { onTap: () => p.log.push('getter') });
        return <div id="getter" ref={el}>x</div>;
      }
    `);
    function WithH() {
      const ref = useRef(null);
      useGesture(ref, { onTap: () => log.push('h') });
      return h('div', { id: 'with-h', ref }, 'x');
    }
    const target = makeSignal(null);
    function WithSignal() {
      useGesture(target, { onTap: () => log.push('signal') });
      return h('div', { id: 'with-signal', ref: (el) => target(el) }, 'x');
    }
    const host = document.createElement('div');
    document.body.append(host);
    const unmount = mount(h('div', {}, h(WithH, {}), h(compiled.Compiled, { log }), h(compiled.Getter, { log }), h(WithSignal, {})), host);
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const id of ['with-h', 'compiled', 'getter', 'with-signal']) {
      at('mousedown', 1, 1, document.getElementById(id));
      at('mouseup', 1, 1);
    }
    assert.deepEqual(log, ['h', 'compiled', 'getter', 'signal']);
    const elements = ['with-h', 'compiled', 'getter', 'with-signal'].map((id) => document.getElementById(id));
    unmount();
    for (const el of elements) {
      at('mousedown', 1, 1, el);
      at('mouseup', 1, 1);
    }
    assert.equal(log.length, 4, 'no listener after unmount');
    host.remove();
  });
});
