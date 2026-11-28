// Live feed smoke contract.
//
// The other apps change state when a person clicks. This one changes it 200
// times a second whether anyone clicks or not, and mounts and unmounts
// components in the middle of it. What that exposes is lifetime: a
// subscription, a timer or an effect that outlives its component keeps
// running, and at this rate a leak shows up as a number within seconds.
//
// The feed numbers every trade, so "nothing dropped, nothing repeated" is an
// exact comparison between what the feed sent (window.__feed) and what the
// page shows. Cleanup is checked through counters the app keeps
// (window.__probes) and through the page's own timers: setInterval and
// clearInterval are wrapped before the app loads, so a timer left running
// after its component is gone is counted.
//
// Bounds: no main-thread task over 100 ms while streaming at 200/s; the heap
// after a forced GC grows by less than 1 MiB across three samples 6 s apart,
// and does not rise at every sample. The heap is read in Chromium only (the
// devtools protocol); in WebKit and Firefox that check is skipped.

import { serveViteApp, withPage } from '../../harness/index.mjs';

const RATE = 200;
const RUN_MS = 10_000;
const MIN_TOGGLES = 15;
const LONG_TASK_BOUND = 100;
const HEAP_GROWTH_BOUND = 1024 * 1024;

const INIT = `
  (() => {
    const set = window.setInterval.bind(window);
    const clear = window.clearInterval.bind(window);
    const live = new Set();
    window.__intervals = live;
    // The app's intervals: not the dev server client's keep-alive ping.
    window.setInterval = (fn, ms, ...args) => {
      const id = set(fn, ms, ...args);
      if (!String(new Error().stack).includes('/@vite/client')) live.add(id);
      return id;
    };
    window.clearInterval = (id) => { live.delete(id); return clear(id); };
    window.__longTasks = [];
    // Long tasks come from the Long Tasks API where the browser has it
    // (Chromium). Elsewhere (WebKit, Firefox) a 10 ms timeout chain measures
    // how late each tick runs: a task that holds the main thread for D ms
    // makes the next tick D ms late, and a lateness over 50 ms is recorded as
    // a long task of that length. setTimeout, not setInterval: the cleanup
    // check counts the page's live intervals.
    if ((PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
      window.__longTaskSource = 'longtask';
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__longTasks.push(e.duration);
      }).observe({ type: 'longtask', buffered: true });
    } else {
      window.__longTaskSource = 'loop-lag';
      const TICK = 10;
      let due = performance.now() + TICK;
      const tick = () => {
        const now = performance.now();
        const late = now - due;
        if (late > 50) window.__longTasks.push(late);
        due = now + TICK;
        setTimeout(tick, TICK);
      };
      setTimeout(tick, TICK);
    }
  })();
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  description: 'Compiled SPA fed 200 updates a second: keyed tape, SVG sparklines, store counters, pause/resume, panels mounting under load; loss, cleanup, memory and long-task bounds.',

  // WHAT_SMOKE_MODE=dev serves the app on its Vite dev server (smoke/README.md).
  dev: true,

  covers: [
    'stream:update-rate',
    'stream:no-loss',
    'lifecycle:unmount-cleanup',
    'perf:memory',
    'perf:long-tasks',
    'cmp:svg',
  ],

  async check({ workDir, appPort, mode, browser, browserName, check, skip, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    await serveViteApp({ mode, workDir, appPort, run, reporter });

    const context = await browser.newContext();
    await context.addInitScript(INIT);
    try {
      await withPage(browser, `${base}/`, async (page, diag) => {
        await page.waitForSelector('[data-tape] li');
        const state = () => page.evaluate(() => ({
          emitted: window.__feed.emitted,
          listeners: window.__feed.listeners,
          running: window.__feed.running,
          intervals: window.__intervals.size,
          probes: { ...window.__probes },
          received: Number(document.querySelector('[data-received]').textContent),
          gaps: document.querySelector('[data-gaps]').textContent,
          repeats: document.querySelector('[data-repeats]').textContent,
          tape: [...document.querySelectorAll('[data-tape] li')].map((li) => Number(li.dataset.seq)),
        }));
        const tapeProblem = (seqs) => {
          if (new Set(seqs).size !== seqs.length) return 'duplicate rows';
          for (let i = 1; i < seqs.length; i++) if (seqs[i] !== seqs[i - 1] - 1) return `gap ${seqs[i - 1]}->${seqs[i]}`;
          return null;
        };

        // === 10 s at 200/s, with panels mounting and unmounting throughout ======
        await page.selectOption('[data-rate]', String(RATE));
        await page.evaluate(() => { window.__longTasks.length = 0; });
        const t0 = Date.now();
        const startEmitted = (await state()).emitted;
        const symbols = await page.$$eval('[data-watch]', (els) => els.map((el) => el.dataset.watch));
        const samples = [];
        let toggles = 0;
        // Ten seconds, and on past them (up to twenty) until the panels have
        // been toggled MIN_TOGGLES times: on a loaded machine each round trip
        // to the page takes longer, and fewer fit in the ten.
        const more = () => Date.now() - t0 < RUN_MS || (toggles < MIN_TOGGLES && Date.now() - t0 < 2 * RUN_MS);
        for (let i = 0; more(); i++) {
          if (i % 2 === 0) {
            await page.click(`[data-watch="${symbols[(i / 2) % symbols.length]}"]`);
            toggles++;
          }
          const seqs = await page.$$eval('[data-tape] li', (els) => els.map((li) => Number(li.dataset.seq)));
          const problem = tapeProblem(seqs);
          if (problem) samples.push(problem);
          await sleep(250);
        }
        await page.click('[data-pause]');
        const elapsed = (Date.now() - t0) / 1000;
        await sleep(200);
        const paused = await state();
        const rate = (paused.emitted - startEmitted) / elapsed;

        check('stream:update-rate', rate >= 50 && rate <= 220 && toggles >= MIN_TOGGLES,
          'the page took 50 to 200 updates a second for 10 s while panels mounted and unmounted',
          `${rate.toFixed(0)}/s over ${elapsed.toFixed(1)}s, ${paused.emitted} trades, ${toggles} panel toggles`);

        const cardTrades = await page.$$eval('[data-trades]', (els) => els.reduce((n, el) => n + Number(el.textContent.split(' ')[0]), 0));
        check('stream:no-loss',
          paused.received === paused.emitted && paused.gaps === '0' && paused.repeats === '0'
            && paused.tape[0] === paused.emitted && paused.tape.length === 40 && !tapeProblem(paused.tape)
            && cardTrades === paused.emitted && samples.length === 0,
          'every trade reached the store, the cards and the keyed tape exactly once',
          `emitted=${paused.emitted} received=${paused.received} cards=${cardTrades} gaps=${paused.gaps} repeats=${paused.repeats} tape-top=${paused.tape[0]} rows=${paused.tape.length} samples-bad=${samples.slice(0, 3).join(',') || 0}`);

        const { longTasks, source } = await page.evaluate(() => ({ longTasks: window.__longTasks.slice(), source: window.__longTaskSource }));
        const worst = longTasks.length ? Math.max(...longTasks) : 0;
        check('perf:long-tasks', worst <= LONG_TASK_BOUND,
          `no main-thread task over ${LONG_TASK_BOUND}ms while streaming`,
          `long-tasks=${longTasks.length} worst=${worst.toFixed(0)}ms (${source})`);

        // === Pause holds, resume continues from the next sequence number =========
        await sleep(400);
        const stillPaused = await state();
        await page.click('[data-pause]');
        await sleep(500);
        await page.click('[data-pause]');
        await sleep(150);
        const resumed = await state();
        reporter.assert(
          stillPaused.emitted === paused.emitted && stillPaused.received === paused.received
            && stillPaused.tape[0] === paused.tape[0] && !stillPaused.running
            && resumed.received > paused.received && resumed.received === resumed.emitted
            && resumed.gaps === '0' && resumed.tape[0] === resumed.emitted,
          'pause holds the page still and resume continues with no gap',
          `paused ${paused.received}->${stillPaused.received} resumed ${resumed.received}/${resumed.emitted} gaps=${resumed.gaps}`);

        // === Sparklines are SVG and carry the history ===========================
        const sparks = await page.$$eval('[data-ticker]', (cards) => cards.map((card) => {
          const line = card.querySelector('[data-spark] polyline');
          const trades = Number(card.querySelector('[data-trades]').textContent.split(' ')[0]);
          return {
            svg: line?.namespaceURI === 'http://www.w3.org/2000/svg' && line instanceof SVGPolylineElement,
            points: (line?.getAttribute('points') || '').trim().split(' ').filter(Boolean).length,
            want: Math.min(60, trades),
          };
        }));
        check('cmp:svg', sparks.length === 8 && sparks.every((s) => s.svg && s.points === s.want),
          'each card draws its price history as an SVG polyline that follows the stream',
          sparks.map((s) => `${s.points}/${s.want}${s.svg ? '' : ' NOT-SVG'}`).join(' '));

        // === Unmount: nothing is left behind ====================================
        for (const s of await page.$$eval('[data-watch]:checked', (els) => els.map((el) => el.dataset.watch))) {
          await page.click(`[data-watch="${s}"]`);
        }
        await sleep(300); // let a trade or a timer tick reach anything still subscribed
        const after = await state();
        const panelsLeft = await page.locator('[data-panel]').count();
        // Left running: the counters' one-second timer, and the feed's own
        // timer while it runs.
        const wantIntervals = 1 + (after.running ? 1 : 0);
        check('lifecycle:unmount-cleanup',
          after.probes.mounted === after.probes.unmounted && after.probes.mounted >= 8
            && after.probes.lateCallbacks === 0 && after.probes.lateEffects === 0 && after.probes.lateBindings === 0
            && after.listeners === 1 && after.intervals === wantIntervals && panelsLeft === 0,
          'panels mounted under load release their subscription, timer, effects and bindings on unmount',
          `mounted=${after.probes.mounted} unmounted=${after.probes.unmounted} late=${after.probes.lateCallbacks}/${after.probes.lateEffects}/${after.probes.lateBindings} feed-listeners=${after.listeners} intervals=${after.intervals} (want ${wantIntervals}) panels=${panelsLeft}`);

        // === Memory over a longer run ===========================================
        // Keep streaming and keep toggling; sample the heap after a forced GC.
        // Forcing a GC and reading the heap goes through the devtools protocol,
        // which only Chromium speaks; WebKit and Firefox give a page neither.
        if (browserName !== 'chromium') {
          skip('perf:memory', 'the heap after a forced GC stays level over 15 s of streaming and panel churn',
            `${browserName} has no devtools-protocol session to force a GC and read the heap`);
          const end = await state();
          reporter.assert(end.received === end.emitted || end.running, 'the long run kept every trade',
            `received=${end.received} emitted=${end.emitted}`);
          reporter.assert(diag.errors.length === 0, 'the feed ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
          log(`rate=${rate.toFixed(0)}/s long-tasks=${longTasks.length} worst=${worst.toFixed(0)}ms (${source})`);
          return;
        }
        const cdp = await page.context().newCDPSession(page);
        const heap = async () => {
          await cdp.send('HeapProfiler.collectGarbage');
          await cdp.send('HeapProfiler.collectGarbage');
          return (await cdp.send('Runtime.getHeapUsage')).usedSize;
        };
        const churn = async (ms) => {
          const end = Date.now() + ms;
          for (let i = 0; Date.now() < end; i++) {
            await page.click(`[data-watch="${symbols[i % symbols.length]}"]`);
            await sleep(150);
          }
        };
        await churn(3000);
        const heaps = [await heap()];
        await churn(6000);
        heaps.push(await heap());
        await churn(6000);
        heaps.push(await heap());
        const growth = heaps[2] - heaps[0];
        const climbing = heaps[0] < heaps[1] && heaps[1] < heaps[2];
        check('perf:memory', growth < HEAP_GROWTH_BOUND && !(climbing && growth > 256 * 1024),
          'the heap after a forced GC stays level over 15 s of streaming and panel churn',
          `heap ${heaps.map((h) => `${(h / 1024 / 1024).toFixed(2)}MB`).join(' -> ')} (growth ${(growth / 1024).toFixed(0)}KB)`);

        const end = await state();
        reporter.assert(end.received === end.emitted || end.running, 'the long run kept every trade',
          `received=${end.received} emitted=${end.emitted}`);
        reporter.assert(diag.errors.length === 0, 'the feed ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
        log(`rate=${rate.toFixed(0)}/s long-tasks=${longTasks.length} worst=${worst.toFixed(0)}ms heap=${heaps.map((h) => (h / 1048576).toFixed(2)).join('/')}MB`);
      }, { context });
    } finally {
      await context.close();
    }
  },
};
