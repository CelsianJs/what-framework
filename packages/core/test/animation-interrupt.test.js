// useAnimatedValue keeps one animation in flight, run frame by frame here
// (requestAnimationFrame queues its callback and frame(time) runs what is
// queued): a new spring() or timing() stops the one before, so the value
// ends on the newest target, and the owner going away stops it.
import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
let queued = [];
let nextId = 1;
globalThis.requestAnimationFrame = window.requestAnimationFrame = (cb) => { const id = nextId++; queued.push({ id, cb }); return id; };
globalThis.cancelAnimationFrame = window.cancelAnimationFrame = (id) => { queued = queued.filter((f) => f.id !== id); };
let clock = 0;
mock.method(performance, 'now', () => clock);
function frame(time) {
  clock = time;
  const due = queued;
  queued = [];
  for (const f of due) f.cb(time);
}
function settle(from, max = 3000) {
  let t = from;
  for (let i = 0; i < max && queued.length; i++) { t += 16; frame(t); }
  return t;
}

const { useAnimatedValue } = await import('../src/animation.js');
const { createRoot } = await import('../src/index.js');

beforeEach(() => { queued = []; clock = 0; });

describe('useAnimatedValue', () => {
  it('a second spring() before the first settles ends on the second target, with one frame loop', () => {
    let av;
    createRoot(() => { av = useAnimatedValue(0); });
    av.spring(100, { stiffness: 50, damping: 5 });
    let t = 0;
    for (let i = 0; i < 5; i++) { t += 16; frame(t); }
    av.spring(0);
    assert.equal(queued.length, 1, 'one frame loop');
    settle(t);
    assert.equal(av.value(), 0);
  });

  it('a spring() after a timing() replaces it', () => {
    let av;
    createRoot(() => { av = useAnimatedValue(0); });
    av.timing(100, { duration: 1000 });
    frame(16);
    frame(32);
    av.spring(-50);
    assert.equal(queued.length, 1, 'one frame loop');
    settle(32);
    assert.equal(av.value(), -50);
  });

  it('its owner going away stops the animation in flight', () => {
    let av;
    const dispose = createRoot((d) => { av = useAnimatedValue(0); return d; });
    av.spring(50);
    frame(16);
    frame(32);
    dispose();
    frame(48);
    assert.equal(queued.length, 0, 'no frame asked for');
  });

  it('stop() ends it where it is', () => {
    let av;
    createRoot(() => { av = useAnimatedValue(0); });
    const run = av.spring(80);
    frame(16);
    frame(32);
    run.stop();
    const at = av.value();
    frame(48);
    assert.equal(queued.length, 0);
    assert.equal(av.value(), at);
  });
});
