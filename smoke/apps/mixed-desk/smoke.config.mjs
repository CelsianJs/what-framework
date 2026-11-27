// Mixed desk smoke contract.
//
// A team moving off React keeps its screens' React libraries and replaces
// the shell first: router, layout and store become native What, and the
// libraries' components are used as plain JSX tags in native files. This
// app is that desk. The check drives it as a trader would and measures what
// crosses the boundary:
//
// - What signals into React components at 100 writes a second for 10 s, and
//   React state lifted into the store at 100 a second, with nothing lost or
//   stale, and each React component rendering only for its own data
//   (window.__probes counts renders, mounts and unmounts);
// - React components mounting and unmounting across 30 route changes while
//   the feed runs, releasing every component, listener, timer, observer and
//   subscription (wrapped before the app loads and counted), with no React
//   warning or error in the console;
// - context both ways, refs, a Radix dialog over a What page (focus in,
//   trapped, Escape, focus back), toasts in portals, a React onChange beside
//   a native field;
// - 10,000 deals from one signal in a react-window list and a TanStack
//   table, each update timed in the page from the write to the DOM;
// - a native page around a React island rendered on the server, typed into
//   before it hydrates, and hydrated without creating an element.
//
// The libraries are real npm packages at the versions package.json pins:
// recharts, TanStack Table, react-window, react-hook-form, Radix Dialog,
// sonner and framer-motion (all in REACT-COMPAT.md's matrix), and
// react-toastify, react-dropzone, React Flow, @hello-pangea/dnd, react-intl,
// react-spring, valtio and embla (not in it).

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const RATE = 100;
const RUN_MS = 10_000;
const CHURN_CYCLES = 5;
const ROUTES = ['dashboard', 'deals', 'forms', 'overlays', 'motion', 'upload', 'tools'];
const BUDGET = { rowUpdate: 25, tableUpdate: 250, bulkUpdate: 400 };
const HEAP_GROWTH_BOUND = 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Every wait goes through a locator: page.waitForSelector() returns an
// element handle, which keeps the element alive after the page drops it,
// and with it, through its React handlers, the state of the components that
// rendered it (a whole TanStack table per visit), so the heap check would
// measure the check.

// Errors and warnings in the console. Firefox's note that a page "appears to
// use a scroll-linked positioning effect" is its own heuristic about a scroll
// handler that moves elements (react-window's), not a warning the page gave.
const consoleNoise = (diag) => [...diag.errors, ...diag.warnings].filter((line) => !/scroll-linked positioning effect/.test(line));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const fmt = (xs) => `median ${pct(xs, 0.5).toFixed(1)}ms, p90 ${pct(xs, 0.9).toFixed(1)}ms, max ${Math.max(...xs).toFixed(1)}ms over ${xs.length}`;

// In the page before the app: what is live on the page's global targets.
// Intervals, pending timeouts and animation frames; listeners on the window,
// the document and the body (by target, type, capture and function, so
// adding one twice counts once, as the browser does); and Resize,
// Intersection and Mutation observers that observe something.
const INIT = `
  (() => {
    const res = { intervals: new Set(), timeouts: new Set(), frames: new Set(), listeners: new Map(), observers: new Set() };
    window.__res = res;
    const si = window.setInterval.bind(window), ci = window.clearInterval.bind(window);
    window.setInterval = (fn, ms, ...a) => { const id = si(fn, ms, ...a); res.intervals.add(id); return id; };
    window.clearInterval = (id) => { res.intervals.delete(id); return ci(id); };
    const st = window.setTimeout.bind(window), ct = window.clearTimeout.bind(window);
    window.setTimeout = (fn, ms, ...a) => {
      const id = st((...b) => { res.timeouts.delete(id); return typeof fn === 'function' ? fn(...b) : undefined; }, ms, ...a);
      res.timeouts.add(id);
      return id;
    };
    window.clearTimeout = (id) => { res.timeouts.delete(id); return ct(id); };
    const raf = window.requestAnimationFrame.bind(window), caf = window.cancelAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => { const id = raf((t) => { res.frames.delete(id); fn(t); }); res.frames.add(id); return id; };
    window.cancelAnimationFrame = (id) => { res.frames.delete(id); return caf(id); };
    const name = (t) => (t === window ? 'window' : t === document ? 'document' : t === document.body ? 'body' : null);
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const keyOf = (t, type, opts) => name(t) + ':' + type + ':' + !!(typeof opts === 'object' && opts ? opts.capture : opts);
    EventTarget.prototype.addEventListener = function (type, fn, opts) {
      if (name(this) && fn) { const k = keyOf(this, type, opts); if (!res.listeners.has(k)) res.listeners.set(k, new Set()); res.listeners.get(k).add(fn); }
      return add.call(this, type, fn, opts);
    };
    EventTarget.prototype.removeEventListener = function (type, fn, opts) {
      if (name(this) && fn) res.listeners.get(keyOf(this, type, opts))?.delete(fn);
      return remove.call(this, type, fn, opts);
    };
    for (const Kind of ['ResizeObserver', 'IntersectionObserver', 'MutationObserver']) {
      const Base = window[Kind];
      if (!Base) continue;
      window[Kind] = class extends Base {
        observe(...a) { res.observers.add(this); return super.observe(...a); }
        disconnect() { res.observers.delete(this); return super.disconnect(); }
      };
    }
    window.__snapshot = () => {
      const listeners = {};
      for (const [k, s] of res.listeners) if (s.size) listeners[k] = s.size;
      return {
        intervals: res.intervals.size, timeouts: res.timeouts.size, frames: res.frames.size, observers: res.observers.size,
        listeners, nodes: document.body.getElementsByTagName('*').length,
      };
    };
  })();
`;

