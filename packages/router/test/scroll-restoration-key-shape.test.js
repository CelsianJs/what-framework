// Tests for What Framework - Router scroll restoration (#12)
//
// enableScrollRestoration() has three writers and one reader, and before this
// suite they disagreed about BOTH the stored shape and the key:
//
//   - navigate() and the popstate handler store `{ x, y }` keyed by the FULL url
//     ("/list?tab=1"),
//   - enableScrollRestoration's own beforeunload handler stored a plain NUMBER
//     keyed by location.pathname ("/list"),
//   - the restore effect looked up `route.path` (the path only) and passed the
//     result straight to `window.scrollTo(0, savedPosition)`.
//
// So a hit on a `{ x, y }` entry produced `scrollTo(0, NaN)` (which browsers
// normalize to 0, jumping the page to the top), and any url carrying a query
// string or a hash missed the lookup entirely.
//
// Agreeing on the key made a SECOND rule load-bearing, and the second half of
// this file gates it: the reader checks `hash` BEFORE `saved`. Now that the map
// is keyed by the full url, a hash url the user has already visited always has
// a saved offset, so a saved-first reader makes the hash branch unreachable for
// exactly the urls that most need it, and it also clobbers the scrollIntoView
// that navigate()'s own same-page hash branch just performed.
//
// These tests exercise the reader through the public API only: navigate away,
// come back, and assert where the page ended up.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
});
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.SVGElement = dom.window.SVGElement;
global.history = dom.window.history;
global.location = dom.window.location;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

// A controllable viewport: the router reads window.scrollX/scrollY when it saves
// a position, and calls window.scrollTo when it restores one.
let _scrollX = 0;
let _scrollY = 0;
let scrollCalls = [];
// One ordered log of BOTH kinds of scroll. Several of the tests below turn on
// which of the two won, and a separate counter per kind cannot see that.
let events = [];
Object.defineProperty(dom.window, 'scrollX', { get: () => _scrollX, configurable: true });
Object.defineProperty(dom.window, 'scrollY', { get: () => _scrollY, configurable: true });
dom.window.scrollTo = (...args) => {
  scrollCalls.push(args);
  events.push(`scrollTo(${args.join(', ')})`);
};

function setScroll(x, y) { _scrollX = x; _scrollY = y; }

// An anchor that reports being scrolled into view, in order, into the same log.
// The router calls scrollIntoView() bare when it restores and
// scrollIntoView({ behavior: 'smooth' }) from navigate()'s same-page hash
// branch, so the log distinguishes them.
function mountAnchor(id) {
  const el = dom.window.document.createElement('div');
  el.id = id;
  el.scrollIntoView = (o) => { events.push(`anchor#${id}${o?.behavior ? ':' + o.behavior : ''}`); };
  dom.window.document.body.appendChild(el);
  return el;
}

const { navigate, enableScrollRestoration } = await import('../src/index.js');

// Effects flush on a microtask and the restore itself lands in a
// requestAnimationFrame (stubbed to setTimeout 0), so a few macrotask ticks
// drain both queues.
async function flush() {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
}

// One restoration effect for the whole file: enableScrollRestoration() is
// documented as "call once at app entry", and calling it per test would stack
// live effects on the singleton route state.
enableScrollRestoration();

// The effect runs once on install, and that run is the only one a test cannot
// observe from inside a test body. Snapshot it here, before beforeEach clears
// the log, so the boot-time assertion below has something to read.
await flush();
const bootEvents = events.slice();

function lastScroll() {
  return scrollCalls[scrollCalls.length - 1];
}

