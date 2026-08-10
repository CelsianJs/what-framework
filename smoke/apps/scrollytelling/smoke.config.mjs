// Scrollytelling smoke contract.
//
// The whole difficulty of this app is proving an island hydrated when it should
// and NOT BEFORE. "It eventually became interactive" is true of every mode, so
// every deferred mode below is asserted twice: once while its trigger has not
// happened, once after it has. The signal for "hydrated" is the island
// runtime's own bookkeeping (`data-hydrate` removed, `data-island-hydrated`
// added, plus a bubbling `island:hydrated` event), read out of the DOM rather
// than inferred from behaviour.
//
// Session A runs at 800px wide on purpose: `(min-width: 900px)` must be FALSE
// at load, otherwise the media island hydrates in the same microtask as the
// load island and the two are no longer distinguishable.
//
// ---------------------------------------------------------------------------
// THREE FRAMEWORK DEFECTS THIS APP HAD TO WORK AROUND (0.12.2, both sources)
//
// 1. Every component-scoped hook THROWS during SSR, so a component that uses
//    one cannot be server-rendered at all. `renderToString` (what-server
//    index.js) calls a component as `vnode.tag(props)` directly instead of
//    going through `createComponent`, so `getCurrentComponent()` is null and
//    `getCtx()` in what-core hooks.js raises. Measured: useState, useRef,
//    useEffect, useMemo, onMount and onCleanup all throw; useId and
//    useLoaderData survive because they never ask for a component context.
//
//      import { h, onMount } from 'what-framework';
//      import { renderToString } from 'what-framework/server';
//      renderToString(h(() => { onMount(() => {}); return h('p', {}, 'hi'); }, {}));
//      // -> Error: [what] onMount() can only be called inside a component function
//
//    onMount is the documented way to run client-only setup, and this makes it
//    unusable in any SSR'd component. Worked around by doing that setup from a
//    `ref` (skipped on the server, fires on the client) and from entry-client.
//
// 2. A function-valued attribute prop serializes its SOURCE TEXT in SSR.
//    `setProp` in what-core dom.js wraps a function prop in an effect, so
//    `style={() => ...}` is the documented reactive-attribute form on the
//    client. `renderAttrs` in what-server never calls it and falls through to
//    `String(val)`:
//
//      renderToString(h('div', { style: () => 'width:50%' }))
//      // -> <div style="() =&gt; &#39;width:50%&#39;">
//
//    Every reactive attribute on this page is therefore driven from a ref plus
//    an effect (see `bindEl` in src/motion.js). The supporting check below
//    ("no function source leaked") pins the workaround.
//
// 3. The scheduler drops a read queued from inside a write, which hangs
//    `cssTransition()`. `flushScheduler` clears its `scheduled` flag only after
//    BOTH queues drain, so a `schedule()` call made during the flush is a
//    no-op and no frame is ever requested:
//
//      scheduleWrite(() => { scheduleRead(() => console.log('never runs')); });
//      // silent until unrelated code touches the scheduler, then it drains
//
//    cssTransition does exactly that (write -> read for the reflow -> write),
//    so an enter/leave transition stalls after its first class unless
//    something else happens to poke the scheduler. That is why the enter half
//    of this page's notes drawer appeared to work and the exit half did not.
//    `runTransition` in src/motion.js pumps a frame while a transition is in
//    flight; the classes asserted below are still cssTransition's own.
// ---------------------------------------------------------------------------

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

/**
 * The server HTML between one island marker and the next. Islands are never
 * nested here, so this slice is exactly one island's server-rendered content.
 */