export default {
  description: 'Compiled SPA with a native What shell (router, layout, signals store) hosting components from fifteen React packages, data flowing both ways under load, and a server-rendered page whose React island hydrates.',

  // WHAT_SMOKE_MODE=dev runs `npm run dev` (server.js --dev): the desk and
  // the quote page through Vite's dev server (smoke/README.md).
  dev: true,

  covers: [
    'stream:update-rate',
    'stream:no-loss',
    'react:signal-props',
    'react:lift-state',
    'react:route-churn',
    'react:context-bridge',
    'react:portal-focus',
    'react:events',
    'react:large-list',
    'react:island-hydration',
    'react:unlisted-libraries',
  ],

  async check({ workDir, appPort, mode, browser, browserName, check, skip, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    // In dev mode, `npm run dev` (server.js --dev): the desk and the quote
    // page from the source through Vite's dev server.
    if (mode !== 'dev') {
      const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
      reporter.assert(/built in/.test(buildLog), 'vite build produced the desk, the quote page and its server bundle', buildLog.trim().split('\n').pop());
    }
    const server = startProcess('node', ['server.js', ...(mode === 'dev' ? ['--dev'] : [])], { cwd: workDir, env: { ...process.env, PORT: String(appPort) } });
    await waitForHttp(`${base}/`, { child: server });

    const context = await browser.newContext();
    await context.addInitScript(INIT);
    try {
      await withPage(browser, `${base}/`, async (page, diag) => {
        await page.locator('[data-route="dashboard"] [data-quote="AMD"]').first().waitFor();
        const go = async (id) => {
          await page.click(`[data-nav="${id}"]`);
          await page.locator(`[data-route="${id}"]`).first().waitFor();
        };

        await streamChecks(page, { check, reporter, log });
        await largeListChecks(page, { check, reporter, log, go });
        await formChecks(page, { check, reporter, go });
        await overlayChecks(page, { check, reporter, go });
        await libraryChecks(page, { check, reporter, go });
        await toolsChecks(page, { check, go });
        await churnChecks(page, { check, skip, log, go, browserName });

        const noise = consoleNoise(diag);
        check('react:route-churn', noise.length === 0,
          'no React warning or error reached the console in the whole session',
          noise.length ? noise.slice(0, 3).join(' | ') : 'console clean');
      }, { context });

      await hydrationChecks(browser, base, { check, reporter });
    } finally {
      await context.close();
    }
  },
};

// === 100 writes a second into React, 100 lifted values a second out =========

async function streamChecks(page, { check, reporter, log }) {
  const read = () => page.evaluate(() => {
    const d = window.__desk;
    const p = window.__probes;
    const text = (sel) => document.querySelector(sel)?.textContent;
    const syms = Object.keys(d.prices);
    return {
      emitted: window.__feed.emitted,
      listeners: window.__feed.listeners.size,
      writes: { ...d.writes },
      last: { ...d.lastWrite },
      renders: { ...p.renders },
      tiles: Object.fromEntries(syms.map((s) => [s, Number(text(`[data-quote="${s}"] [data-price]`))])),
      board: Object.fromEntries(syms.map((s) => [s, Number(text(`[data-board-row="${s}"] b`))])),
      sig: Object.fromEntries(syms.map((s) => [s, Number(text(`[data-sigquote="${s}"]`))])),
      native: Object.fromEntries(syms.map((s) => [s, Number(text(`[data-native-price="${s}"]`))])),
      tape: [...document.querySelectorAll('[data-tape] li')].map((li) => Number(li.dataset.seq)),
      lifterN: Number(text('[data-lifter-n]')),
      echo: Number(text('[data-lifter-echo]')),
      lifted: Number(text('[data-lifted]')),
      liftLog: window.__liftLog.slice(),
      chartPoints: document.querySelectorAll('[data-chart] .recharts-line-curve').length,
      chartPath: document.querySelector('[data-chart] .recharts-line-curve')?.getAttribute('d')?.length ?? 0,
    };
  });

  const before = await read();
  const t0 = Date.now();
  await page.evaluate((rate) => window.__desk.startFeed(rate), RATE);
  await page.click('[data-lift-toggle]');
  const midSamples = [];
  while (Date.now() - t0 < RUN_MS) {
    await sleep(1000);
    // Mid-run: every tile shows the last price written to its symbol by the
    // end of the frame that renders it.
    midSamples.push(await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => {
      const d = window.__desk;
      const stale = Object.keys(d.prices).filter((s) => Number(document.querySelector(`[data-quote="${s}"] [data-price]`).textContent) !== d.lastWrite[s]);
      r(stale.length);
    }))));
  }
  await page.click('[data-lift-toggle]');
  await page.evaluate(() => window.__desk.stopFeed());
  const elapsed = (Date.now() - t0) / 1000;
  await sleep(300);
  const after = await read();

  const sent = after.emitted - before.emitted;
  const liftedCount = after.liftLog.length - before.liftLog.length;
  check('stream:update-rate', sent / elapsed >= RATE * 0.85 && sent / elapsed <= RATE * 1.1,
    `the store took ${RATE} writes a second for ${RUN_MS / 1000} s into React islands`,
    `${(sent / elapsed).toFixed(0)}/s, ${sent} writes in ${elapsed.toFixed(1)}s`);

  const syms = Object.keys(after.tiles);
  const quiet = ['TSLA', 'AMD'];
  const stale = syms.filter((s) => after.tiles[s] !== after.last[s] || after.board[s] !== after.last[s] || after.sig[s] !== after.last[s] || after.native[s] !== after.last[s]);
  const tapeOk = after.tape[0] === after.emitted && after.tape.every((n, i) => i === 0 || n === after.tape[i - 1] - 1);
  check('stream:no-loss', stale.length === 0 && tapeOk && after.listeners === 1 && midSamples.every((n) => n === 0),
    'every write reached its React tile, the React board, the React readers of the signal and the native text, and the React tape subscribed to the feed saw every trade in order',
    `stale=${stale.join(',') || 'none'} mid-run-stale=${midSamples.join('/')} tape-top=${after.tape[0]} emitted=${after.emitted} feed-listeners=${after.listeners}`);

  // Renders: at most one per write of the component's own symbol, none for a
  // symbol nobody wrote, and the memo rows of the board likewise.
  const delta = (name) => (after.renders[name] ?? 0) - (before.renders[name] ?? 0);
  const over = [];
  for (const s of syms) {
    const w = after.writes[s] - before.writes[s];
    for (const kind of ['quote', 'board', 'signal']) {
      const r = delta(`${kind}:${s}`);
      if (quiet.includes(s) ? r !== 0 : r > w || r === 0) over.push(`${kind}:${s}=${r}/${w}`);
    }
  }
  const tileRenders = syms.reduce((n, s) => n + delta(`quote:${s}`), 0);
  check('react:signal-props', over.length === 0 && delta('board') <= sent,
    'a React component fed by a What signal renders only for its own data: once per write at most, never for a quiet symbol, memo rows of one board only for their own row',
    `${over.length ? `over=${over.slice(0, 4).join(' ')}` : 'each within its writes'}; tiles rendered ${tileRenders} for ${sent} writes, board ${delta('board')}, quiet tiles ${quiet.map((s) => delta(`quote:${s}`)).join('/')}`);
  reporter.assert(after.chartPoints === 1 && after.chartPath > 50, 'the recharts line of the focused symbol follows the store', `curves=${after.chartPoints} path-length=${after.chartPath}`);

  const log2 = after.liftLog.slice(before.liftLog.length);
  const inOrder = log2.every((v, i) => v === (before.liftLog.at(-1) ?? 0) + i + 1);
  check('react:lift-state',
    liftedCount / elapsed >= RATE * 0.85 && inOrder && after.lifterN === log2.at(-1) && after.lifted === after.lifterN && after.echo === after.lifterN,
    `React state lifted into the What store ${RATE} times a second arrives once each, in order, and the store's value comes back to React as a prop`,
    `${liftedCount} values (${(liftedCount / elapsed).toFixed(0)}/s) in-order=${inOrder} react=${after.lifterN} store=${after.lifted} echo=${after.echo} renders=${delta('lifter')}`);
  log(`stream: ${sent} writes, ${tileRenders} tile renders, ${liftedCount} lifted`);
}

