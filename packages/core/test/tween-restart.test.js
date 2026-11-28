// useTween's start() stops the run in flight, run frame by frame here
// (requestAnimationFrame queues its callback and frame(time) runs what is
// queued): progress follows the new run alone, the tween is transitioning
// until that run ends, only its callback runs, and the owner going away
// stops it.
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

const { useTween } = await import('../src/animation.js');
const { createRoot, effect, flushSync } = await import('../src/index.js');

beforeEach(() => { queued = []; clock = 0; });

describe('useTween', () => {
  it('start() again mid-run follows the new run alone; only its callback runs; the first promise resolves', async () => {
    let tw;
    createRoot(() => { tw = useTween({ duration: 100, easing: (x) => x }); });
    const seen = [];
    createRoot(() => effect(() => { seen.push(Math.round(tw.progress() * 100)); }));
    const calls = [];
    const first = tw.start(() => calls.push('first'));
    frame(50);
    flushSync();
    clock = 50;
    const second = tw.start(() => calls.push('second'));
    seen.length = 0;
    for (const time of [60, 100, 130, 151, 170]) { frame(time); flushSync(); }
    assert.deepEqual(seen, [10, 50, 80, 100]);
    assert.deepEqual(calls, ['second']);
    assert.equal(tw.isTransitioning(), false);
    assert.equal(queued.length, 0);
    await first;
    await second;
  });

  it('stays transitioning until the newest run ends', () => {
    let tw;
    createRoot(() => { tw = useTween({ duration: 100 }); });
    tw.start();
    frame(60);
    clock = 60;
    tw.start();
    frame(110);
    assert.equal(tw.isTransitioning(), true, 'the first run would have ended here');
    frame(170);
    assert.equal(tw.isTransitioning(), false);
  });

  it('its owner going away stops the run in flight', () => {
    let tw;
    const dispose = createRoot((d) => { tw = useTween({ duration: 100 }); return d; });
    tw.start();
    frame(20);
    dispose();
    frame(40);
    assert.equal(queued.length, 0);
  });
});
