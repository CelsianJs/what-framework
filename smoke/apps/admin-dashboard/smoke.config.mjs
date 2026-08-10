// Admin dashboard smoke contract.
//
// This is the only app in the suite that runs through what-compiler, which is
// why cmp:keyed-list lives here: dom.js never reads vnode.key, so keyed
// reconciliation exists on the compiled path alone (smoke/FINDINGS.md A).
//
// Everything below is observed in a real browser against a production `vite
// build`, never asserted from source. The order matters in one place: the
// signed-out deep link has to run before anything signs in, because the guard
// is only observable while there is no session.

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const SIGNIN_NAME = 'Ines Okafor';

export default {
  description: 'Compiled JSX SPA: persistent shell, nested routes, sign-in gate, loading/error routes, context, Portal, keyed table.',

  covers: [
    'render:client-spa',
    'route:nested-layout',
    'route:guard',
    'route:loading',
    'route:error',
    'route:404',
    'route:link-active',
    'route:programmatic',
    'state:context',
    'cmp:portal',
    'cmp:keyed-list',
    'cmp:error-boundary',
  ],

  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    // === Production build ==================================================
    // `vite build` with the What plugin, so every assertion below is about
    // compiled output and not about a dev-server transform.
    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle',
      buildLog.trim().split('\n').pop());

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    // === The document is empty ============================================
    // A deep link is served by the SPA fallback with no app markup in it: the
    // client build is the only thing that can produce the dashboard.
    const deepLink = await fetch(`${base}/orders`);
    const deepHtml = await deepLink.text();
    // The <title> is in index.html, so absence of the word "Northwind" proves
    // nothing. What must be absent is anything only a render could produce.
    const documentIsEmpty = deepLink.status === 200
      && /<div id="app">\s*<\/div>/.test(deepHtml)
      && !deepHtml.includes('data-orders-table')
      && !deepHtml.includes('data-shell')
      && !deepHtml.includes('NW-2041');

    // === One signed-out session ===========================================
    await withPage(browser, `${base}/customers`, async (page, diag) => {
      // --- route:guard --------------------------------------------------
      await page.waitForSelector('[data-signin]', { timeout: 10000 });
      const guardUrl = await page.evaluate(() => location.pathname + location.search);
      const customersLeaked = await page.locator('[data-customer-body] tr').count();
      check('route:guard',
        guardUrl === '/signin?next=%2Fcustomers' && customersLeaked === 0,
        'an unauthenticated deep link lands on the sign-in route',
        `url=${guardUrl} customer-rows=${customersLeaked}`);

      // --- Sign in, which also proves the deep link resumes --------------
      await page.fill('[data-signin-name]', SIGNIN_NAME);
      await page.click('[data-signin-submit]');
      await page.waitForSelector('[data-customer-body] tr', { timeout: 10000 });
      const afterSignIn = await page.evaluate(() => location.pathname);
      reporter.assert(afterSignIn === '/customers',
        'sign-in resumes the originally requested route', `url=${afterSignIn}`);

      const customerRows = await page.locator('[data-customer-body] tr').count();
      check('render:client-spa',
        documentIsEmpty && customerRows === 7,
        'a route with no server HTML is rendered entirely by the client build',
        `document=${documentIsEmpty ? 'empty #app' : 'CARRIED MARKUP'} rendered-rows=${customerRows}`);

      // --- state:context -------------------------------------------------
      // UserMenu imports neither the session nor the theme module. Everything
      // it shows arrives through <Workspace.Provider> four levels up, and the
      // name it prints was typed into the sign-in form a moment ago.
      const badgeName = await page.textContent('[data-badge-name]');
      const badgeMetaNight = await page.textContent('[data-badge-meta]');

      await page.click('[data-theme-toggle]');
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'day');
      const badgeMetaDay = await page.textContent('[data-badge-meta]');
      await page.click('[data-theme-toggle]');
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');

      check('state:context',
        badgeName === SIGNIN_NAME
          && badgeMetaNight === "Ines's workspace · night theme"
          && badgeMetaDay === "Ines's workspace · day theme",
        'a deep child reads the provided value and follows it when it changes',
        `name=${badgeName} meta="${badgeMetaNight}" -> "${badgeMetaDay}"`);

      // The shell is the Router's globalLayout, so it must survive navigation.
      await page.evaluate(() => { document.querySelector('[data-sidebar]').__shellStamp = 'kept'; });

      // --- route:link-active --------------------------------------------
      await page.click('[data-nav="/orders"]');
      await page.waitForSelector('[data-orders-body] tr');
      const onOrders = await page.evaluate(() => ({
        orders: document.querySelector('[data-nav="/orders"]').className,
        home: document.querySelector('[data-nav="/"]').className,
      }));

      // --- route:programmatic --------------------------------------------
      // A table row is not a link. Clicking one calls navigate() from an event
      // handler, and the URL plus the rendered page both have to follow.
      await page.click('[data-row="NW-2044"]');
      await page.waitForSelector('[data-order-id]');
      const detail = await page.evaluate(() => ({
        url: location.pathname,
        id: document.querySelector('[data-order-id]').textContent,
        total: document.querySelector('[data-order-total]').textContent,
      }));
      check('route:programmatic',
        detail.url === '/orders/NW-2044' && detail.id === 'NW-2044' && detail.total === '$529.00',
        'navigate() from a click handler moves the URL and the rendered page',
        `url=${detail.url} heading=${detail.id} total=${detail.total}`);

      // A child route keeps its parent link active but not exact-active.
      const onDetail = await page.evaluate(() =>
        document.querySelector('[data-nav="/orders"]').className);
      check('route:link-active',
        onOrders.orders.includes('active') && onOrders.orders.includes('exact-active')
          && !onOrders.home.includes('active')
          && onDetail.includes('active') && !onDetail.includes('exact-active'),
        'Link marks the current branch active and only the exact match exact-active',
        `/orders="${onOrders.orders}" /="${onOrders.home}" on-detail="${onDetail}"`);

      // --- route:nested-layout -------------------------------------------
      await page.click('[data-nav="/settings/profile"]');
      await page.waitForSelector('[data-profile-name]');
      const profileNesting = await page.evaluate(() => ({
        nested: !!document.querySelector('[data-shell] [data-outlet] [data-settings] [data-settings-page] [data-profile-name]'),
        name: document.querySelector('[data-profile-name]').textContent,
      }));

      // The sibling route re-uses the same layout, and the layout's own sub-nav
      // marks it active. A layout that only wrapped one route would fail here.
      await page.click('[data-settings-nav="team"]');
      await page.waitForSelector('[data-team-body] tr');
      const teamNesting = await page.evaluate(() => ({
        nested: !!document.querySelector('[data-settings] [data-settings-page] [data-team-body]'),
        subnav: document.querySelector('[data-settings-nav="team"]').className,
        members: document.querySelectorAll('[data-team-body] tr').length,
      }));
      check('route:nested-layout',
        profileNesting.nested && profileNesting.name === SIGNIN_NAME
          && teamNesting.nested && teamNesting.members === 4
          && teamNesting.subnav.includes('active'),
        'both /settings pages render inside the shared settings layout',
        `profile=${profileNesting.nested} name="${profileNesting.name}" team=${teamNesting.nested}`
          + ` members=${teamNesting.members} subnav="${teamNesting.subnav}"`);

      // --- route:loading --------------------------------------------------
      // The reports rollup is awaited in a beforeNavigate hook, so the router
      // holds isNavigating true long enough for the destination's `loading:`
      // component to actually paint.
      const clickedAt = Date.now();
      await page.click('[data-nav="/reports"]');
      await page.waitForSelector('[data-reports-loading]', { timeout: 5000 });
      const skeletonAt = Date.now() - clickedAt;
      const skeletonWhileLoading = await page.locator('[data-reports]').count();
      await page.waitForSelector('[data-report-body] tr', { timeout: 10000 });
      const reportAt = Date.now() - clickedAt;
      const regions = await page.locator('[data-report-body] tr').count();
      check('route:loading',
        skeletonWhileLoading === 0 && regions === 3 && reportAt > skeletonAt,
        "the destination route's loading component shows, then the page replaces it",
        `skeleton@${skeletonAt}ms (page absent) -> ${regions} regions@${reportAt}ms`);

      // --- route:error ----------------------------------------------------
      await page.click('[data-nav="/diagnostics"]');
      await page.waitForSelector('[data-route-error]', { timeout: 10000 });
      const routeError = await page.evaluate(() => ({
        message: document.querySelector('[data-route-error-msg]').textContent,
        shellAlive: document.querySelector('[data-sidebar]')?.__shellStamp ?? null,
        pageContent: document.querySelectorAll('[data-outlet] .page-head').length,
      }));
      check('route:error',
        routeError.message === 'Diagnostics probe failed: metrics agent unreachable'
          && routeError.pageContent === 0,
        "a route's error component catches the page's throw",
        `message="${routeError.message}" page-rendered=${routeError.pageContent}`);
      reporter.assert(routeError.shellAlive === 'kept',
        'the globalLayout shell survived six navigations and a route crash',
        `stamp=${routeError.shellAlive}`);

      // --- route:404 -------------------------------------------------------
      await page.click('[data-nav="/warehouse"]');
      await page.waitForSelector('[data-notfound]', { timeout: 10000 });
      const notFound = await page.evaluate(() => ({
        url: location.pathname,
        path: document.querySelector('[data-notfound-path]').textContent,
        shell: !!document.querySelector('[data-sidebar]'),
      }));
      check('route:404',
        notFound.url === '/warehouse' && notFound.path === '/warehouse' && notFound.shell,
        'an unmatched path renders the router fallback inside the shell',
        `url=${notFound.url} rendered-path=${notFound.path}`);

      // --- cmp:keyed-list --------------------------------------------------
      // Stamp a JS expando on every row, re-sort by a different column, and
      // require the SAME node objects back. A recreated row loses the expando,
      // which is the failure this check exists to catch.
      await page.click('[data-nav="/orders"]');
      await page.waitForSelector('[data-orders-body] tr');
      const before = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-orders-body] tr')];
        rows.forEach((tr, i) => { tr.__rowStamp = `row-${i}`; });
        return rows.map((tr) => tr.dataset.row);
      });
      await page.click('[data-sort="total"]');
      await page.waitForFunction(
        (firstBefore) => {
          const rows = document.querySelectorAll('[data-orders-body] tr');
          return rows.length > 0 && rows[0].dataset.row !== firstBefore;
        },
        before[0],
        { timeout: 10000 },
      );
      const after = await page.evaluate(() =>
        [...document.querySelectorAll('[data-orders-body] tr')]
          .map((tr) => ({ id: tr.dataset.row, stamp: tr.__rowStamp ?? null })));

      const stampById = Object.fromEntries(before.map((id, i) => [id, `row-${i}`]));
      const reordered = after.map((r) => r.id).join(',') !== before.join(',');
      const sameSet = after.length === before.length
        && after.every((r) => stampById[r.id] !== undefined);
      const identityKept = after.every((r) => r.stamp === stampById[r.id]);
      check('cmp:keyed-list',
        reordered && sameSet && identityKept,
        'sorting a keyed table moves the existing row nodes instead of rebuilding them',
        `${before.join(' ')} -> ${after.map((r) => r.id).join(' ')} | stamps kept ${after.filter((r) => r.stamp).length}/${after.length}`);

      // --- cmp:portal -------------------------------------------------------
      await page.click('[data-nav="/"]');
      await page.waitForSelector('[data-no-drafts]');
      await page.click('[data-new-order]');
      await page.waitForSelector('[data-modal]');
      const portal = await page.evaluate(() => ({
        inModalRoot: !!document.querySelector('#modal-root [data-modal]'),
        inApp: !!document.querySelector('#app [data-modal]'),
        inTopbar: !!document.querySelector('[data-topbar] [data-modal]'),
      }));
      await page.fill('[data-modal-customer]', 'Hedy Lamarr');
      await page.click('[data-modal-save]');
      await page.waitForSelector('[data-draft-list] li');
      const draft = await page.textContent('[data-draft-list] li');
      const modalGone = await page.locator('[data-modal]').count();
      check('cmp:portal',
        portal.inModalRoot && !portal.inApp && !portal.inTopbar
          && draft.includes('Hedy Lamarr') && modalGone === 0,
        'the dialog renders into #modal-root outside #app and still drives app state',
        `in-modal-root=${portal.inModalRoot} in-app=${portal.inApp} draft="${draft}" closed=${modalGone === 0}`);

      // --- cmp:error-boundary -----------------------------------------------
      // The feed renders fine first. The throw arrives later, from a component
      // CREATED by a reactive re-render, which is the only shape a run-once
      // model can catch.
      const feedFirst = await page.locator('[data-feed-item]').count();
      await page.click('[data-break-feed]');
      await page.waitForSelector('[data-feed-error]', { timeout: 10000 });
      const caught = await page.textContent('[data-feed-error-msg]');
      const feedGone = await page.locator('[data-feed-item]').count();
      await page.click('[data-feed-retry]');
      await page.waitForSelector('[data-feed-item]', { timeout: 10000 });
      const feedBack = await page.locator('[data-feed-item]').count();
      check('cmp:error-boundary',
        feedFirst === 4 && feedGone === 0
          && caught === 'Feed socket closed: upstream returned 502'
          && feedBack === 4,
        'a throw after a state change is caught, and reset() restores the subtree',
        `items=${feedFirst} -> caught "${caught}" -> items=${feedBack}`);

      // Two framework defects produce console noise on every run of this app,
      // so they are named here rather than filtered silently:
      //
      //  - "Redirect cycle detected" on a middleware redirect. navigate() sets
      //    isNavigating and then defers the URL commit into
      //    document.startViewTransition. renderMatch reads isNavigating, so the
      //    flag flip re-runs the match against the STILL-OLD url, the same
      //    middleware returns the same target, and the duplicate detector fires
      //    on a redirect that is not cycling. Deleting startViewTransition takes
      //    the count from 25 to 0.
      //  - "Transition was skipped" as an uncaught page error. navigate() awaits
      //    the transition's .finished and swallows it, but the rejection of
      //    .ready has no handler.
      //
      // Anything OUTSIDE that set, and outside this app's two deliberate
      // throws, is a real problem and fails the run.
      // The guard is live, not a first-load-only redirect: dropping the session
      // re-matches the current route and bounces immediately.
      await page.click('[data-signout]');
      await page.waitForSelector('[data-signin]', { timeout: 10000 });
      const afterSignOut = await page.evaluate(() => location.pathname);
      reporter.assert(afterSignOut === '/signin',
        'signing out re-runs the guard and bounces off the protected route',
        `url=${afterSignOut}`);

      const known = /502|metrics agent unreachable|Redirect cycle detected|Transition was skipped/;
      const noise = diag.all.filter((l) => /Redirect cycle detected|Transition was skipped/.test(l));
      const unexpected = diag.errors.filter((l) => !known.test(l));
      log(`known router noise on this run: ${noise.length} message(s)`);
      reporter.assert(unexpected.length === 0,
        'no page errors beyond the deliberate throws and the two reported router defects',
        unexpected.slice(0, 3).join(' | '));
    });

    log('admin-dashboard checks complete');
  },
};