// === 10,000 deals: a react-window list and a TanStack table ==================

async function largeListChecks(page, { check, reporter, log, go }) {
  await go('deals');
  await page.locator('[data-deal-row="0"]').first().waitFor();
  // One write at a time to a visible row, then polled (microtasks, then
  // message-channel tasks, so frames do not round the time up) until the DOM
  // shows it; a frame between writes. First the list alone, then with the
  // table, whose sorted row model TanStack derives again from all 10,000
  // rows on every write.
  const timeWrites = (count, withTable) => page.evaluate(async ({ count, withTable }) => {
    const channel = new MessageChannel();
    const task = () => new Promise((r) => { channel.port1.onmessage = () => r(); channel.port2.postMessage(0); });
    const out = [];
    for (let k = 0; k < count; k++) {
      const i = k % 10;
      const value = (withTable ? 300000 : 200000) + k;
      const shown = () => document.querySelector(`[data-deal-row="${i}"] [data-notional]`)?.textContent === String(value)
        && (!withTable || document.querySelector('[data-deals-table] tbody tr')?.dataset.tableRow === String(i));
      await new Promise((r) => requestAnimationFrame(r));
      const t0 = performance.now();
      window.__desk.touchDeal(i, value);
      for (let m = 0; m < 20 && !shown(); m++) await Promise.resolve();
      while (!shown() && performance.now() - t0 < 2000) await task();
      out.push(shown() ? performance.now() - t0 : -1);
    }
    return out;
  }, { count, withTable });
  await page.click('[data-show-table]');
  await page.locator('[data-deals-table]').waitFor({ state: 'detached' });
  const times = await timeWrites(120, false);
  const missed = times.filter((t) => t < 0).length;
  check('react:large-list', missed === 0 && pct(times, 0.9) <= BUDGET.rowUpdate,
    `a write to one of 10,000 deals in a What signal reaches its react-window row within ${BUDGET.rowUpdate} ms at the 90th percentile`,
    `${fmt(times.map((t) => Math.max(t, 0)))}${missed ? `, ${missed} never shown` : ''}`);
  await page.click('[data-show-table]');
  await page.locator('[data-deals-table] tbody tr').first().waitFor();
  const tableTimes = await timeWrites(40, true);
  const tableMissed = tableTimes.filter((t) => t < 0).length;
  check('react:large-list', tableMissed === 0 && pct(tableTimes, 0.9) <= BUDGET.tableUpdate,
    `with a TanStack table sorted over all 10,000 deals mounted beside it, the write reaches the row and the top of the table within ${BUDGET.tableUpdate} ms at the 90th percentile`,
    `${fmt(tableTimes.map((t) => Math.max(t, 0)))}${tableMissed ? `, ${tableMissed} never shown` : ''}`);

  const bulk = await page.evaluate(async () => {
    const channel = new MessageChannel();
    const task = () => new Promise((r) => { channel.port1.onmessage = () => r(); channel.port2.postMessage(0); });
    const t0 = performance.now();
    window.__desk.touchAll(1);
    const want = window.__desk.deals()[3].notional;
    const shown = () => document.querySelector('[data-deal-row="3"] [data-notional]')?.textContent === String(want);
    for (let m = 0; m < 20 && !shown(); m++) await Promise.resolve();
    while (!shown() && performance.now() - t0 < 2000) await task();
    return shown() ? performance.now() - t0 : -1;
  });
  check('react:large-list', bulk >= 0 && bulk <= BUDGET.bulkUpdate,
    `every one of 10,000 deals changing at once shows within ${BUDGET.bulkUpdate} ms, the table mounted`, `${bulk.toFixed(1)}ms`);

  // The list's imperative handle, held by native code, scrolls it.
  await page.click('[data-jump]');
  await page.locator('[data-deal-row="5000"]').first().waitFor();
  const windowed = await page.$$eval('[data-deal-row]', (els) => els.map((el) => Number(el.dataset.dealRow)));
  reporter.assert(windowed.includes(5000) && !windowed.includes(0) && windowed.length < 40,
    'native code scrolls the react-window list through its listRef, and the DOM holds only the window',
    `rows ${Math.min(...windowed)}..${Math.max(...windowed)} (${windowed.length} in the DOM)`);

  const sortFlip = await page.evaluate(async () => {
    const th = document.querySelector('[data-th="notional"]');
    th.click();
    await new Promise((r) => requestAnimationFrame(r));
    return { sort: th.dataset.sort, top: document.querySelector('[data-deals-table] tbody tr td b')?.textContent };
  });
  reporter.assert(sortFlip.sort !== 'desc', 'a header click re-sorts the table', `sort=${sortFlip.sort} top=${sortFlip.top}`);
  log(`list: ${fmt(times)}; with the table: ${fmt(tableTimes)}; bulk ${bulk.toFixed(1)}ms`);
}

