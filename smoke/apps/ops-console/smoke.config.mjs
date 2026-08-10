// Ops console smoke contract.
//
// The theme is "prove the intermediate state", not just the end state. An async
// capability that is only asserted after it settles is indistinguishable from a
// synchronous one, so every check here pins the state in the middle:
//
//   - the lazy chunk request is HELD so the Suspense fallback is observed
//   - the acknowledge response is HELD so the optimistic row is observed before
//     the server has said anything, and then again after it has
//   - the acknowledge response is FORCED to fail so the rollback is observed
//
// Ordering matters twice. The infinite-feed assertions run before anything
// creates an incident, because creating one refetches the feed and replaces the
// loaded pages. And the lazy-chunk hold is installed before the first
// navigation, because the module is only ever fetched once.

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const PAGE_SIZE = 8;

/** Pull the hydration payload the server inlined into the document. */
function hydrationPayload(html) {
  const match = /<script id="__what_data" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/**
 * Read one attribute out of the raw server bytes. `marker` is any literal text
 * that appears inside the opening tag (a data-* attribute name works well).
 * Parsing HTML with a regex is fine here and only here: the point is to read
 * what the SERVER sent, before a parser or a script has had a chance to
 * normalize it.
 */
function attr(html, marker, name) {
  const re = new RegExp(`<[^>]*${marker}[^>]*>`);
  const tag = re.exec(html);
  if (!tag) return null;
  const found = new RegExp(`${name}="([^"]*)"`).exec(tag[0]);
  return found ? found[1] : null;
}

export default {
  description: 'Ops console: infinite feed, optimistic acknowledge, lazy detail pane, validated forms, focus-trapped dialog.',

  covers: [
    'cmp:suspense-lazy',
    'data:resource-suspense',
    'data:infinite',
    'data:optimistic',
    'form:validation',
    'form:submit',
    'a11y:ids',
    'a11y:focus-trap',
    'a11y:live-region',
  ],

  async check({ workDir, appPort, browser, check, reporter, log }) {
    const base = `http://127.0.0.1:${appPort}`;

    const server = startProcess('node', ['server.js'], {
      cwd: workDir,
      env: { ...process.env, PORT: String(appPort) },
    });
    await waitForHttp(`${base}/api/acks`, { child: server });

    // === Server-rendered ids ==============================================
    // Read from the raw bytes, before any script has run: whatever useId
    // allocated on the server is what assistive tech gets if JavaScript never
    // arrives, and it is what the client has to reproduce if it does.
    const consoleHtml = await (await fetch(`${base}/`)).text();

    const labelFor = attr(consoleHtml, 'class="filter-label"', 'for');
    const inputId = attr(consoleHtml, 'data-filter-input', 'id');
    const inputDescribedBy = attr(consoleHtml, 'data-filter-input', 'aria-describedby');
    const hintId = attr(consoleHtml, 'data-filter-hint', 'id');
    const errorSlotId = attr(consoleHtml, 'data-filter-error', 'id');

    reporter.assert(
      Boolean(labelFor && inputId && hintId && errorSlotId),
      'the filter form ships label/input/description ids in the server HTML',
      `for=${labelFor} id=${inputId} hint=${hintId} error=${errorSlotId}`,
    );
    reporter.assert(labelFor === inputId && inputDescribedBy === hintId,
      'the server-rendered pairing is internally consistent',
      `for=${labelFor} id=${inputId} describedby=${inputDescribedBy} hint=${hintId}`);

    // === createResource suspends and resolves under Suspense ==============
    const healthHtml = await (await fetch(`${base}/health`)).text();
    const payload = hydrationPayload(healthHtml);

    const openMetric = /<dd data-metric-open="">(\d+)<\/dd>/.exec(healthHtml);
    const trackedMetric = /<dd data-metric-total="">(\d+)<\/dd>/.exec(healthHtml);
    const syncPass = /<pre class="code" data-selftest-sync="">([\s\S]*?)<\/pre>/.exec(healthHtml);
    const asyncPass = /<pre class="code" data-selftest-async="">([\s\S]*?)<\/pre>/.exec(healthHtml);

    // The fallback is not merely absent from the finished page: the SAME panel
    // rendered synchronously produces it, which is the only state in which the
    // suspension is visible from outside.
    const fallbackObserved = Boolean(syncPass)
      && syncPass[1].includes('data-summary-skeleton')
      && !syncPass[1].includes('data-metric-open');
    const resolvedObserved = Boolean(asyncPass)
      && asyncPass[1].includes('data-metric-open')
      && !asyncPass[1].includes('data-summary-skeleton');
    const inPayload = Boolean(payload && payload.resources && payload.resources['ops-summary']);
    const pageResolved = Boolean(openMetric && trackedMetric)
      && !healthHtml.includes('data-summary-skeleton="">Rolling');

    check('data:resource-suspense',
      fallbackObserved && resolvedObserved && inPayload && pageResolved,
      'createResource suspends to the fallback and the async pass resolves it',
      `sync=${fallbackObserved ? 'skeleton' : 'NOT skeleton'} async=${resolvedObserved ? 'resolved' : 'NOT resolved'}`
      + ` payloadKey=${inPayload} open=${openMetric ? openMetric[1] : 'missing'}`);

    reporter.assert(
      inPayload && payload.resources['ops-summary'].total === Number(trackedMetric && trackedMetric[1]),
      'the resolved resource is inlined for hydration, matching the rendered numbers',
      inPayload ? JSON.stringify(payload.resources['ops-summary']) : 'no ops-summary in __what_data');

    reporter.assert(healthHtml.includes('data-selftest="pass"'),
      'the page reports its own SSR suspense self-test as passing');

    reporter.assert(!/<script type="module"/.test(healthHtml),
      'the diagnostics page ships no client entry',
      /<script type="module"[^>]*>/.exec(healthHtml)?.[0] ?? 'none');

    // === Browser ==========================================================
    await withPage(browser, `${base}/`, async (page, diag) => {
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-row]').length === n,
        PAGE_SIZE,
        { timeout: 15000 },
      );

      // --- a11y:ids: what the client rebuilt must be what the server sent ---
      const domIds = await page.evaluate(() => {
        const input = document.querySelector('[data-filter-input]');
        return {
          labelFor: document.querySelector('.filter-label').getAttribute('for'),
          inputId: input.id,
          describedBy: input.getAttribute('aria-describedby'),
          hintId: document.querySelector('[data-filter-hint]').id,
          errorId: document.querySelector('[data-filter-error]').id,
        };
      });

      // Force the error branch. `aria-describedby` is rewritten from the
      // CLIENT's useId sequence, so a sequence that drifted from the server's
      // would leave it pointing at an id that is not in the document.
      await page.fill('[data-filter-input]', 'p');
      await page.click('[data-filter-apply]');
      await page.waitForFunction(
        () => document.querySelector('[data-filter-error]').textContent.trim().length > 0,
        undefined,
        { timeout: 5000 },
      );
      const described = await page.getAttribute('[data-filter-input]', 'aria-describedby');
      const describedTargetsExist = await page.evaluate(
        (value) => value.split(/\s+/).every((id) => document.getElementById(id) !== null),
        described,
      );

      check('a11y:ids',
        domIds.labelFor === inputId
        && domIds.inputId === inputId
        && domIds.hintId === hintId
        && domIds.errorId === errorSlotId
        && described === `${errorSlotId} ${hintId}`
        && describedTargetsExist,
        'useId pairs label/input/description and the ids survive hydration unchanged',
        `ssr for=${labelFor} id=${inputId} error=${errorSlotId}`
        + ` | client for=${domIds.labelFor} id=${domIds.inputId} describedby=${described}`);

      // The rejected filter must not have been applied either.
      reporter.assert(
        (await page.locator('[data-row]').count()) === PAGE_SIZE,
        'an invalid filter surfaces its error and is not applied',
        `rows=${await page.locator('[data-row]').count()}`);

      // A valid filter narrows the feed, which proves the error above was the
      // form refusing rather than the handler being broken.
      await page.fill('[data-filter-input]', 'payments');
      await page.click('[data-filter-apply]');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-row]').length > 0
          && [...document.querySelectorAll('[data-row]')].every((r) => r.dataset.service === 'payments-worker'),
        undefined,
        { timeout: 5000 },
      );
      const filtered = await page.locator('[data-row]').count();
      reporter.assert(filtered > 0 && filtered < PAGE_SIZE,
        'a valid filter narrows the feed to one service', `rows=${filtered}`);

      await page.fill('[data-filter-input]', '');
      await page.click('[data-filter-apply]');
      await page.waitForFunction((n) => document.querySelectorAll('[data-row]').length === n,
        PAGE_SIZE, { timeout: 5000 });

      // --- cmp:suspense-lazy ---------------------------------------------
      // Hold the detail module in flight. The fallback is a real state on a
      // cold cache; holding the request is how it stays on screen long enough
      // to be read.
      let releaseChunk;
      const chunkGate = new Promise((resolve) => { releaseChunk = resolve; });
      let chunkRequests = 0;
      const holdChunk = async (route) => {
        chunkRequests += 1;
        await chunkGate;
        await route.continue();
      };
      await page.route('**/panels/incident-detail.js', holdChunk);

      const firstRowId = await page.getAttribute('[data-row]:nth-child(1)', 'data-row');
      const firstRowTitle = (await page.textContent(`[data-row="${firstRowId}"] .row-title`)).trim();

      const paneBefore = await page.locator('[data-pane-empty]').count();
      await page.click(`[data-open="${firstRowId}"]`);
      await page.waitForSelector('[data-pane-skeleton]', { timeout: 10000 });
      const skeletonShown = await page.locator('[data-pane-skeleton]').count();
      const detailWhileHeld = await page.locator('[data-detail]').count();

      releaseChunk();
      await page.waitForSelector(`[data-detail="${firstRowId}"]`, { timeout: 15000 });
      await page.waitForFunction(
        (id) => document.querySelector('[data-detail-title]')?.textContent.trim() === id,
        firstRowTitle,
        { timeout: 10000 },
      );
      const skeletonAfter = await page.locator('[data-pane-skeleton]').count();
      const detailService = await page.textContent('[data-detail-service]');

      check('cmp:suspense-lazy',
        paneBefore === 1 && chunkRequests === 1 && skeletonShown === 1 && detailWhileHeld === 0
        && skeletonAfter === 0 && detailService.trim().length > 0,
        'a lazy route reached by navigation shows the fallback, then replaces it',
        `emptyPaneFirst=${paneBefore} chunkRequests=${chunkRequests}`
        + ` fallbackWhileHeld=${skeletonShown} detailWhileHeld=${detailWhileHeld}`
        + ` fallbackAfter=${skeletonAfter} resolvedService=${detailService.trim()}`);

      await page.unroute('**/panels/incident-detail.js', holdChunk);

      // --- data:infinite ---------------------------------------------------
      const firstPageIds = await page.$$eval('[data-row]', (rows) => rows.map((r) => r.dataset.row));
      await page.click('[data-load-more]');
      await page.waitForFunction((n) => document.querySelectorAll('[data-row]').length === n,
        PAGE_SIZE * 2, { timeout: 10000 });
      const twoPageIds = await page.$$eval('[data-row]', (rows) => rows.map((r) => r.dataset.row));

      const appended = firstPageIds.every((id, i) => twoPageIds[i] === id);
      const unique = new Set(twoPageIds).size === twoPageIds.length;
      const status = (await page.textContent('[data-feed-status]')).trim();

      check('data:infinite',
        twoPageIds.length === PAGE_SIZE * 2 && appended && unique,
        'fetchNextPage appends a page and keeps the rows already on screen',
        `${firstPageIds.length} -> ${twoPageIds.length} rows, firstRowKept=${twoPageIds[0] === firstPageIds[0]}`
        + `, unique=${unique}, status="${status}"`);

      // --- data:optimistic: apply, then reconcile --------------------------
      const ackTarget = twoPageIds[2];
      let releaseAck;
      const ackGate = new Promise((resolve) => { releaseAck = resolve; });
      const holdAck = async (route) => { await ackGate; await route.continue(); };
      await page.route('**/api/incidents/*/ack', holdAck);

      await page.click(`[data-ack="${ackTarget}"]`);
      await page.waitForSelector(`[data-row="${ackTarget}"][data-ack-state="pending"]`, { timeout: 5000 });
      const whilePending = await page.evaluate((id) => {
        const row = document.querySelector(`[data-row="${id}"]`);
        return {
          state: row.dataset.ackState,
          ackedBy: row.dataset.ackedBy,
          label: row.querySelector('[data-ack-label]').textContent.trim(),
        };
      }, ackTarget);

      releaseAck();
      await page.waitForSelector(`[data-row="${ackTarget}"][data-ack-state="confirmed"]`, { timeout: 10000 });
      const afterConfirm = await page.evaluate((id) => {
        const row = document.querySelector(`[data-row="${id}"]`);
        return { state: row.dataset.ackState, ackedBy: row.dataset.ackedBy };
      }, ackTarget);
      await page.unroute('**/api/incidents/*/ack', holdAck);

      // --- data:optimistic: rollback ---------------------------------------
      const rollbackTarget = twoPageIds[3];
      const failAck = async (route) => {
        // A slice of delay so the optimistic state is observable before the
        // failure lands, exactly as it would be on a real timeout.
        await new Promise((r) => setTimeout(r, 150));
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'ack service unavailable' }),
        });
      };
      await page.route('**/api/incidents/*/ack', failAck);

      await page.click(`[data-ack="${rollbackTarget}"]`);
      await page.waitForSelector(`[data-row="${rollbackTarget}"][data-ack-state="pending"]`, { timeout: 5000 });
      const rollbackPendingLabel = (await page.textContent(`[data-ack-label="${rollbackTarget}"]`)).trim();
      await page.waitForSelector(`[data-row="${rollbackTarget}"][data-ack-state="open"]`, { timeout: 10000 });
      const rolledBackState = await page.getAttribute(`[data-row="${rollbackTarget}"]`, 'data-ack-state');
      await page.waitForFunction(
        (id) => document.querySelector('[data-announcer] [aria-live]').textContent.includes(id),
        rollbackTarget,
        { timeout: 5000 },
      );
      const rollbackAnnouncement = (await page.textContent('[data-announcer] [aria-live]')).trim();
      await page.unroute('**/api/incidents/*/ack', failAck);

      // The acknowledged row must have survived the failure of a different one.
      const survivor = await page.getAttribute(`[data-row="${ackTarget}"]`, 'data-ack-state');

      check('data:optimistic',
        whilePending.state === 'pending' && whilePending.ackedBy === ''
        && afterConfirm.state === 'confirmed' && afterConfirm.ackedBy === 'ops-bot'
        && rollbackPendingLabel === 'acknowledging...' && rolledBackState === 'open'
        && /rolled back/i.test(rollbackAnnouncement)
        && survivor === 'confirmed',
        'an acknowledge applies before the server answers, reconciles, and rolls back on failure',
        `pending(by="${whilePending.ackedBy}", label="${whilePending.label}")`
        + ` -> confirmed(by="${afterConfirm.ackedBy}")`
        + ` | failed ack showed "${rollbackPendingLabel}" then ended as "${rolledBackState}", survivor="${survivor}"`);

      // --- a11y:focus-trap --------------------------------------------------
      let incidentPosts = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/incidents') {
          incidentPosts += 1;
        }
      });

      await page.click('[data-new-incident]');
      await page.waitForSelector('[data-dialog]', { timeout: 5000 });
      // FocusTrap focuses the first focusable itself; wait for it rather than
      // assuming, because it activates on a microtask after the ref lands.
      await page.waitForFunction(
        () => document.activeElement?.hasAttribute('data-dialog-close'),
        undefined,
        { timeout: 5000 },
      );

      const focusables = await page.evaluate(() => {
        const dialog = document.querySelector('[data-dialog]');
        return [...dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.disabled).length;
      });

      // Tab all the way round and one past the end. Focus must never leave.
      const tabWalk = [];
      for (let i = 0; i < focusables + 1; i++) {
        await page.keyboard.press('Tab');
        tabWalk.push(await page.evaluate(() => ({
          inside: !!document.activeElement.closest('[data-dialog]'),
          tag: document.activeElement.tagName.toLowerCase(),
        })));
      }
      const escapedForward = tabWalk.filter((s) => !s.inside).length;
      const wrappedToFirst = await page.evaluate(
        () => !!document.activeElement.closest('[data-dialog]'));

      // Shift+Tab off the first element is the other direction the trap has to
      // hold, and the one a naive implementation forgets.
      await page.evaluate(() => document.querySelector('[data-dialog-close]').focus());
      await page.keyboard.press('Shift+Tab');
      const afterShiftTab = await page.evaluate(() => ({
        inside: !!document.activeElement.closest('[data-dialog]'),
        isSubmit: document.activeElement.hasAttribute('data-dialog-submit'),
      }));

      check('a11y:focus-trap',
        focusables >= 5 && escapedForward === 0 && wrappedToFirst
        && afterShiftTab.inside && afterShiftTab.isSubmit,
        'Tab and Shift+Tab both wrap inside the open dialog',
        `focusables=${focusables} tabs=${tabWalk.length} escaped=${escapedForward}`
        + ` shiftTabLanded=${afterShiftTab.isSubmit ? 'submit button' : 'outside the dialog'}`);

      // --- form:validation --------------------------------------------------
      await page.fill('[data-dialog-title]', 'too short');
      await page.click('[data-dialog-submit]');
      await page.waitForFunction(
        () => document.querySelector('[data-dialog-error]')?.textContent.trim().length > 0,
        undefined,
        { timeout: 5000 },
      );
      const dialogError = (await page.textContent('[data-dialog-error]')).trim();
      const stillOpen = await page.locator('[data-dialog]').count();
      const postsAfterInvalid = incidentPosts;

      check('form:validation',
        /at least 10 characters/i.test(dialogError) && stillOpen === 1 && postsAfterInvalid === 0,
        'useForm blocks the submit, surfaces the field error and never reaches the network',
        `error="${dialogError}" dialogOpen=${stillOpen === 1} posts=${postsAfterInvalid}`);

      // --- form:submit ------------------------------------------------------
      const newTitle = 'search-index: shard 3 refusing writes';
      await page.fill('[data-dialog-title]', newTitle);
      await page.selectOption('[data-dialog-service]', 'search-index');
      await page.selectOption('[data-dialog-severity]', 'critical');
      await page.click('[data-dialog-submit]');

      await page.waitForFunction(
        (title) => document.querySelector('[data-row]:nth-child(1) .row-title')?.textContent.trim() === title,
        newTitle,
        { timeout: 10000 },
      );
      const dialogClosed = (await page.locator('[data-dialog]').count()) === 0;
      const newRowId = await page.getAttribute('[data-row]:nth-child(1)', 'data-row');
      const newRowSeverity = await page.getAttribute(`[data-row="${newRowId}"] [data-severity]`, 'data-severity');

      check('form:submit',
        dialogClosed && incidentPosts === 1 && /^INC-\d+$/.test(newRowId) && newRowSeverity === 'critical',
        'a valid submit posts once, closes the dialog and puts the incident at the top of the feed',
        `posts=${incidentPosts} dialogClosed=${dialogClosed} row=${newRowId} severity=${newRowSeverity}`);

      // The server has to agree, not just the optimistic UI.
      const stored = await (await fetch(`${base}/api/incidents/${newRowId}`)).json();
      reporter.assert(stored.title === newTitle && stored.service === 'search-index',
        'the created incident is readable from the server',
        `${stored.id}: ${stored.title}`);

      // --- a11y:live-region --------------------------------------------------
      const liveRegion = await page.evaluate(() => {
        const el = document.querySelector('[data-announcer] [aria-live]');
        return el && {
          text: el.textContent.trim(),
          live: el.getAttribute('aria-live'),
          atomic: el.getAttribute('aria-atomic'),
        };
      });

      check('a11y:live-region',
        Boolean(liveRegion) && liveRegion.live === 'polite' && liveRegion.atomic === 'true'
        && liveRegion.text.includes(newRowId) && liveRegion.text.includes(newTitle),
        'the result of the submit is announced in an aria-live region',
        liveRegion ? `aria-live=${liveRegion.live} text="${liveRegion.text}"` : 'no live region found');

      // --- the acknowledgement outlives the tab ------------------------------
      // A reload throws away every optimistic value. The confirmed row can only
      // come back from the boot read, so this is the check that would notice
      // the client-side boot fetch silently never running.
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForFunction(
        (id) => document.querySelector(`[data-row="${id}"]`)?.dataset.ackState === 'confirmed',
        ackTarget,
        { timeout: 10000 },
      );
      const afterReload = await page.getAttribute(`[data-row="${ackTarget}"]`, 'data-acked-by');
      reporter.assert(afterReload === 'ops-bot',
        'the server-side acknowledgement is read back after a full reload',
        `${ackTarget} acked-by="${afterReload}"`);

      // The 503 the rollback check injected is the browser reporting OUR fault
      // injection, not the app misbehaving. Everything else has to be silent.
      const realErrors = diag.errors.filter((line) => !/503 \(Service Unavailable\)/.test(line));
      reporter.assert(realErrors.length === 0,
        'the console page produced no page errors beyond the injected 503',
        realErrors.slice(0, 3).join(' | '));

      const mismatches = diag.all.filter((line) => /Hydration mismatch/i.test(line));
      reporter.assert(mismatches.length === 0,
        'hydration reused the server DOM without mismatch warnings',
        mismatches.slice(0, 2).join(' | '));
    });

    // === Diagnostics page in a real browser ===============================
    // Asserting on the bytes is not enough: a client entry that hydrated the
    // wrong component against this page's DOM would leave the HTML above
    // untouched and still throw on load.
    await withPage(browser, `${base}/health`, async (page, diag) => {
      const metrics = await page.locator('.metric').count();
      const verdict = await page.getAttribute('[data-selftest]', 'data-selftest');
      reporter.assert(metrics >= 5 && verdict === 'pass' && diag.errors.length === 0,
        'the diagnostics page loads clean with no scripting of its own',
        `metrics=${metrics} selftest=${verdict} errors=${diag.errors.slice(0, 2).join(' | ')}`);
    });

    // === Deep link ========================================================
    // /incidents/:id has no server route of its own: the shell is the console
    // and the client router resolves the pane. A reload has to land on the
    // detail, not on an empty pane.
    await withPage(browser, `${base}/incidents/INC-1042`, async (page, diag) => {
      await page.waitForSelector('[data-detail="INC-1042"]', { timeout: 15000 });
      const title = (await page.textContent('[data-detail-title]')).trim();
      reporter.assert(title.length > 0 && diag.errors.length === 0,
        'a deep link into the client-routed pane renders the detail on first load',
        `title="${title}" errors=${diag.errors.length}`);
    });

    log('ops-console checks complete');
  },
};