describe('enableScrollRestoration', () => {
  beforeEach(() => { scrollCalls = []; events = []; });

  it('restores the saved position for a url with a query string', async () => {
    await navigate('/list?tab=1');
    await flush();

    // User scrolls down the list.
    setScroll(0, 420);

    // Navigate away — navigate() saves { x: 0, y: 420 } for "/list?tab=1".
    await navigate('/detail');
    await flush();
    setScroll(0, 0);

    scrollCalls = [];
    await navigate('/list?tab=1');
    await flush();

    assert.deepEqual(lastScroll(), [0, 420]);
  });

  it('keys a url with a hash by that full url, hash included', async () => {
    // This assertion used to be made forward-wise: navigate to "/docs#install"
    // a second time and expect the saved offset back. That is the wrong claim,
    // and asserting it is how the hash branch got shadowed in the first place.
    // A hash is a request for an element and outranks a saved offset (the
    // precedence suite below owns that rule), so back/forward is where a hash
    // url's entry is legitimately consumed, and therefore where its key and
    // its { x, y } shape are observable.
    await navigate('/docs#install');
    await flush();

    setScroll(0, 300);
    await navigate('/pricing');
    await flush();
    setScroll(0, 0);

    scrollCalls = [];
    history.back();
    await flush();
    await flush();

    assert.deepEqual(lastScroll(), [0, 300]);
  });

  it('passes a NUMBER to scrollTo, not the stored { x, y } record', async () => {
    await navigate('/plain');
    await flush();

    setScroll(0, 250);
    await navigate('/elsewhere');
    await flush();
    setScroll(0, 0);

    scrollCalls = [];
    await navigate('/plain');
    await flush();

    const [x, y] = lastScroll();
    assert.equal(typeof x, 'number', `scrollTo x was ${JSON.stringify(x)}`);
    assert.equal(typeof y, 'number', `scrollTo y was ${JSON.stringify(y)}`);
    assert.ok(!Number.isNaN(y), 'scrollTo y was NaN');
    assert.deepEqual([x, y], [0, 250]);
  });

  it('restores horizontal scroll too', async () => {
    await navigate('/wide');
    await flush();

    setScroll(640, 120);
    await navigate('/narrow');
    await flush();
    setScroll(0, 0);

    scrollCalls = [];
    await navigate('/wide');
    await flush();

    assert.deepEqual(lastScroll(), [640, 120]);
  });

  it('does not restore one url\'s position onto a different url that shares its path', async () => {
    // "/search?q=a" and "/search" are different documents as far as the user is
    // concerned. Keying by path (or writing on beforeunload keyed by
    // location.pathname) leaks the scrolled position of one onto the other.
    await navigate('/search?q=a');
    await flush();

    setScroll(0, 700);
    // A reload prompt the user then cancels: beforeunload fires without the
    // document going away.
    dom.window.dispatchEvent(new dom.window.Event('beforeunload'));

    scrollCalls = [];
    await navigate('/search'); // never visited before — must land at the top
    await flush();

    assert.deepEqual(lastScroll(), [0, 0]);
  });

  it('scrolls a hash target into view when the url has no saved position', async () => {
    const target = dom.window.document.createElement('div');
    target.id = 'target';
    let intoView = 0;
    target.scrollIntoView = () => { intoView++; };
    dom.window.document.body.appendChild(target);

    setScroll(0, 900);
    scrollCalls = [];
    await navigate('/anchors#target');
    await flush();

    assert.equal(intoView, 1);
    assert.equal(scrollCalls.length, 0, 'a hash target must not also be scrolled to the top');
    target.remove();
  });

  it('scrolls to the top of a url with no saved position', async () => {
    setScroll(0, 900);
    scrollCalls = [];
    await navigate('/never-seen-before');
    await flush();

    assert.deepEqual(lastScroll(), [0, 0]);
  });

  // REGRESSION GUARD: back/forward restoration already worked through the
  // router's built-in popstate handler. It has to keep working, and the restore
  // effect must not land a scroll-to-top AFTER it.
  it('still restores on back/forward (popstate)', async () => {
    await navigate('/p1?a=1');
    await flush();

    setScroll(0, 150);
    await navigate('/p2');
    await flush();
    setScroll(0, 0);

    scrollCalls = [];
    history.back();
    await flush();
    await flush();

    assert.deepEqual(lastScroll(), [0, 150]);
  });
});

