// Pulse smoke contract.
//
// The other apps move when data arrives. This one moves every frame: an SVG
// chart redrawn from requestAnimationFrame, a threshold handle dragged with
// the pointer and following a spring, a gauge needle that springs to each
// reading (useAnimatedValue), a refresh ring that fills over 600 ms
// (useTween), a panel that opens on a spring and can close mid-way, and
// alerts that enter and leave with CSS transitions (cssTransition).
//
// The check wraps requestAnimationFrame before the app loads, so it can
// count the frame loops waiting at any moment: the chart's own loop is the
// baseline, and every other animation must give its loop up when it settles,
// when it is started again, or when its component unmounts. Frames are
// measured in the page with the unwrapped requestAnimationFrame.
//
// What is checked:
// - the chart redraws every frame from one signal and keeps every node it
//   has, within a frame budget;
// - the dragged threshold settles exactly where the pointer let go, and
//   leaves no loop running;
// - a needle re-aimed twice while moving ends on the last reading; a ring
//   restarted twice while filling fills once, from 0, says it is busy until
//   that run ends and reports one refresh; a panel closed while opening, 40
//   times, leaves nothing; each with no extra loop left;
// - 150 alerts entering and leaving leave no node, component, timer or loop.

import { serveViteApp } from '../../harness/index.mjs';

const FRAME_BOUND = 100;
const ALERTS = 150;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INIT = `
  (() => {
    const raf = window.requestAnimationFrame.bind(window);
    const caf = window.cancelAnimationFrame.bind(window);
    const waiting = new Set();
    window.requestAnimationFrame = (cb) => {
      const id = raf((t) => { waiting.delete(id); cb(t); });
      waiting.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => { waiting.delete(id); caf(id); };
    window.__loops = () => waiting.size;

    window.__frames = { gaps: [], on: false };
    let last = 0;
    const tick = (t) => {
      if (window.__frames.on && last) window.__frames.gaps.push(t - last);
      last = t;
      raf(tick);
    };
    raf(tick);
    window.__frameStats = () => {
      const gaps = window.__frames.gaps.slice().sort((a, b) => a - b);
      window.__frames.gaps = [];
      return { n: gaps.length, p99: gaps[Math.floor(gaps.length * 0.99)] ?? 0, max: gaps[gaps.length - 1] ?? 0 };
    };

    // Samples fn() every frame until stop() and returns what it saw.
    window.__sample = (fn) => {
      const seen = [];
      let on = true;
      const step = () => { if (!on) return; seen.push(fn()); raf(step); };
      raf(step);
      return () => { on = false; return seen; };
    };
  })();
`;