// === react-hook-form into the store; events side by side; refs =============

async function formChecks(page, { check, reporter, go }) {
  await go('forms');
  await page.click('[data-df-submit]');
  await page.locator('[data-df-error="name"]').first().waitFor();
  const firstError = await page.evaluate(() => ({
    errors: [...document.querySelectorAll('[data-df-error]')].map((e) => e.dataset.dfError).join(','),
    focused: document.activeElement?.hasAttribute('data-df-name'),
  }));
  await page.fill('[data-df-name]', 'Globex swap');
  await page.selectOption('[data-df-desk]', 'FX');
  await page.fill('[data-df-notional]', '-5');
  await page.click('[data-df-submit]');
  await page.locator('[data-df-error="notional"]').first().waitFor();
  const negative = await page.textContent('[data-df-error="notional"]');
  await page.fill('[data-df-notional]', '2500');
  await page.click('[data-df-submit]');
  await page.waitForFunction(() => document.querySelector('[data-newest]').textContent.includes('Globex swap'));
  const booked = await page.evaluate(() => ({
    newest: document.querySelector('[data-newest]').textContent,
    count: window.__desk.deals().length,
    cleared: document.querySelector('[data-df-name]').value === '' && !document.querySelector('[data-df-error]'),
  }));
  reporter.assert(firstError.errors === 'name,notional' && firstError.focused && /positive/.test(negative)
    && booked.newest === 'Globex swap · FX · 2500' && booked.count === 10001 && booked.cleared,
  'react-hook-form validates, focuses the first error, and a valid submit adds the deal to the What store',
  `errors=${firstError.errors} focused=${firstError.focused} negative="${negative}" newest="${booked.newest}" deals=${booked.count} reset=${booked.cleared}`);

  await page.click('[data-react-field]');
  await page.keyboard.type('hello');
  await page.click('[data-native-field]');
  await page.keyboard.type('world');
  await page.click('[data-native-in-react]');
  await page.keyboard.type('abc');
  await page.click('[data-focus-fancy]');
  const events = await page.evaluate(() => ({
    counts: document.querySelector('[data-event-counts]').textContent,
    refFocus: document.activeElement?.hasAttribute('data-fancy-input'),
  }));
  const m = /react=(\d+):(\w*) native=(\d+):(\w*) form=(\d+):(\w*)/.exec(events.counts) || [];
  check('react:events', m[1] === '5' && m[2] === 'hello' && m[3] === '5' && m[4] === 'world',
    'a React onChange beside a native onInput: each fires once per keystroke with the field\'s value',
    events.counts);
  // React hears nothing from a field it did not render: a React <form
  // onChange> around a native field fires neither for its typing nor for
  // the blur.
  check('react:events', m[5] === '0' && m[6] === 'abc',
    'a native field inside a React <form onChange> takes its typing, and the form\'s onChange hears none of it, as in React',
    events.counts);
  check('react:context-bridge', events.refFocus,
    'a ref native code passes to a React component reaches its input', `focused=${events.refFocus}`);
}

// === A Radix dialog over a What page, toasts, context =======================