// The reader checks `hash` before `saved`. Keying the map by the full url is
// what makes the order matter: every hash url the user has already visited
// carries a saved offset, so a saved-first reader can never reach the hash
// branch for one.
describe('enableScrollRestoration hash precedence', () => {
  beforeEach(() => { scrollCalls = []; events = []; });

  it('sends a re-clicked hash link to its anchor, not to the offset saved for that url', async () => {
    const el = mountAnchor('api');
    await navigate('/guide#api');
    await flush();

    // Read past the anchor, then leave: navigate() saves { 0, 640 } under the
    // FULL url "/guide#api", hash included.
    setScroll(0, 640);
    await navigate('/blog');
    await flush();
    setScroll(0, 0);

    events = [];
    scrollCalls = [];
    await navigate('/guide#api'); // the same link in the nav bar, clicked again
    await flush();

    assert.deepEqual(events, ['anchor#api'], 'a hash link must land on its anchor');
    assert.equal(scrollCalls.length, 0, 'the saved offset must not preempt the anchor');
    el.remove();
  });

  it('does not clobber the in-page anchor scroll navigate() just performed', async () => {
    const el = mountAnchor('section');
    await navigate('/doc#section');
    await flush();

    setScroll(0, 900);
    await navigate('/other'); // saves { 0, 900 } under "/doc#section"
    await flush();
    await navigate('/doc');
    await flush();
    setScroll(0, 0);

    events = [];
    // An in-page anchor click. navigate()'s same-page hash branch scrolls the
    // element into view synchronously; the restore effect must not then drag
    // the user back to the offset saved for "/doc#section" a frame later.
    await navigate('#section');
    await flush();

    assert.deepEqual(events, ['anchor#section:smooth', 'anchor#section']);
    el.remove();
  });

  it('leaves the page alone when a hash url\'s anchor has not rendered yet', async () => {
    // No element with this id exists. The anchor may simply be late (the rAF
    // exists to give it a frame), so neither the saved offset nor the top is a
    // defensible place to dump the user.
    await navigate('/pinned#late');
    await flush();

    setScroll(0, 640);
    await navigate('/blog2'); // saves { 0, 640 } under "/pinned#late"
    await flush();
    setScroll(0, 0);

    events = [];
    await navigate('/pinned#late');
    await flush();

    assert.deepEqual(events, []);
  });

  it('back/forward onto a saved hash url still lands on the saved offset', async () => {
    // Hash-before-saved governs forward navigations only. Back/forward restores
    // through the router's own popstate handler, which runs its restore after
    // this effect, so the offset still wins there. This is the whole reason the
    // precedence flip is safe.
    const el = mountAnchor('api2');
    await navigate('/guide2#api2');
    await flush();

    setScroll(0, 640);
    await navigate('/blog3');
    await flush();
    setScroll(0, 0);

    events = [];
    scrollCalls = [];
    history.back();
    await flush();
    await flush();

    assert.deepEqual(lastScroll(), [0, 640]);
    el.remove();
  });

  it('does not throw on a fragment that is not a valid CSS selector', async () => {
    // "#1" is a legal id and browsers navigate to it, but querySelector('#1')
    // throws "Invalid selector". The throw happened inside the rAF callback,
    // where nothing could catch it, so it surfaced as an uncaught error.
    const el = mountAnchor('1');

    events = [];
    await navigate('/faq#1');
    await flush();

    assert.deepEqual(events, ['anchor#1'], 'a numeric fragment must resolve, not throw');
    el.remove();
  });

  it('does not scroll to the top on its first run', async () => {
    // The first run is the url the document loaded with, not a navigation this
    // router performed. The browser has already positioned the document, and
    // on a reload that position is the user's restored offset, which
    // history.scrollRestoration owns and this effect must not undo.
    assert.deepEqual(bootEvents, []);
  });
});
