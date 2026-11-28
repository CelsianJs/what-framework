// The island runtime's scheduling, as islands.d.ts describes it: autoIslands
// registers a registry and hydrates the page's islands, each when its mode
// says (load at once, visible when it comes within 200px of the viewport,
// action on the first interaction, static never), in priority order;
// boostIslandPriority moves a waiting island up; getIslandStatus reports what
// is registered, hydrated and waiting.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();
const { h } = await import('what-core');
const { renderToString } = await import('../src/index.js');
const { Island, autoIslands, boostIslandPriority, getIslandStatus } = await import('../src/islands.js');

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); };

// The IntersectionObserver the 'visible' mode makes, driven by the test.
const observers = [];
globalThis.IntersectionObserver = window.IntersectionObserver = class {
  constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; this.disconnected = false; observers.push(this); }
  observe(el) { this.targets.push(el); }
  disconnect() { this.disconnected = true; }
  enter(isIntersecting) { this.callback(this.targets.map((target) => ({ target, isIntersecting })), this); }
};

const order = [];
const component = (name) => async () => ({ default: ({ label }) => { order.push(name); return h('b', null, label ?? name); } });

function page(islands) {
  const host = document.createElement('div');
  host.innerHTML = islands.map(([name, mode, priority, props]) => renderToString(h(Island, { name, mode, priority, props }, h('b', null, (props && props.label) ?? name)))).join('');
  document.body.append(host);
  return host;
}

describe('autoIslands and getIslandStatus', () => {
  it('registers every entry, a loader or a config, and hydrates each island when its mode says', async () => {
    const host = page([['Now', 'load'], ['Seen', 'visible'], ['Touched', 'action'], ['Never', 'static']]);
    const hydrated = [];
    host.addEventListener('island:hydrated', (e) => hydrated.push(e.detail));
    autoIslands({
      Now: component('Now'),
      Seen: { loader: component('Seen'), mode: 'visible' },
      Touched: { loader: component('Touched'), mode: 'action', priority: 2 },
      Never: { loader: component('Never'), mode: 'static' },
    });
    await flush();
    assert.deepEqual(getIslandStatus().registered.sort(), ['Never', 'Now', 'Seen', 'Touched']);
    assert.deepEqual(hydrated, [{ name: 'Now', mode: 'load' }]);
    assert.equal(getIslandStatus().hydrated, 1);

    const seen = observers.at(-1);
    assert.equal(seen.options.rootMargin, '200px');
    seen.enter(false);
    await flush();
    assert.equal(hydrated.length, 1, 'not before it intersects');
    seen.enter(true);
    await flush();
    assert.equal(seen.disconnected, true);
    assert.deepEqual(hydrated.at(-1), { name: 'Seen', mode: 'visible' });

    host.querySelector('[data-island="Touched"]').dispatchEvent(new window.Event('mouseover'));
    await flush();
    assert.deepEqual(hydrated.at(-1), { name: 'Touched', mode: 'action' });
    assert.equal(getIslandStatus().hydrated, 3);
    assert.ok(host.querySelector('[data-island="Never"]'), 'a static island keeps its marker and never hydrates');
    assert.equal(getIslandStatus().pending, 0);
    host.remove();
  });
});

describe('boostIslandPriority', () => {
  // An island whose loader the test holds keeps the queue busy, so the rest
  // wait in it.
  let release;
  const held = () => new Promise((resolve) => { release = () => resolve({ default: () => { order.push('Held'); return h('b', null, 'Held'); } }); });

  it('moves every waiting instance of an island up, and never lowers one', async () => {
    order.length = 0;
    const host = page([['Held', 'load', 9], ['Low', 'load', 1], ['Mid', 'load', 5], ['Low', 'load', 1]]);
    autoIslands({ Held: held, Low: component('Low'), Mid: component('Mid') });
    await flush();
    const queued = () => getIslandStatus().queue.map((t) => `${t.name}:${t.priority}`);
    assert.deepEqual(queued(), ['Mid:1005', 'Low:1001', 'Low:1001'], 'load islands wait in priority order');

    boostIslandPriority('Low', 2000);
    assert.deepEqual(queued(), ['Low:2000', 'Low:2000', 'Mid:1005']);
    boostIslandPriority('Mid');
    assert.deepEqual(queued(), ['Low:2000', 'Low:2000', 'Mid:1005'], 'the default, 100, does not lower a load island');
    boostIslandPriority('Absent', 5000);

    release();
    await flush();
    assert.deepEqual(order, ['Held', 'Low', 'Low', 'Mid']);
    assert.equal(getIslandStatus().pending, 0);
    host.remove();
  });
});