async function overlayChecks(page, { check, reporter, go }) {
  await go('overlays');
  const readCtx = () => page.evaluate(() => ({
    chip: document.querySelector('[data-themed-chip]').textContent,
    card: document.querySelector('[data-desk-card]').textContent,
    header: document.querySelector('[data-desk-header]').textContent,
    headerRenders: window.__probes.renders['desk-header'],
  }));
  const ctx0 = await readCtx();
  await page.click('[data-themed-chip]');
  await page.fill('[data-trader]', 'Grace');
  const ctx1 = await readCtx();
  check('react:context-bridge',
    ctx0.chip === 'theme:dark 0' && ctx1.chip === 'theme:dark 1' && ctx0.card === 'Rates · Ada · on the page' && ctx1.card === 'Rates · Grace · on the page'
      && ctx0.header === 'Rates desk, Ada trading' && ctx1.header === 'Rates desk, Grace trading' && ctx1.headerRenders > ctx0.headerRenders,
    "React context reaches a React component through a native layer; the shell's What context reaches a native component a React component renders and a React component's useContext, live",
    `chip "${ctx0.chip}"->"${ctx1.chip}" card "${ctx0.card}"->"${ctx1.card}" header "${ctx0.header}"->"${ctx1.header}" (renders ${ctx0.headerRenders}->${ctx1.headerRenders})`);
  await page.fill('[data-trader]', 'Ada');

  // Open from the keyboard on a native button; Radix moves the focus in.
  await page.focus('[data-open-dialog]');
  await page.keyboard.press('Enter');
  await page.locator('[data-dialog]').first().waitFor();
  const opened = await page.evaluate(() => ({
    inPortal: !document.querySelector('[data-page]').contains(document.querySelector('[data-dialog]')),
    focusIn: document.querySelector('[data-dialog]').contains(document.activeElement),
    state: document.querySelector('[data-dialog-state]').textContent,
  }));
  await page.keyboard.type('Globex');
  const trapped = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    trapped.push(await page.evaluate(() => document.querySelector('[data-dialog]').contains(document.activeElement)));
  }
  await page.click('[data-native-note-btn]');
  const inside = await page.evaluate(() => ({
    echo: document.querySelector('[data-name-echo]').textContent,
    field: document.querySelector('[data-dialog-name]').value,
    note: document.querySelector('[data-native-note-btn]').textContent,
    card: document.querySelector('[data-dialog] [data-desk-card]')?.textContent,
  }));
  await page.keyboard.press('Escape');
  await page.locator('[data-dialog]').waitFor({ state: 'detached' });
  // Radix gives the focus back in a task after the dialog unmounts.
  await page.waitForFunction(() => document.activeElement?.hasAttribute('data-open-dialog'), null, { timeout: 2000 }).catch(() => {});
  const closed = await page.evaluate(() => ({
    state: document.querySelector('[data-dialog-state]').textContent,
    focusBack: document.activeElement?.hasAttribute('data-open-dialog'),
    bodyLocked: document.body.style.pointerEvents === 'none' || document.body.hasAttribute('data-scroll-locked'),
  }));
  check('react:portal-focus',
    opened.inPortal && opened.focusIn && opened.state === 'open' && trapped.every(Boolean)
      && inside.echo === 'Globex' && inside.field === 'Globex' && inside.note === 'noted 1' && inside.card === 'Rates · Ada · in the dialog'
      && closed.state === 'closed' && closed.focusBack && !closed.bodyLocked,
    'a Radix dialog opened from a native button portals to the body, takes and traps the focus, writes a What signal, hosts native components with their context, and Escape closes it and gives the focus back',
    `portal=${opened.inPortal} focus-in=${opened.focusIn} trapped=${trapped.filter(Boolean).length}/6 echo=${inside.echo} note="${inside.note}" card="${inside.card}" closed=${closed.state} focus-back=${closed.focusBack} body-locked=${closed.bodyLocked}`);

  // Ten more opens and closes leave nothing in the body.
  const nodes0 = await page.evaluate(() => document.body.getElementsByTagName('*').length);
  for (let i = 0; i < 10; i++) {
    await page.click('[data-open-dialog]');
    await page.locator('[data-dialog]').first().waitFor();
    await page.click('[data-dialog-close]');
    await page.locator('[data-dialog]').waitFor({ state: 'detached' });
  }
  const nodes1 = await page.evaluate(() => document.body.getElementsByTagName('*').length);
  reporter.assert(nodes1 === nodes0, 'ten more opens and closes of the dialog leave no node behind', `${nodes0} -> ${nodes1}`);

  // Toasts from native click handlers.
  await page.click('[data-sonner]');
  await page.click('[data-toastify]');
  await page.locator('[data-sonner-toast]').first().waitFor();
  await page.locator('.Toastify__toast').first().waitFor();
  const toasts = await page.evaluate(() => ({
    sonner: document.querySelector('[data-sonner-toast]')?.textContent,
    toastify: document.querySelector('.Toastify__toast')?.textContent,
  }));
  await page.click('[data-dismiss]');
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]') && !document.querySelector('.Toastify__toast'), null, { timeout: 5000 }).catch(() => {});
  const gone = await page.evaluate(() => !document.querySelector('[data-sonner-toast]') && !document.querySelector('.Toastify__toast'));
  check('react:portal-focus', /Trade booked/.test(toasts.sonner ?? '') && /Limit raised/.test(toasts.toastify ?? '') && gone,
    'toasts raised from native click handlers show in sonner\'s and react-toastify\'s hosts in the shell, and dismissing them removes them',
    `sonner="${toasts.sonner}" toastify="${toasts.toastify}" gone=${gone}`);
  check('react:unlisted-libraries', /Limit raised/.test(toasts.toastify ?? '') && gone,
    'react-toastify (not in the compatibility matrix) raises and dismisses a toast', `toastify="${toasts.toastify}" gone=${gone}`);
}

// === framer-motion and react-dropzone =======================================

