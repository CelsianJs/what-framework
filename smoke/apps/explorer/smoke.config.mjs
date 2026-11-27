// Explorer smoke contract.
//
// The other apps are wide (10,000 rows of one component) or fast (200 updates
// a second). This one is deep and big: a 10,000-entry tree rendered by ONE
// recursive component, nested 101 levels deep, and a form of 300 fields with
// validation on every keystroke. What that exposes is the cost of building
// and tearing down thousands of components at once, whether tearing them down
// really frees them, and whether a big form stays per field: a keystroke in
// one field must run that field's rules and re-render that field, not the
// other 299.
//
// Every expected answer comes from the app's own seeded modules (src/tree.js,
// src/settings.js), imported here, never read back from the page. Timings are
// taken in the page with performance.now(), from the dispatch until the DOM
// shows the result; the bounds carry headroom for a slow Linux runner. The
// heap is read in Chromium only (the devtools protocol); elsewhere that check
// is skipped with the reason.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const prefixes = (word) => Array.from(word, (_, i) => word.slice(0, i + 1));

const BUDGET = { expandAll: 4000, collapseAll: 2000, filterKey: 1500, formKey: 50 };
const HEAP_GROWTH_BOUND = 2 * 1024 * 1024;

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const ms = (n) => (n < 0 ? 'never' : `${n.toFixed(0)}ms`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs in the page: act, then wait until the DOM shows the result (`done`,
// checked after the framework's microtask flush and then once per frame).
// Returns the elapsed milliseconds, or -1 when the DOM never showed it.
const TIMED = `
  window.__timed = async (act, done) => {
    const t0 = performance.now();
    act();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 900 && !done(); i++) await new Promise((r) => requestAnimationFrame(r));
    return done() ? performance.now() - t0 : -1;
  };
  window.__shown = () => Array.from(document.querySelectorAll('[data-tree] [data-node]'), (el) => Number(el.dataset.node));
  window.__type = (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // Types each value in turn into the scope, \`gap\` ms apart, then waits until
  // the registry has answered every lookup and the form stopped validating.
  // Logs what the validating indicator showed at each change, with the
  // lookups still in flight then.
  window.__typeScope = (values, gap) => new Promise((resolve) => {
    const el = document.querySelector('[data-field=scope]');
    const indicator = document.querySelector('[data-validating]');
    const log = [];
    const watch = new MutationObserver(() => log.push({ text: indicator.textContent, pending: window.__form.registry.pending }));
    watch.observe(indicator, { characterData: true, childList: true, subtree: true });
    let i = 0;
    const settle = () => {
      if (window.__form.registry.pending > 0 || indicator.textContent !== '') return setTimeout(settle, 10);
      setTimeout(() => {
        watch.disconnect();
        resolve({ log, error: document.querySelector('[data-error=scope]').textContent });
      }, 50);
    };
    const step = () => {
      if (i === values.length) return settle();
      window.__type(el, values[i++]);
      setTimeout(step, gap);
    };
    step();
  });
`;

export default {
  description: 'Compiled SPA: a 10,000-entry tree from one recursive component (expand all, collapse all, filter, disposal counted) and a 300-field form validated per keystroke with a computed summary.',

  covers: [
    'cmp:recursive',
    'lifecycle:dispose-at-scale',
    'form:large',
    'form:async-validation',
  ],

  async check({ workDir, appPort, browser, browserName, check, skip, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const tree = await import(pathToFileURL(join(workDir, 'src/tree.js')).href);
    const NODES = tree.makeTree();
    const N = NODES.length;
    const ALL_OPEN = tree.shownIds(NODES, () => true, null);
    const COLLAPSED = tree.shownIds(NODES, (id) => id === 0, null);
    const deepest = NODES.reduce((a, b) => (b.depth > a.depth ? b : a));
    const settings = await import(pathToFileURL(join(workDir, 'src/settings-data.js')).href);
    const DEFAULTS = settings.defaultSettings();

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    await withPage(browser, `${base}/`, async (page, diag) => {
      await page.waitForSelector('[data-tree] [data-node]');
      await page.evaluate(TIMED);
      const probes = () => page.evaluate(() => ({ ...window.__tree.probes }));
      const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

      // === Expand all: 10,000 components, nested 101 deep =====================
      const start = await page.evaluate(() => window.__shown());
      const expandTimes = [];
      const collapseTimes = [];
      let expandedOk = true;
      let collapsedOk = sameList(start, COLLAPSED);
      let nesting = -1;
      let accounting = [];
      for (let round = 0; round < 3; round++) {
        expandTimes.push(await page.evaluate((n) => window.__timed(
          () => document.querySelector('[data-expand-all]').click(),
          () => document.querySelectorAll('[data-tree] [data-node]').length === n,
        ), N));
        const shown = await page.evaluate(() => window.__shown());
        if (!sameList(shown, ALL_OPEN)) expandedOk = false;
        if (round === 0) {
          nesting = await page.evaluate((id) => {
            let depth = 0;
            for (let el = document.querySelector(`[data-node="${id}"]`).parentElement; el && !el.matches('[data-tree]'); el = el.parentElement) if (el.matches('[data-node]')) depth++;
            return depth;
          }, deepest.id);
        }
        const open = await probes();
        collapseTimes.push(await page.evaluate((n) => window.__timed(
          () => document.querySelector('[data-collapse-all]').click(),
          () => document.querySelectorAll('[data-tree] [data-node]').length === n,
        ), COLLAPSED.length));
        await sleep(50);
        const closed = await probes();
        if (!sameList(await page.evaluate(() => window.__shown()), COLLAPSED)) collapsedOk = false;
        accounting.push({ open, closed });
      }
      check('cmp:recursive', expandedOk && collapsedOk && nesting === deepest.depth,
        `one recursive component renders all ${N.toLocaleString('en-US')} entries in order on expand all, ${deepest.depth} levels deep`,
        `expanded-in-order=${expandedOk} collapsed=${collapsedOk} deepest #${deepest.id} nested ${nesting} (want ${deepest.depth})`);
      check('cmp:recursive', expandTimes.every((t) => t >= 0) && median(expandTimes) <= BUDGET.expandAll,
        `expand all builds ${N.toLocaleString('en-US')} components within ${BUDGET.expandAll}ms`,
        `median=${ms(median(expandTimes))} runs=${expandTimes.map(ms).join(',')}`);

      // Every component expanding built is disposed by collapsing: the
      // created/disposed counters, the live effects and the bindings.
      const live = (p) => p.created - p.disposed;
      const acctOk = accounting.every(({ open, closed }) => live(open) === N && open.effectsLive === N
        && live(closed) === COLLAPSED.length && closed.effectsLive === COLLAPSED.length);
      const before = await probes();
      for (const id of [COLLAPSED[1], COLLAPSED[2], COLLAPSED[3], 0]) {
        await page.click(`[data-node="${id}"] > .row`);
        await page.click(`[data-node="${id}"] > .row`); // the second click closes the folder the first opened
      }
      await sleep(50);
      const after = await probes();
      // Eight clicks: each moves the selection (two rows' class bindings re-run)
      // and opens or closes one folder, whose children are built and torn
      // down. A binding of a disposed row would run on every selection move.
      const opened = [COLLAPSED[1], COLLAPSED[2], COLLAPSED[3], 0].reduce((n, id) => n + NODES[id].children.length, 0);
      const runs = after.bindingRuns - before.bindingRuns;
      check('lifecycle:dispose-at-scale',
        acctOk && after.cleanupsLate === 0 && runs <= 8 * 2 + opened * 2 + 16 && live(after) === after.effectsLive,
        'collapsing disposes every component, effect and binding expanding built',
        `${accounting.map(({ open, closed }) => `live ${live(open)}->${live(closed)} effects ${open.effectsLive}->${closed.effectsLive}`).join('; ')}; binding runs over 8 clicks=${runs} late=${after.cleanupsLate}`);
      check('lifecycle:dispose-at-scale', collapseTimes.every((t) => t >= 0) && median(collapseTimes) <= BUDGET.collapseAll,
        `collapse all disposes ${N.toLocaleString('en-US')} components within ${BUDGET.collapseAll}ms`,
        `median=${ms(median(collapseTimes))} runs=${collapseTimes.map(ms).join(',')}`);

      // The heap after a forced GC returns to where it was after each cycle.
      if (browserName === 'chromium') {
        const cdp = await page.context().newCDPSession(page);
        const heap = async () => {
          await cdp.send('HeapProfiler.collectGarbage');
          await cdp.send('HeapProfiler.collectGarbage');
          return (await cdp.send('Runtime.getHeapUsage')).usedSize;
        };
        const cycle = () => page.evaluate(async (n) => {
          await window.__timed(() => document.querySelector('[data-expand-all]').click(), () => document.querySelectorAll('[data-tree] [data-node]').length === n);
          await window.__timed(() => document.querySelector('[data-collapse-all]').click(), () => document.querySelectorAll('[data-tree] [data-node]').length < n);
        }, N);
        const heaps = [await heap()];
        for (let i = 0; i < 3; i++) { await cycle(); heaps.push(await heap()); }
        const growth = heaps[3] - heaps[0];
        const climbing = heaps[1] < heaps[2] && heaps[2] < heaps[3];
        check('lifecycle:dispose-at-scale', growth < HEAP_GROWTH_BOUND && !(climbing && growth > 512 * 1024),
          'the heap after a forced GC returns to its level after each expand/collapse cycle',
          `heap ${heaps.map((h) => `${(h / 1048576).toFixed(2)}MB`).join(' -> ')} (growth ${(growth / 1024).toFixed(0)}KB)`);
      } else {
        skip('lifecycle:dispose-at-scale', 'the heap after a forced GC returns to its level after each expand/collapse cycle',
          `${browserName} has no devtools-protocol session to force a GC and read the heap`);
      }

      // === Filter: every keystroke shows the matches and their folders ========
      const typed = 'router';
      const filterTimes = [];
      const filterProblems = [];
      for (let i = 1; i <= typed.length; i++) {
        const q = typed.slice(0, i);
        const want = tree.shownIds(NODES, null, tree.visibleFor(NODES, q));
        filterTimes.push(await page.evaluate(({ q, n }) => window.__timed(
          () => window.__type(document.querySelector('[data-tree-filter]'), q),
          () => document.querySelectorAll('[data-tree] [data-node]').length === n,
        ), { q, n: want.length }));
        const shown = await page.evaluate(() => window.__shown());
        if (!sameList(shown, want)) filterProblems.push(`"${q}": ${shown.length} shown, want ${want.length}`);
      }
      await page.evaluate(() => window.__timed(() => window.__type(document.querySelector('[data-tree-filter]'), ''), () => true));
      await sleep(50);
      const cleared = await page.evaluate(() => window.__shown());
      const filterProbes = await probes();
      check('cmp:recursive',
        filterProblems.length === 0 && sameList(cleared, COLLAPSED) && live(filterProbes) === COLLAPSED.length,
        'each filter keystroke shows exactly the matches and the folders that hold them; clearing it restores the folders as they were',
        `${filterProblems.join('; ') || `${typed.length} keystrokes exact`}; cleared shows ${cleared.length} (want ${COLLAPSED.length}), live components ${live(filterProbes)}`);
      check('cmp:recursive', filterTimes.every((t) => t >= 0) && median(filterTimes) <= BUDGET.filterKey,
        `a filter keystroke over ${N.toLocaleString('en-US')} entries settles within ${BUDGET.filterKey}ms`,
        `median=${ms(median(filterTimes))} runs=${filterTimes.map(ms).join(',')}`);

      // === The settings form: 300 fields validated as the user types =========
      const fieldNames = Object.keys(DEFAULTS).filter((k) => k !== 'scope');
      const summaryFor = (values) => {
        let filled = 0;
        let budget = 0;
        for (const k of fieldNames) {
          if (String(values[k]) !== '') filled++;
          if (k.startsWith('budget')) budget += Number(values[k]);
        }
        return { filled: String(filled), budget: `${budget.toLocaleString('en-US')} KB` };
      };
      const formView = () => page.evaluate(() => ({
        filled: document.querySelector('[data-sum-filled]').textContent,
        errors: document.querySelector('[data-sum-errors]').textContent,
        budget: document.querySelector('[data-sum-budget]').textContent,
      }));
      const resetCounters = () => page.evaluate(() => {
        for (const k in window.__form.ruleRuns) delete window.__form.ruleRuns[k];
        for (const k in window.__form.renders) delete window.__form.renders[k];
        return window.__form.registry.lookups;
      });
      const counters = () => page.evaluate(() => ({ rules: { ...window.__form.ruleRuns }, renders: { ...window.__form.renders }, lookups: window.__form.registry.lookups }));
      const first = await formView();
      const want0 = summaryFor(DEFAULTS);
      reporter.assert(first.filled === want0.filled && first.budget === want0.budget && first.errors === '0',
        'the summary starts over all 300 fields',
        `filled=${first.filled} (want ${want0.filled}) budget=${first.budget} (want ${want0.budget}) errors=${first.errors}`);

      // Real keystrokes into one field: only that field's rules run and only
      // its bindings re-render; the registry is not asked about the scope.
      const lookups0 = await resetCounters();
      await page.click('[data-field=name7]');
      await page.keyboard.press('End');
      await page.keyboard.type('-web', { delay: 10 });
      await sleep(100);
      const iso = await counters();
      const ruleFields = Object.keys(iso.rules);
      const renderFields = Object.keys(iso.renders);
      check('form:large',
        ruleFields.length === 1 && ruleFields[0] === 'name7' && iso.rules.name7 === 4 * 2
          && renderFields.every((k) => k === 'name7') && iso.lookups === lookups0,
        'four keystrokes in one of 300 fields run only that field\'s rules and re-render only that field',
        `rules ran for ${ruleFields.length} field(s) (${ruleFields.slice(0, 3).join(',')}${ruleFields.length > 3 ? ',…' : ''}) ${iso.rules.name7 ?? 0} times; re-rendered ${renderFields.join(',') || 'none'}; registry lookups +${iso.lookups - lookups0}`);

      // Edits that break and mend a rule: the field's error and the summary
      // over every field follow each one, timed in the page.
      const values = { ...DEFAULTS, name7: 'pkg-7-web' };
      const steps = [
        ['version12', '1.2', 'major.minor.patch'],
        ['version12', '1.2.0', ''],
        ['budget3', '0', 'At least 1 KB'],
        ['budget3', '900', 'At most 500 KB'],
        ['budget3', '64', ''],
        ['notes5', 'ships the router', ''],
        ['owner9', 'team9-at-atlas', 'Invalid email address'],
        ['owner9', 'team9@atlas.dev', ''],
      ];
      const editTimes = [];
      const editProblems = [];
      for (const [field, value, wantError] of steps) {
        values[field] = value;
        const wantSum = summaryFor(values);
        const wantErrors = wantError ? '1' : '0';
        const t = await page.evaluate(({ field, value, wantError, wantSum, wantErrors }) => window.__timed(
          () => window.__type(document.querySelector(`[data-field=${field}]`), value),
          () => document.querySelector(`[data-error=${field}]`).textContent === wantError
            && document.querySelector('[data-sum-filled]').textContent === wantSum.filled
            && document.querySelector('[data-sum-budget]').textContent === wantSum.budget
            && document.querySelector('[data-sum-errors]').textContent === wantErrors,
        ), { field, value, wantError, wantSum, wantErrors });
        editTimes.push(t);
        if (t < 0) {
          const v = await formView();
          const err = await page.$eval(`[data-error=${field}]`, (el) => el.textContent);
          editProblems.push(`${field}="${value}": error "${err}" (want "${wantError}"), filled ${v.filled} (want ${wantSum.filled}), budget ${v.budget} (want ${wantSum.budget}), errors ${v.errors} (want ${wantErrors})`);
        }
      }
      check('form:large', editProblems.length === 0,
        'each edit shows its field\'s error, and the summary over all 300 fields follows it',
        editProblems.join('; ') || `${steps.length} edits exact`);
      check('form:large', editTimes.every((t) => t >= 0) && median(editTimes) <= BUDGET.formKey,
        `an edit in a 300-field form settles within ${BUDGET.formKey}ms`,
        `median=${ms(median(editTimes))} runs=${editTimes.map(ms).join(',')}`);

      // === Async validation: answers that arrive out of order ================
      // "core" is taken and the registry takes 400 ms to say so; "core-ui",
      // typed 80 ms later, is free and answered in 30 ms.
      const past = await page.evaluate((v) => window.__typeScope(v, 20), prefixes('core-ui'));
      const earlyClear = past.log.filter((e) => e.text === '' && e.pending > 0);
      check('form:async-validation', past.error === '' && earlyClear.length === 0,
        'a slow "taken" answer for a name typed past does not land on the name typed after it, and validating holds until the last answer',
        `error for "core-ui"="${past.error}"; indicator cleared with lookups in flight ${earlyClear.length} time(s) (${earlyClear.map((e) => e.pending).join(',')})`);
      const taken = await page.evaluate((v) => window.__typeScope(v, 20), prefixes('core'));
      check('form:async-validation', taken.error === '@core is taken',
        'the slow answer for the name the field holds does land',
        `error for "core"="${taken.error}"`);

      // === Submit ==============================================================
      await page.evaluate((v) => window.__typeScope(v, 20), ['core-labs']);
      await page.click('[data-save]');
      await page.waitForFunction(() => document.querySelector('[data-saved]').textContent !== '', null, { timeout: 5000 }).catch(() => {});
      const saved = await page.$eval('[data-saved]', (el) => el.textContent);
      reporter.assert(saved === 'Saved 50 packages under @core-labs', 'the valid form submits', `saved="${saved}"`);

      reporter.assert(diag.errors.length === 0, 'the explorer ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
      log(`expand=${ms(median(expandTimes))} collapse=${ms(median(collapseTimes))} filter=${ms(median(filterTimes))} edit=${ms(median(editTimes))}`);
    });
  },
};
