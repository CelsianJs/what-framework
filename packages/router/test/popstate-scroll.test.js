// Back/forward restores the position saved for the entry it lands on, and
// only once it has landed there: a back/forward that a guard cancels, or that
// a newer navigation supersedes, leaves the scroll to the page on screen.
// Without enableScrollRestoration(), which would scroll the newer page itself
// and hide the stray restore.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { window } = installDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });

let x = 0;
let y = 0;
let scrolls = [];
Object.defineProperty(window, 'scrollX', { get: () => x, configurable: true });
Object.defineProperty(window, 'scrollY', { get: () => y, configurable: true });
window.scrollTo = (toX, toY) => {
  scrolls.push([toX, toY]);
  x = toX;
  y = toY;
};

const { navigate, beforeNavigate, route } = await import('../src/index.js');

async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => { scrolls = []; });

describe('back/forward scroll restoration', () => {
  it('restores the saved position of the entry it lands on', async () => {
    await navigate('/a');
    y = 300;
    await navigate('/b');
    y = 0;
    history.back();
    await flush();
    assert.equal(route.url, '/a');
    assert.deepEqual(scrolls, [[0, 300]]);
  });

  it('leaves the page alone when a guard cancels the back/forward', async () => {
    await navigate('/c');
    y = 500;
    await navigate('/d');
    y = 40;
    const stop = beforeNavigate(() => false);
    try {
      history.back();
      await flush();
    } finally {
      stop();
    }
    assert.equal(route.url, '/d', 'the guard kept the page');
    assert.deepEqual(scrolls, [], 'no scroll to the offset of /c, the page the guard declined');
  });

  it('leaves the page alone when a newer navigation supersedes the back/forward', async () => {
    await navigate('/e');
    y = 700;
    await navigate('/f');
    y = 0;
    let release;
    const stop = beforeNavigate(() => new Promise((resolve) => { release = resolve; }));
    history.back();
    await flush();
    stop();
    await navigate('/g');
    release(true);
    await flush();
    assert.equal(route.url, '/g');
    assert.deepEqual(scrolls, [], 'no scroll to the offset of /e on /g');
  });
});