async function libraryChecks(page, { check, reporter, go }) {
  await go('motion');
  for (let i = 0; i < 12; i++) await page.click('[data-motion-add]');
  for (let i = 0; i < 9; i++) await page.click('[data-motion-remove]');
  const leaving = await page.$$eval('[data-motion-item]', (els) => els.length);
  await sleep(600);
  const motion = await page.evaluate(() => ({
    model: document.querySelector('[data-motion-model]').textContent,
    dom: [...document.querySelectorAll('[data-motion-item]')].map((el) => el.dataset.motionItem).join(','),
    opacity: [...document.querySelectorAll('[data-motion-item]')].map((el) => getComputedStyle(el).opacity),
  }));
  reporter.assert(motion.dom === motion.model && motion.opacity.every((o) => o === '1') && leaving > motion.dom.split(',').length,
    'framer-motion items driven by a What signal play their exit before they leave, and the list ends as the model',
    `model=${motion.model} dom=${motion.dom} leaving-right-after=${leaving}`);

  await go('upload');
  await page.setInputFiles('[data-dropzone-input]', [
    { name: 'trades.csv', mimeType: 'text/csv', buffer: Buffer.from('id,notional\n1,100\n') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not trades') },
  ]);
  await page.locator('[data-upload="trades.csv"]').first().waitFor();
  const up = await page.evaluate(() => ({
    uploads: [...document.querySelectorAll('[data-upload]')].map((li) => li.textContent).join('|'),
    refused: document.querySelector('[data-refused]').textContent,
    accepted: document.querySelector('[data-dropzone-accepted]').textContent,
  }));
  check('react:unlisted-libraries', up.uploads === 'trades.csv (18 B)' && up.refused === '1' && up.accepted === '1',
    'react-dropzone (not in the compatibility matrix) accepts the CSV, refuses the text file, and hands the file to the What store',
    `uploads=${up.uploads} refused=${up.refused} accepted=${up.accepted}`);
}

// === Packages outside the matrix: React Flow, @hello-pangea/dnd, react-intl,
// react-spring, valtio, embla =================================================

async function toolsChecks(page, { check, go }) {
  await go('tools');
  await page.locator('.react-flow__node[data-id="book"]').first().waitFor();
  // The router's view transition covers the page until it ends; the pointer
  // goes to the node once a hit test there finds it.
  await page.waitForFunction(() => {
    const n = document.querySelector('.react-flow__node[data-id="book"]');
    const b = n.getBoundingClientRect();
    return n.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2));
  });
  const box = await page.locator('.react-flow__node[data-id="book"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width / 2 + i * 8, box.y + box.height / 2 + i * 2);
  await page.mouse.up();
  await page.waitForFunction(() => !/book:0,0/.test(document.querySelector('[data-flow-pos]').textContent), null, { timeout: 3000 }).catch(() => {});
  const flow = await page.evaluate(() => ({
    nodes: document.querySelectorAll('.react-flow__node').length,
    edges: document.querySelectorAll('.react-flow__edge').length,
    picked: document.querySelector('[data-flow-picked]').textContent,
    pos: document.querySelector('[data-flow-pos]').textContent,
    transform: document.querySelector('.react-flow__node[data-id="book"]').style.transform,
  }));
  const moved = /^book:(\d+),(\d+) check:0,100$/.exec(flow.pos);
  check('react:unlisted-libraries', flow.nodes === 2 && flow.edges === 1 && flow.picked === 'book' && moved && Number(moved[1]) > 20 && flow.transform !== 'translate(0px, 0px)',
    'React Flow (@xyflow/react) draws the workflow, and a click and a pointer drag of a node reach the What store',
    `nodes=${flow.nodes} edges=${flow.edges} picked=${flow.picked} pos="${flow.pos}" transform=${flow.transform}`);

  const intl = (await page.textContent('[data-intl]')).replace(/ /g, ' ');
  check('react:unlisted-libraries', intl === 'Limit 1.234,50 €', 'react-intl formats money for the de-DE locale', `"${intl}"`);

  await page.click('[data-spring-toggle]');
  await page.waitForFunction(() => document.querySelector('[data-spring]').style.transform === 'translate3d(120px, 0px, 0px)', null, { timeout: 3000 }).catch(() => {});
  const spring = await page.$eval('[data-spring]', (el) => el.style.transform);
  check('react:unlisted-libraries', spring === 'translate3d(120px, 0px, 0px)', '@react-spring/web animates a switch driven by a What signal to its end', spring);

  await page.focus('[data-dnd-item="Margin call"]');
  await page.keyboard.press('Space');
  await sleep(200);
  await page.keyboard.press('ArrowDown');
  await sleep(400);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-dnd-order]').textContent.startsWith('Client lunch'), null, { timeout: 3000 }).catch(() => {});
  const dnd = await page.evaluate(() => ({
    order: document.querySelector('[data-dnd-order]').textContent,
    dom: [...document.querySelectorAll('[data-dnd-item]')].map((el) => el.dataset.dndItem).join(','),
  }));
  check('react:unlisted-libraries', dnd.order === 'Client lunch,Margin call,Risk review' && dnd.dom === dnd.order,
    '@hello-pangea/dnd reorders a list from the keyboard and hands the order to the What store', `order=${dnd.order} dom=${dnd.dom}`);

  const v0 = Number(await page.textContent('[data-valtio]'));
  await page.click('[data-valtio-inc]');
  await page.click('[data-valtio-inc]');
  await page.waitForFunction((want) => document.querySelector('[data-valtio]').textContent === String(want), v0 + 2, { timeout: 2000 }).catch(() => {});
  const v1 = Number(await page.textContent('[data-valtio]'));
  check('react:unlisted-libraries', v1 === v0 + 2, 'valtio: a proxy written from native click handlers re-renders the React reader', `${v0} -> ${v1}`);

  await page.click('[data-embla-next]');
  const embla = await page.textContent('[data-embla-sel]');
  check('react:unlisted-libraries', embla === '1', 'embla-carousel-react scrolls to the next slide through its API', `selected=${embla}`);
}