export default {
  description: 'Compiled SPA that moves every frame: an SVG chart redrawn from requestAnimationFrame, a spring-dragged threshold, a gauge and a refresh ring re-aimed mid-flight, a panel closed mid-spring, 150 alerts entering and leaving; frame loops, nodes and timers counted.',

  // WHAT_SMOKE_MODE=dev serves the app on its Vite dev server (smoke/README.md).
  dev: true,

  covers: [
    'anim:raf-frame',
    'anim:drag-spring',
    'anim:interrupt',
    'anim:enter-leave-churn',
  ],

  async check({ workDir, appPort, mode, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    await serveViteApp({ mode, workDir, appPort, run, reporter });

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(INIT);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    // Waits until only the chart's loop is waiting (or `ms` pass) and
    // returns how many loops are waiting.
    const quiet = async (ms = 4000) => {
      await page.waitForFunction(() => window.__loops() <= 1, null, { timeout: ms }).catch(() => {});
      await sleep(100);
      return page.evaluate(() => window.__loops());
    };

    try {
      await page.goto(`${base}/`, { waitUntil: 'load' });
      await page.waitForSelector('[data-line]');
      await page.evaluate(() => window.__pulse.handles.gauge.live(false));
      const baseline = await quiet();

      // === The chart: every frame, the same nodes ==========================
      const chart = await page.evaluate(async () => {
        const svg = document.querySelector('[data-chart]');
        const before = Array.from(svg.querySelectorAll('*'));
        const all = document.getElementsByTagName('*').length;
        let dChanges = 0;
        const mo = new MutationObserver((records) => { for (const r of records) if (r.attributeName === 'd') dChanges++; });
        mo.observe(svg.querySelector('[data-line]'), { attributes: true });
        const frames0 = window.__pulse.probes.chartFrames;
        window.__frames.on = true;
        await new Promise((r) => setTimeout(r, 2000));
        window.__frames.on = false;
        mo.disconnect();
        const after = Array.from(svg.querySelectorAll('*'));
        return {
          frames: window.__pulse.probes.chartFrames - frames0,
          dChanges,
          same: before.length === after.length && before.every((el, i) => el === after[i]),
          nodes: after.length,
          allBefore: all,
          allAfter: document.getElementsByTagName('*').length,
          svgNs: after.every((el) => el.namespaceURI === 'http://www.w3.org/2000/svg'),
          ...window.__frameStats(),
        };
      });
      check('anim:raf-frame',
        chart.frames >= 60 && chart.dChanges >= chart.frames * 0.9 && chart.same && chart.allAfter === chart.allBefore && chart.svgNs && chart.p99 <= FRAME_BOUND,
        `an SVG chart redrawn every animation frame from one signal keeps all ${chart.nodes} of its nodes, creates none, and its 99th-percentile frame stays within ${FRAME_BOUND}ms`,
        `${chart.frames} frames in 2 s, the line redrawn ${chart.dChanges} times; same nodes=${chart.same} (${chart.nodes}); page elements ${chart.allBefore} -> ${chart.allAfter}; frame p99 ${chart.p99.toFixed(0)}ms worst ${chart.max.toFixed(0)}ms`);

      // === The threshold, dragged ==========================================
      const box = await page.locator('[data-handle]').boundingBox();
      const svgBox = await page.locator('[data-chart]').boundingBox();
      const x = box.x + box.width / 2;
      const y0 = box.y + box.height / 2;
      const y1 = svgBox.y + svgBox.height * 0.3;
      await page.evaluate(() => { window.__frames.on = true; window.__dragSeen = window.__sample(() => window.__pulse.handles.threshold.moving()); });
      await page.mouse.move(x, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        await page.mouse.move(x, y0 + ((y1 - y0) * i) / 12);
        await sleep(16);
      }
      await page.mouse.up();
      const dropped = await page.evaluate(() => window.__pulse.handles.threshold.target());
      await page.waitForFunction(() => !window.__pulse.handles.threshold.moving(), null, { timeout: 4000 }).catch(() => {});
      const settled = await page.evaluate(() => ({
        moved: window.__dragSeen().some(Boolean),
        target: window.__pulse.handles.threshold.target(),
        shown: window.__pulse.handles.threshold.shown(),
        label: document.querySelector('[data-threshold-value]').textContent,
        ...window.__frameStats(),
      }));
      const expected = Math.round((150 - ((y1 - svgBox.y) / svgBox.height) * 160) / 0.6);
      const dragLoops = await quiet();
      check('anim:drag-spring',
        settled.moved && Math.abs(dropped - expected) <= 1 && settled.target === dropped && settled.shown === dropped && settled.label === String(dropped) && dragLoops === baseline,
        'a handle dragged with the pointer follows a spring and settles exactly where it was let go, leaving no frame loop running',
        `dropped at ${dropped} ms (pointer said ${expected}); settled at ${settled.shown}, label ${settled.label}; moving seen=${settled.moved}; loops ${dragLoops} (baseline ${baseline}); frame p99 ${settled.p99.toFixed(0)}ms`);

      // === Re-aimed mid-flight =============================================
      await page.evaluate(async () => {
        const g = window.__pulse.handles.gauge;
        g.aim(90);
        await new Promise((r) => setTimeout(r, 120));
        g.aim(10);
        await new Promise((r) => setTimeout(r, 120));
        g.aim(70);
      });
      const aimLoopsNow = await page.evaluate(() => window.__loops());
      await page.waitForFunction(() => window.__loops() <= 1, null, { timeout: 6000 }).catch(() => {});
      await sleep(300);
      const needle = await page.evaluate(() => ({ value: window.__pulse.handles.gauge.value(), text: document.querySelector('[data-gauge-value]').textContent }));
      const needleLoops = await quiet();
      check('anim:interrupt',
        needle.value === 70 && needle.text === '70' && aimLoopsNow <= baseline + 1 && needleLoops === baseline,
        'a needle re-aimed twice while it springs ends on the last reading, with one frame loop while it moves and none after',
        `ended at ${needle.value} ("${needle.text}"), aimed 90 then 10 then 70; loops while moving ${aimLoopsNow}, after ${needleLoops} (baseline ${baseline})`);

      const ring = await page.evaluate(async () => {
        const r = window.__pulse.handles.ring;
        const done0 = window.__pulse.probes.ringDone;
        const refreshed0 = r.refreshed();
        const click = () => document.querySelector('[data-refresh]').click();
        click();
        await new Promise((res) => setTimeout(res, 200));
        click();
        await new Promise((res) => setTimeout(res, 200));
        const stop = window.__sample(() => [r.progress(), r.busy()]);
        click();
        await new Promise((res) => setTimeout(res, 1100));
        const seen = stop();
        const firstZero = seen.findIndex(([p]) => p === 0);
        const run = firstZero < 0 ? seen : seen.slice(firstZero);
        const end = run.findIndex(([p]) => p >= 1);
        const filling = end < 0 ? run : run.slice(0, end);
        return {
          monotonic: run.every(([p], i) => i === 0 || p >= run[i - 1][0]),
          busyWhileFilling: filling.every(([, b]) => b),
          reachedEnd: end >= 0,
          done: window.__pulse.probes.ringDone - done0,
          refreshed: r.refreshed() - refreshed0,
          busy: r.busy(),
          frames: seen.length,
        };
      });
      const ringLoops = await quiet();
      check('anim:interrupt',
        ring.monotonic && ring.busyWhileFilling && ring.reachedEnd && ring.done === 1 && ring.refreshed === 1 && !ring.busy && ringLoops === baseline,
        'a ring restarted twice while it fills fills once from 0, is busy until that run ends, reports one refresh, and leaves no frame loop',
        `progress ${ring.monotonic ? 'only rose' : 'went back'} over ${ring.frames} frames; busy while filling=${ring.busyWhileFilling}; completions ${ring.done}, refreshes shown ${ring.refreshed}; loops after ${ringLoops} (baseline ${baseline})`);

      const panel = await page.evaluate(async () => {
        const p = window.__pulse.handles.panel;
        for (let i = 0; i < 80; i++) {
          p.toggle();
          await new Promise((r) => setTimeout(r, 25));
        }
        return { open: p.open(), live: window.__pulse.probes.panelsLive, details: document.querySelectorAll('[data-detail]').length };
      });
      const panelLoops = await quiet();
      check('anim:interrupt',
        !panel.open && panel.live === 0 && panel.details === 0 && panelLoops === baseline,
        'a panel opening on a spring, closed mid-way 40 times, leaves no panel, component or frame loop',
        `open=${panel.open} live=${panel.live} nodes=${panel.details}; loops ${panelLoops} (baseline ${baseline})`);

      // === 150 alerts in and out ===========================================
      await page.evaluate(async (n) => {
        for (let i = 0; i < n; i += 10) {
          for (let k = 0; k < 10; k++) window.__pulse.handles.alerts.raise(`alert ${i + k}`);
          await new Promise((r) => setTimeout(r, 60));
        }
      }, ALERTS);
      const peak = await page.evaluate(() => document.querySelectorAll('[data-alert]').length);
      await page.waitForFunction(() => window.__pulse.handles.alerts.count() === 0, null, { timeout: 15000 }).catch(() => {});
      await sleep(200);
      const churn = await page.evaluate(() => ({
        nodes: document.querySelectorAll('[data-alert]').length,
        list: document.querySelector('[data-alerts]').children.length,
        ...window.__pulse.probes,
      }));
      const churnLoops = await quiet();
      check('anim:enter-leave-churn',
        churn.alertsMade === ALERTS && churn.nodes === 0 && churn.list === 0 && churn.alertsLive === 0 && churn.alertTimers === 0 && churnLoops === baseline && peak > 0,
        `${ALERTS} alerts entering and leaving with CSS transitions leave no node, component, timer or frame loop behind`,
        `made ${churn.alertsMade}, up to ${peak} on screen at once; after: nodes ${churn.nodes}, live ${churn.alertsLive}, timers ${churn.alertTimers}, loops ${churnLoops} (baseline ${baseline})`);

      reporter.assert(errors.length === 0, 'the wall ran with zero page errors', errors.slice(0, 3).join(' | '));
      log(`baseline loops ${baseline}; chart ${chart.frames} frames/2s p99 ${chart.p99.toFixed(0)}ms`);
    } finally {
      await context.close();
    }
  },
};
