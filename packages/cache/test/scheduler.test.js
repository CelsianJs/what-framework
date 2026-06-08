import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../src/scheduler.js';

// Injected fake timer: captures scheduled callbacks so we can fire them by hand.
function fakeTimers() {
  const timers = [];
  const setTimer = (fn, ms) => {
    const t = { fn, ms, cleared: false };
    timers.push(t);
    return t;
  };
  const clearTimer = (t) => { if (t) t.cleared = true; };
  const fireLast = async () => {
    const t = timers[timers.length - 1];
    if (t && !t.cleared) await t.fn();
  };
  return { setTimer, clearTimer, timers, fireLast };
}

function fakeEngine() {
  const regen = [];
  return { regen, regenerate: async (route) => { regen.push(route.path); } };
}

describe('poll scheduler', () => {
  it('schedules a timer per registered route on start', () => {
    const tm = fakeTimers();
    const engine = fakeEngine();
    const s = createScheduler(engine, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, random: () => 0 });
    s.register({ path: '/a', config: {} }, { intervalMs: 1000 });
    s.register({ path: '/b', config: {} }, { intervalMs: 2000 });
    s.start();
    assert.equal(tm.timers.length, 2);
  });

  it('applies jitter within [interval, interval*1.1]', () => {
    const tm = fakeTimers();
    const s = createScheduler(fakeEngine(), { setTimer: tm.setTimer, clearTimer: tm.clearTimer, random: () => 1 });
    s.register({ path: '/a', config: {} }, { intervalMs: 1000 });
    s.start();
    assert.equal(tm.timers[0].ms, 1100); // 1000 * (1 + 1*0.1)
  });

  it('firing a timer regenerates the route', async () => {
    const tm = fakeTimers();
    const engine = fakeEngine();
    const s = createScheduler(engine, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, random: () => 0 });
    s.register({ path: '/a', config: {} }, { intervalMs: 1000 });
    s.start();
    await tm.fireLast();
    assert.deepEqual(engine.regen, ['/a']);
  });

  it('reschedules after each tick', async () => {
    const tm = fakeTimers();
    const s = createScheduler(fakeEngine(), { setTimer: tm.setTimer, clearTimer: tm.clearTimer, random: () => 0 });
    s.register({ path: '/a', config: {} }, { intervalMs: 1000 });
    s.start();
    assert.equal(tm.timers.length, 1);
    await tm.fireLast();
    assert.equal(tm.timers.length, 2, 'a new timer is scheduled after the tick');
  });

  it('stop() clears timers and prevents further regeneration', async () => {
    const tm = fakeTimers();
    const engine = fakeEngine();
    const s = createScheduler(engine, { setTimer: tm.setTimer, clearTimer: tm.clearTimer, random: () => 0 });
    s.register({ path: '/a', config: {} }, { intervalMs: 1000 });
    s.start();
    s.stop();
    assert.ok(tm.timers[0].cleared);
    await tm.fireLast(); // cleared -> no-op
    assert.equal(engine.regen.length, 0);
  });
});