// === 30 route changes while the feed runs ===================================

async function churnChecks(page, { check, skip, log, go, browserName }) {
  for (const id of ROUTES) await go(id);
  await go('about');
  await sleep(1200);
  const base = await page.evaluate(() => ({ snap: window.__snapshot(), probes: JSON.parse(JSON.stringify(window.__probes)) }));

  // Forcing a GC and reading the heap goes through the devtools protocol,
  // which only Chromium gives a page.
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : null;
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return (await cdp.send('Runtime.getHeapUsage')).usedSize;
  };
  let changes = 0;
  const churn = async () => {
    await page.evaluate((rate) => window.__desk.startFeed(rate), RATE);
    for (let c = 0; c < CHURN_CYCLES; c++) {
      for (const id of ROUTES) {
        await go(id);
        changes++;
        if (id === 'overlays') {
          await page.click('[data-open-dialog]');
          await page.locator('[data-dialog]').first().waitFor();
          await page.keyboard.press('Escape');
          await page.locator('[data-dialog]').waitFor({ state: 'detached' });
        }
      }
    }
    await go('about');
    await page.evaluate(() => window.__desk.stopFeed());
    await sleep(1200);
  };
  const t0 = Date.now();
  await churn();
  const churnMs = Date.now() - t0;
  const end = await page.evaluate(() => ({ snap: window.__snapshot(), probes: JSON.parse(JSON.stringify(window.__probes)), feedListeners: window.__feed.listeners.size }));

  const live = (p) => Object.keys(p.mounted).reduce((n, k) => n + p.mounted[k] - (p.unmounted[k] ?? 0), 0);
  const mountedDuring = Object.keys(end.probes.mounted).reduce((n, k) => n + end.probes.mounted[k] - (base.probes.mounted[k] ?? 0), 0);
  const listenerDiff = [];
  for (const k of new Set([...Object.keys(base.snap.listeners), ...Object.keys(end.snap.listeners)])) {
    if ((base.snap.listeners[k] ?? 0) !== (end.snap.listeners[k] ?? 0)) listenerDiff.push(`${k} ${base.snap.listeners[k] ?? 0}->${end.snap.listeners[k] ?? 0}`);
  }
  const nativeLive = (p) => p.native.built - p.native.disposed;
  const s0 = base.snap;
  const s1 = end.snap;
  check('react:route-churn',
    live(end.probes) === 0 && live(base.probes) === 0 && mountedDuring >= changes && end.probes.lateRenders === 0 && end.probes.lateCallbacks === 0
      && end.feedListeners === 0 && nativeLive(end.probes) === 0 && listenerDiff.length === 0
      && s1.intervals === s0.intervals && s1.observers === s0.observers && s1.nodes === s0.nodes && s1.timeouts <= s0.timeouts && s1.frames <= s0.frames,
    `${changes} route changes while the feed runs mount and unmount React components and release every component, listener, timer, observer and subscription`,
    `${churnMs}ms; react mounted ${mountedDuring}, live ${live(end.probes)}; native live ${nativeLive(end.probes)}; late renders ${end.probes.lateRenders} callbacks ${end.probes.lateCallbacks}; feed listeners ${end.feedListeners}; `
      + `intervals ${s0.intervals}->${s1.intervals} timeouts ${s0.timeouts}->${s1.timeouts} frames ${s0.frames}->${s1.frames} observers ${s0.observers}->${s1.observers} nodes ${s0.nodes}->${s1.nodes}; listeners ${listenerDiff.join(', ') || 'same'}`);
  log(`churn: ${changes} changes in ${churnMs}ms`);

  // Two more rounds of the same churn: the heap after a forced GC stays
  // level from one to the next. A round before the first sample lets every
  // library warm up (a TanStack table's first ten or so mounts grow the heap
  // by 3 MB in all, with real React as with what-react, then nothing more).
  if (cdp === null) {
    skip('react:route-churn', 'the heap after a forced GC stays level over two more rounds of route churn',
      `${browserName} has no devtools-protocol session to force a GC and read the heap`);
    return;
  }
  await churn();
  const heaps = [await heap()];
  await churn();
  heaps.push(await heap());
  await churn();
  heaps.push(await heap());
  // A navigation between two native pages leaves 3 to 5 KB behind in this
  // measure (the router's history), so the bound is on the whole growth, not
  // on its direction: under 1 MiB for 70 route changes.
  const growth = heaps[2] - heaps[0];
  const perChange = growth / (2 * ROUTES.length * CHURN_CYCLES);
  check('react:route-churn', growth < HEAP_GROWTH_BOUND,
    `the heap after a forced GC stays level over two more rounds of ${ROUTES.length * CHURN_CYCLES} route changes`,
    `heap ${heaps.map((h) => `${(h / 1048576).toFixed(2)}MB`).join(' -> ')} (growth ${(growth / 1024).toFixed(0)}KB, ${(perChange / 1024).toFixed(1)}KB per change)`);
}

// === A React island in a server-rendered What page ==========================