function islandSlice(html, name) {
  const start = html.indexOf(`data-island="${name}"`);
  if (start === -1) return '';
  const rest = html.slice(start);
  const next = rest.indexOf('data-island=', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

export default {
  description: 'Scrollytelling essay: five island hydration modes, scroll progress, intersect reveals, spring/tween and an enter/leave transition.',

  covers: [
    'island:load',
    'island:idle',
    'island:visible',
    'island:interaction',
    'island:media',
    'island:ssr-content',
    'anim:scroll-progress',
    'anim:intersect',
    'anim:spring-tween',
    'anim:transition',
  ],

  async check({ workDir, appPort, browser, check, reporter, log }) {
    const base = `http://127.0.0.1:${appPort}`;

    const server = startProcess('node', ['server.js'], {
      cwd: workDir,
      env: { ...process.env, PORT: String(appPort), NODE_ENV: '' },
    });
    await waitForHttp(`${base}/`, { child: server });

    // === Server HTML: islands ship real content ===========================
    const html = await (await fetch(`${base}/`)).text();

    const slices = {
      ChapterNav: { needle: 'Where it starts', mode: 'idle' },
      Colorway: { needle: 'Oxblood', mode: 'load' },
      LumenMeter: { needle: '1,240 lm', mode: 'visible' },
      SpecExplorer: { needle: 'Colour temperature', mode: 'interaction' },
      WideCompare: { needle: 'The 60 W bulb it replaces', mode: 'media' },
    };

    const ssr = {};
    for (const [name, { needle, mode }] of Object.entries(slices)) {
      const slice = islandSlice(html, name);
      ssr[name] = {
        bytes: slice.length,
        hasContent: slice.includes(needle),
        mode: slice.includes(`data-island-mode="${mode}"`),
      };
    }

    const specSlice = islandSlice(html, 'SpecExplorer');
    const specRows = (specSlice.match(/<tr\b/g) || []).length;

    check('island:ssr-content',
      Object.values(ssr).every((s) => s.hasContent && s.mode)
        && specSlice.includes('<table class="spec-table"')
        && specRows === 12 // 11 spec rows plus the header row
        && specSlice.includes('2700K'),
      'every island renders its component into the server HTML, not a placeholder',
      Object.entries(ssr).map(([n, s]) => `${n}=${s.bytes}B/${s.hasContent ? 'real' : 'EMPTY'}`).join(' ')
        + ` specRows=${specRows}`);

    // The counterpart claim: nothing is hydrated in the bytes the server sent.
    reporter.assert(
      !html.includes('data-island-hydrated') && (html.match(/data-hydrate="/g) || []).length === 5,
      'server HTML marks all five islands as awaiting hydration',
      `hydrate-markers=${(html.match(/data-hydrate="/g) || []).length}`);

    // A reactive attribute would betray itself here as serialized source text.
    reporter.assert(!/=("|')\s*\(?[^"']*=>/.test(html),
      'no function source leaked into a server-rendered attribute');

    // === Session A: island lifecycle ======================================
    // 800px wide so `(min-width: 900px)` is false and the media island stays
    // asleep; 720px tall so six 100vh chapters are genuinely six screens.
    const narrow = await browser.newContext({
      viewport: { width: 800, height: 720 },
      reducedMotion: 'no-preference',
    });

    try {
      await withPage(browser, `${base}/`, async (page, diag) => {
        // `attached`, not `visible`: the chapter rail is display:none below
        // 1100px, and hydration has nothing to do with whether CSS shows it.
        await page.waitForSelector('[data-island="ChapterNav"][data-island-hydrated]',
          { state: 'attached', timeout: 10000 });

        const atLoad = await page.evaluate(() => ({
          atMicrotask: document.documentElement.dataset.islandsAtMicrotask ?? '(unset)',
          live: [...document.querySelectorAll('[data-island-hydrated]')].map((el) => el.getAttribute('data-island')).sort(),
          pending: [...document.querySelectorAll('[data-hydrate]')]
            .map((el) => `${el.getAttribute('data-island')}:${el.getAttribute('data-hydrate')}`).sort(),
          logged: [...document.querySelectorAll('[data-hydrated-island]')].map((el) => el.getAttribute('data-hydrated-island')),
          revealed: Object.fromEntries([...document.querySelectorAll('[data-chapter]')]
            .map((el) => [el.getAttribute('data-chapter'), el.hasAttribute('data-revealed')])),
        }));

        // `load` schedules with queueMicrotask; every other mode waits for a
        // task. So the microtask snapshot taken right after hydrate() is the
        // line between "immediately" and "later", and only Colorway is on the
        // near side of it.
        check('island:load', atLoad.atMicrotask === 'Colorway',
          'client:load hydrates in the microtask that follows hydrate(), alone',
          `at-microtask=[${atLoad.atMicrotask}] live-later=[${atLoad.live.join(',')}]`);

        check('island:idle',
          !atLoad.atMicrotask.includes('ChapterNav')
            && atLoad.live.includes('ChapterNav')
            && atLoad.logged.includes('ChapterNav'),
          'client:idle hydrates after the microtask window, on an idle callback',
          `at-microtask=[${atLoad.atMicrotask}] settled=[${atLoad.live.join(',')}]`);

        reporter.assert(
          atLoad.pending.join(',') === 'LumenMeter:visible,SpecExplorer:interaction,WideCompare:media',
          'the three untriggered islands are still marked for their trigger',
          `pending=[${atLoad.pending.join(' ')}]`);

        // --- anim:spring-tween, half one: the tweened counter --------------
        const tweenRun = await page.evaluate(async () => {
          const el = document.querySelector('[data-tween]');
          const section = document.getElementById('origin');
          const samples = [];
          window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top + 8, behavior: 'instant' });
          const t0 = performance.now();
          while (performance.now() - t0 < 4000) {
            samples.push(Number(el.getAttribute('data-tween')));
            if (samples[samples.length - 1] === 4200) break;
            await new Promise((r) => requestAnimationFrame(r));
          }
          return { first: samples[0], last: samples[samples.length - 1], steps: new Set(samples).size };
        });

        // --- island:visible + anim:spring-tween, half two: the spring ------
        const meterBefore = await page.locator('[data-island="LumenMeter"][data-island-hydrated]').count();

        const springRun = await page.evaluate(async () => {
          const island = document.querySelector('[data-island="LumenMeter"]');
          const fill = document.querySelector('[data-lumen-meter] .meter-fill');
          const samples = [];
          window.scrollTo({ top: window.scrollY + island.getBoundingClientRect().top - 80, behavior: 'instant' });
          const t0 = performance.now();
          while (performance.now() - t0 < 5000) {
            samples.push(fill.getAttribute('data-spring'));
            if (samples[samples.length - 1] === '1240.0') break;
            await new Promise((r) => requestAnimationFrame(r));
          }
          return {
            hydrated: island.hasAttribute('data-island-hydrated'),
            first: samples[0],
            last: samples[samples.length - 1],
            steps: new Set(samples).size,
            width: fill.style.width,
            readout: document.querySelector('[data-lumen]').textContent.trim(),
          };
        });

        check('island:visible', meterBefore === 0 && springRun.hydrated,
          'client:visible stays asleep two screens down and hydrates when scrolled to',
          `before-scroll=${meterBefore} after-scroll=${springRun.hydrated ? 1 : 0}`);

        check('anim:spring-tween',
          tweenRun.first === 0 && tweenRun.last === 4200 && tweenRun.steps >= 8
            && springRun.first === '0.0' && springRun.last === '1240.0' && springRun.steps >= 8,
          'a tween and a spring animate through intermediate values and settle on target',
          `tween ${tweenRun.first}->${tweenRun.last} in ${tweenRun.steps} steps; `
            + `spring ${springRun.first}->${springRun.last} in ${springRun.steps} steps, `
            + `width=${springRun.width} readout=${springRun.readout}`);

        // --- island:interaction --------------------------------------------
        // Scrolled to, on screen, and given time to prove it stays asleep: this
        // island only answers to a pointer or a focus.
        await page.evaluate(() => {
          const section = document.getElementById('materials');
          window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top + 8, behavior: 'instant' });
        });
        await page.waitForSelector('#materials[data-revealed]', { timeout: 5000 });
        await page.waitForTimeout(600);
        const specBefore = await page.locator('[data-island="SpecExplorer"][data-island-hydrated]').count();
        const rowsBefore = await page.locator('[data-spec-row]:not([hidden])').count();

        // The first click only wakes the island: the handler it installs did
        // not exist when this event was dispatched. That is the mode's real
        // shape, so the check spells it out rather than hiding it.
        await page.click('[data-spec-filter="body"]');
        await page.waitForSelector('[data-island="SpecExplorer"][data-island-hydrated]', { timeout: 5000 });
        const specAfter = await page.locator('[data-island="SpecExplorer"][data-island-hydrated]').count();

        await page.click('[data-spec-filter="body"]');
        await page.waitForFunction(
          () => document.querySelector('[data-spec-root]')?.getAttribute('data-spec-group') === 'body',
          undefined,
          { timeout: 5000 },
        );
        const rowsAfter = await page.locator('[data-spec-row]:not([hidden])').count();

        check('island:interaction',
          specBefore === 0 && specAfter === 1 && rowsBefore === 11 && rowsAfter === 4,
          'client:interaction ignores scroll and hydrates on the first pointer event',
          `on-screen-unhydrated=${specBefore === 0} after-click=${specAfter} rows ${rowsBefore} -> ${rowsAfter}`);

        // --- anim:intersect --------------------------------------------------
        // One-shot per section, so the honest pair is the whole page: at load
        // only the chapter on screen is revealed, and after the scroll-through
        // every one of them is.
        // Chapter by chapter, not one jump to the bottom: an IntersectionObserver
        // reports the state it finds, so a section teleported straight past is
        // never seen intersecting and would never reveal.
        for (const id of ['compare', 'notes']) {
          await page.evaluate((target) => {
            const section = document.getElementById(target);
            window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top + 8, behavior: 'instant' });
          }, id);
          await page.waitForSelector(`#${id}[data-revealed]`, { timeout: 5000 });
        }
        const revealAfter = await page.evaluate(() => Object.fromEntries(
          [...document.querySelectorAll('[data-chapter]')]
            .map((el) => [el.getAttribute('data-chapter'), el.hasAttribute('data-revealed')]),
        ));

        const hiddenAtLoad = Object.entries(atLoad.revealed).filter(([, v]) => !v).map(([k]) => k);
        check('anim:intersect',
          atLoad.revealed.open === true
            && hiddenAtLoad.join(',') === 'origin,light,materials,compare,notes'
            && Object.values(revealAfter).every(Boolean),
          'onIntersect reveals each section as it enters the viewport, and not before',
          `at-load revealed=[open] pending=[${hiddenAtLoad.join(' ')}] `
            + `-> after scroll-through revealed=[${Object.keys(revealAfter).join(' ')}]`);

        // --- island:media ---------------------------------------------------
        const wideBefore = await page.locator('[data-island="WideCompare"][data-island-hydrated]').count();
        await page.setViewportSize({ width: 1200, height: 720 });
        await page.waitForSelector('[data-island="WideCompare"][data-island-hydrated]', { timeout: 5000 });
        const wideAfter = await page.locator('[data-island="WideCompare"][data-island-hydrated]').count();

        await page.evaluate(() => {
          const input = document.querySelector('[data-wipe-input]');
          input.value = '72';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.waitForFunction(
          () => document.querySelector('[data-compare-root]')?.getAttribute('data-wipe') === '72',
          undefined,
          { timeout: 5000 },
        );
        const wipe = await page.getAttribute('[data-compare-root]', 'data-wipe');

        check('island:media',
          wideBefore === 0 && wideAfter === 1 && wipe === '72',
          'client:media hydrates only once (min-width: 900px) starts matching',
          `at-800px=${wideBefore} at-1200px=${wideAfter} wipe=${wipe}`);

        reporter.assert(diag.errors.length === 0, 'story page drove all five islands with no page errors',
          diag.errors.slice(0, 2).join(' | '));

        // Islands hydrate their own subtree in a nested pass, which is exactly
        // the shape that produces silent mismatches if the server and client
        // trees disagree.
        const mismatches = diag.all.filter((line) => /Hydration mismatch/i.test(line));
        reporter.assert(mismatches.length === 0,
          'no island reported a hydration mismatch against its server HTML',
          mismatches.slice(0, 2).join(' | '));
      }, { context: narrow });
    } finally {
      await narrow.close();
    }

    // === Session B: scroll progress and the enter/leave transition ========
    const motion = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      reducedMotion: 'no-preference',
    });

    try {
      await withPage(browser, `${base}/`, async (page, diag) => {
        const prog = await page.evaluate(async () => {
          const bar = document.querySelector('[data-progress]');
          const pct = document.querySelector('[data-progress-pct]');
          const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => requestAnimationFrame(r)); };
          const read = () => ({ p: bar.getAttribute('data-progress'), t: pct.textContent, x: bar.style.transform });
          const max = document.documentElement.scrollHeight - window.innerHeight;

          window.scrollTo({ top: 0, behavior: 'instant' });
          await settle();
          const top = read();
          window.scrollTo({ top: Math.round(max * 0.5), behavior: 'instant' });
          await settle();
          const mid = read();
          window.scrollTo({ top: max, behavior: 'instant' });
          await settle();
          const bottom = read();
          return { top, mid, bottom, max, screens: Math.round(((max + window.innerHeight) / window.innerHeight) * 10) / 10 };
        });

        const midValue = Number(prog.mid.p);
        const scaleOf = (transform) => Number((/scaleX\(([\d.]+)\)/.exec(transform) || [])[1]);
        check('anim:scroll-progress',
          prog.top.p === '0.000' && prog.top.t === '0%' && scaleOf(prog.top.x) === 0
            && midValue > 0.45 && midValue < 0.55 && Math.abs(scaleOf(prog.mid.x) - midValue) < 0.002
            && prog.bottom.p === '1.000' && prog.bottom.t === '100%' && scaleOf(prog.bottom.x) === 1,
          'scroll position drives the progress value, the bar transform and the readout',
          `${prog.top.p}/${prog.top.t} -> ${prog.mid.p}/${prog.mid.t} -> ${prog.bottom.p}/${prog.bottom.t} `
            + `over ${prog.screens} screens (${prog.max}px of scroll)`);

        // --- anim:transition -------------------------------------------------
        // Recorded rather than sampled: the -active class exists for one
        // transition's worth of time, and a poll can walk straight past it.
        await page.evaluate(() => {
          const section = document.getElementById('notes');
          window.scrollTo({ top: window.scrollY + section.getBoundingClientRect().top + 8, behavior: 'instant' });
          window.__fadeLog = [];
          const record = () => {
            const panel = document.querySelector('[data-notes-panel]');
            const seen = panel ? panel.className : '(removed)';
            if (window.__fadeLog[window.__fadeLog.length - 1] !== seen) window.__fadeLog.push(seen);
          };
          new MutationObserver(record).observe(document.querySelector('.notes-block'), {
            subtree: true, childList: true, attributes: true, attributeFilter: ['class'],
          });
        });

        await page.click('[data-notes-toggle]');
        await page.waitForSelector('[data-notes-panel].fade-enter-done', { timeout: 5000 });
        const enterLog = await page.evaluate(() => window.__fadeLog.slice());

        await page.click('[data-notes-toggle]');
        await page.waitForFunction(() => !document.querySelector('[data-notes-panel]'), undefined, { timeout: 5000 });
        const fullLog = await page.evaluate(() => window.__fadeLog.slice());

        const entered = enterLog.join(' | ');
        const exited = fullLog.slice(enterLog.length).join(' | ');
        check('anim:transition',
          enterLog[0] === 'notes'
            && enterLog[1] === 'notes fade-enter'
            && entered.includes('fade-enter fade-enter-active')
            && entered.includes('fade-enter-done')
            && exited.includes('fade-exit fade-exit-active')
            && fullLog[fullLog.length - 1] === '(removed)',
          'a mounted panel runs the enter classes, and the leave classes run before it is removed',
          `enter: ${entered} || leave: ${exited}`);

        reporter.assert(diag.errors.length === 0, 'progress and transition page ran with no page errors',
          diag.errors.slice(0, 2).join(' | '));
      }, { context: motion });
    } finally {
      await motion.close();
    }

    // === Session C: prefers-reduced-motion ================================
    // Not a declared capability, but the checks above would be dishonest if the
    // page only animated: they run with motion allowed, so this asserts the
    // other branch actually exists.
    const reduced = await browser.newContext({
      viewport: { width: 800, height: 720 },
      reducedMotion: 'reduce',
    });

    try {
      await withPage(browser, `${base}/`, async (page) => {
        const run = await page.evaluate(async () => {
          const sampleFor = async (read, ms) => {
            const seen = [];
            const t0 = performance.now();
            while (performance.now() - t0 < ms) {
              seen.push(read());
              await new Promise((r) => requestAnimationFrame(r));
            }
            return [...new Set(seen)];
          };
          const scrollToId = (id, offset) => {
            const el = document.getElementById(id);
            window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top + offset, behavior: 'instant' });
          };

          const counter = document.querySelector('[data-tween]');
          scrollToId('origin', 8);
          const tween = await sampleFor(() => counter.getAttribute('data-tween'), 1500);

          const fill = document.querySelector('[data-lumen-meter] .meter-fill');
          scrollToId('light', -80);
          const spring = await sampleFor(() => fill.getAttribute('data-spring'), 2000);

          return { spring, tween, revealed: document.getElementById('light').hasAttribute('data-revealed') };
        });

        reporter.assert(
          run.spring.length <= 2 && run.spring[run.spring.length - 1] === '1240.0'
            && run.tween.length <= 2 && run.tween[run.tween.length - 1] === '4200',
          'prefers-reduced-motion snaps the spring and the tween to their final value',
          `spring=[${run.spring.join(',')}] tween=[${run.tween.join(',')}]`);

        reporter.assert(run.revealed,
          'reduced motion still reveals sections, so no content is hidden from that visitor');
      }, { context: reduced });
    } finally {
      await reduced.close();
    }

    log('scrollytelling checks complete');
  },
};