async function hydrationChecks(browser, base, { check, reporter }) {
  const context = await browser.newContext();
  try {
    await withPage(browser, `${base}/quote/NVDA?hold`, async (page, diag) => {
      const server = await page.evaluate(() => {
        const root = document.getElementById('quote');
        window.__server = {
          input: root.querySelector('[data-qr-size]'),
          form: root.querySelector('[data-qr]'),
          side: root.querySelector('[data-qr-side]'),
          note: root.querySelector('[data-ticket-note]'),
          size: root.querySelector('[data-step-size]'),
          elements: root.getElementsByTagName('*').length,
        };
        window.__created = 0;
        new MutationObserver((records) => {
          for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) window.__created += 1 + n.getElementsByTagName('*').length;
        }).observe(root, { childList: true, subtree: true });
        // The island's name and trigger, as the server wrote them, are what
        // the minified client build writes too: hydration rewrites neither.
        const island = root.querySelector('[data-ticket]')?.parentElement;
        window.__islandRewrites = 0;
        if (island) {
          new MutationObserver((records) => { window.__islandRewrites += records.length; })
            .observe(island, { attributes: true, attributeFilter: ['data-island', 'data-island-mode'] });
        }
        return {
          form: !!window.__server.form,
          label: root.querySelector('[data-qr-label]')?.getAttribute('for'),
          id: window.__server.input?.id,
          island: island?.getAttribute('data-island-mode'),
          islandName: island?.getAttribute('data-island'),
          islandSize: window.__server.size?.textContent,
          ticketMode: root.querySelector('[data-ticket-mode]')?.textContent,
        };
      });
      await page.click('[data-ticket-note]');
      await page.keyboard.type('urgent');
      await page.click('[data-qr-size]');
      await page.keyboard.type('250');
      await page.evaluate(() => window.__hydrate());
      // The island element is the ticket's parent.
      await page.waitForFunction(() => window.__hydrated === true && document.querySelector('[data-ticket]').parentElement.hasAttribute('data-island-hydrated'));
      await sleep(100);
      const after = await page.evaluate(() => {
        const root = document.getElementById('quote');
        const input = root.querySelector('[data-qr-size]');
        return {
          sameInput: input === window.__server.input,
          sameForm: root.querySelector('[data-qr]') === window.__server.form,
          value: input.value,
          focused: document.activeElement === input,
          created: window.__created,
          elements: root.getElementsByTagName('*').length,
          serverElements: window.__server.elements,
          label: root.querySelector('[data-qr-label]').getAttribute('for'),
          id: input.id,
          sameNote: root.querySelector('[data-ticket-note]') === window.__server.note,
          sameSize: root.querySelector('[data-step-size]') === window.__server.size,
          note: root.querySelector('[data-ticket-note]').value,
          islandName: root.querySelector('[data-ticket]').parentElement.getAttribute('data-island'),
          islandRewrites: window.__islandRewrites,
          ticketMode: root.querySelector('[data-ticket-mode]').textContent,
        };
      });
      await page.click('[data-step-up]');
      await page.click('[data-step-up]');
      await page.click('[data-fill]');
      const ticket = await page.evaluate(() => ({
        size: document.querySelector('[data-step-size]').textContent,
        fills: document.querySelector('[data-ticket-fills]').textContent,
      }));
      await page.click('[data-qr-side]');
      await page.click('[data-qp-ping]');
      await page.click('[data-qr-submit]');
      await page.locator('[data-qp-requests] li').first().waitFor();
      const live = await page.evaluate(() => ({
        side: document.querySelector('[data-qr-side]').textContent,
        ping: document.querySelector('[data-qp-ping]').textContent,
        request: document.querySelector('[data-qp-requests] li')?.textContent,
        sameSide: document.querySelector('[data-qr-side]') === window.__server.side,
      }));
      const noise = consoleNoise(diag);
      check('react:island-hydration',
        server.form && after.sameInput && after.sameForm && after.created === 0 && after.elements === after.serverElements
          && after.value === '250' && after.focused && after.label === after.id && server.id === after.id
          && live.side === 'sell' && live.sameSide && live.ping === 'native ping 1' && live.request === 'sell 250 NVDA' && noise.length === 0,
        'a react-hook-form island in a server-rendered What page hydrates onto the server\'s elements (none created), keeps text typed and the focus from before hydration, and then works with the native page around it',
        `same-input=${after.sameInput} created=${after.created} elements ${after.serverElements}->${after.elements} value="${after.value}" focused=${after.focused} id ${server.id}/${after.id} label=${after.label} side=${live.side} ping="${live.ping}" request="${live.request}" console=${noise.slice(0, 2).join(' | ') || 'clean'}`);
      check('react:island-hydration',
        server.island === 'load' && server.islandSize === '500' && after.sameNote && after.sameSize && after.note === 'urgent'
          && ticket.size === '700' && ticket.fills === '700'
          && server.islandName === 'Ticket' && after.islandName === 'Ticket' && after.islandRewrites === 0
          && server.ticketMode === 'limit' && after.ticketMode === 'limit',
        'a client:load island (a native ticket hosting a React stepper) is rendered on the server, hydrates onto its nodes keeping a note typed before, and its React state and callback work; it keeps the name the server gave it (the minified client build writes the same), and its prop called `mode` reaches it on both sides',
        `mode=${server.island} name ${server.islandName}->${after.islandName} rewrites=${after.islandRewrites} prop-mode ${server.ticketMode}->${after.ticketMode} server-size=${server.islandSize} same-note=${after.sameNote} same-size=${after.sameSize} note="${after.note}" size=${ticket.size} fills=${ticket.fills}`);
    }, { context });
  } finally {
    await context.close();
  }
}
