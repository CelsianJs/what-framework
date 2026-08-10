// Storefront smoke contract.
//
// Every capability listed in `covers` must be proven by a passing check below,
// and the runner fails if one is declared and never reported. The checks are
// ordered deliberately: the cache assertions run before anything posts a review,
// because a review purges the 'products' tag and would make a later MISS/HIT
// pair meaningless.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

export default {
  description: 'Ecommerce: static/hybrid/server pages, a global cart store, cookie auth, server actions, query cache.',

  covers: [
    'render:static',
    'render:server',
    'render:hybrid-isr',
    'render:hydration',
    'render:no-hydration-mismatch',
    'route:table',
    'route:params',
    'state:signal',
    'state:computed',
    'state:global-store',
    'state:persisted',
    'state:batch',
    'data:loader',
    'data:loader-request',
    'data:query',
    'data:invalidate',
    'server:action-js',
    'server:action-nojs',
    'server:csrf',
    'server:revalidate',
    'server:action-error',
    'cmp:control-flow',
    'cmp:head',
    'a11y:aria-enumerated',
  ],

  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    // === Build-time static export =========================================
    // Distinct from "rendered on first request and then cached": this proves
    // HTML exists on disk before anything is served.
    run('npm', ['run', 'export'], { cwd: workDir });

    const productHtmlPath = join(workDir, 'dist', 'product', 'aeron-mug', 'index.html');
    const exported = existsSync(productHtmlPath) ? readFileSync(productHtmlPath, 'utf8') : '';
    check('render:static', exported.includes('Aeron Mug') && exported.includes('$18.00'),
      'getStaticPaths page is prerendered to disk',
      exported ? `${exported.length} bytes` : 'dist/product/aeron-mug/index.html missing');

    const dataPath = join(workDir, 'dist', 'product', 'aeron-mug', '__what_data.json');
    reporter.assert(existsSync(dataPath), 'static export writes loader data beside the page');
    reporter.assert(!existsSync(join(workDir, 'dist', 'cart')),
      'server-mode routes are excluded from the static export');

    // === Server ===========================================================
    const server = startProcess('node', ['server.js'], {
      cwd: workDir,
      env: { ...process.env, PORT: String(appPort), NODE_ENV: '' },
    });
    // Readiness must not touch a cached route: probing '/' would populate the
    // ISR entry and the MISS/HIT assertion below would measure its own warmup.
    await waitForHttp(`${base}/api/search?q=`, { child: server });

    // === ISR: MISS then HIT ==============================================
    const first = await fetch(`${base}/`);
    const firstHtml = await first.text();
    const second = await fetch(`${base}/`);
    await second.text();

    check('render:hybrid-isr',
      first.headers.get('x-what-cache') === 'MISS' && second.headers.get('x-what-cache') === 'HIT',
      'hybrid page misses then hits the ISR cache',
      `${first.headers.get('x-what-cache')} then ${second.headers.get('x-what-cache')}`);

    // Loader data has to be IN the first byte, not fetched after hydration.
    check('data:loader', firstHtml.includes('Aeron Mug') && firstHtml.includes('Wool Desk Mat'),
      'loader data is present in server HTML');

    check('cmp:head',
      /<title>Smoke Supply Co\.<\/title>/.test(firstHtml)
        && /<meta[^>]+name="description"[^>]+content="Desk goods/.test(firstHtml),
      'Head renders title and meta server-side');

    // The bug this pins: What used to serialize boolean-looking ARIA values as
    // an empty attribute, so `aria-disabled=false` became `aria-disabled=""`,
    // which assistive tech reads as TRUE. Both spellings must be strings.
    check('a11y:aria-enumerated',
      firstHtml.includes('aria-disabled="false"') && firstHtml.includes('aria-disabled="true"'),
      'aria-* enumerated values serialize as "true"/"false"',
      firstHtml.includes('aria-disabled=""') ? 'found an empty aria-disabled' : '');

    // === Routing =========================================================
    const routeStatuses = {};
    for (const path of ['/', '/cart', '/search', '/account', '/review', '/product/aeron-mug']) {
      routeStatuses[path] = (await fetch(`${base}${path}`)).status;
    }
    check('route:table', Object.values(routeStatuses).every((s) => s === 200),
      'every route in the table answers 200', JSON.stringify(routeStatuses));

    const product = await fetch(`${base}/product/desk-mat`);
    const productHtml = await product.text();
    const missing = await fetch(`${base}/product/does-not-exist`);
    check('route:params',
      productHtml.includes('Wool Desk Mat') && missing.status === 404,
      'dynamic param resolves, unknown param 404s',
      `known=${product.status} unknown=${missing.status}`);

    // === Server mode is never cached =====================================
    const cart = await fetch(`${base}/cart`);
    await cart.text();
    check('render:server',
      /no-store/.test(cart.headers.get('cache-control') || '')
        && cart.headers.get('x-what-cache') !== 'HIT',
      'server-mode page is rendered per request and not cached',
      `cache-control=${cart.headers.get('cache-control')}`);

    // === Loader reads the request ========================================
    const anonAccount = await (await fetch(`${base}/account`)).text();
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'demo@smoke.test', password: 'hunter2' }),
      redirect: 'manual',
    });
    const sessionCookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const authedAccount = await (await fetch(`${base}/account`, { headers: { cookie: sessionCookie } })).text();

    check('data:loader-request',
      anonAccount.includes('data-signin')
        && !anonAccount.includes('data-account')
        && authedAccount.includes('data-account')
        && /data-email[^>]*>demo@smoke\.test</.test(authedAccount),
      'the loader branches on the request cookie, before any HTML exists',
      `anon-signin=${anonAccount.includes('data-signin')} authed-account=${authedAccount.includes('data-account')}`);

    // === CSRF ============================================================
    // A token cookie exists (the adapter set one on the first HTML response),
    // but the request presents the wrong one. That is the attack the
    // double-submit check exists to stop.
    const csrfCookie = (first.headers.get('set-cookie') || '').split(';')[0];
    const badToken = await fetch(`${base}/__what_action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-what-action': 'checkout',
        'x-csrf-token': 'not-the-real-token',
        cookie: csrfCookie,
      },
      body: JSON.stringify({ args: [{ lines: [{ slug: 'aeron-mug', qty: 1 }] }] }),
    });
    const noToken = await fetch(`${base}/__what_action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-what-action': 'checkout' },
      body: JSON.stringify({ args: [{ lines: [] }] }),
    });
    check('server:csrf', badToken.status === 403 && noToken.status === 403,
      'an action with a wrong or missing CSRF token is rejected',
      `wrong=${badToken.status} missing=${noToken.status}`);

    // === A throwing action ===============================================
    const realToken = decodeURIComponent(csrfCookie.split('=')[1] || '');
    const boom = await fetch(`${base}/__what_action`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-what-action': 'checkout',
        'x-csrf-token': realToken,
        cookie: csrfCookie,
      },
      body: JSON.stringify({ args: [{ lines: [] }] }),
    });
    const boomBody = await boom.json().catch(() => ({}));
    const stillUp = await fetch(`${base}/`);
    await stillUp.text();
    check('server:action-error',
      boom.status === 500 && boomBody.message === 'Action failed' && stillUp.status === 200,
      'a thrown action returns a generic failure and the server keeps serving',
      `status=${boom.status} message=${boomBody.message} next=${stillUp.status}`);

    // === Browser: hydration + client state ===============================
    await withPage(browser, `${base}/product/aeron-mug`, async (page, diag) => {
      await page.click('[data-add]');
      await page.waitForFunction(() => document.querySelector('[data-added]')?.textContent.trim().length > 0);

      check('state:signal',
        (await page.textContent('[data-added]')).includes('Added to cart'),
        'a local signal written by a click updates the DOM');

      check('render:hydration', diag.errors.length === 0,
        'the page hydrated and became interactive with no errors',
        diag.errors.slice(0, 2).join(' | '));

      const mismatches = diag.all.filter((l) => /Hydration mismatch/i.test(l));
      check('render:no-hydration-mismatch', mismatches.length === 0,
        'hydration reused the server DOM without mismatch warnings',
        mismatches.slice(0, 2).join(' | '));

      check('state:computed',
        (await page.textContent('[data-cart-subtotal]')) === '$18.00',
        'the computed subtotal tracks the store');

      // Same tab, different page: the module-scope store is the only thing
      // carrying the cart across the navigation.
      await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      const countOnHome = await page.textContent('[data-cart-count]');
      check('state:global-store', countOnHome === '1',
        'a global store add is visible on another route', `badge=${countOnHome}`);

      // Full reload: only localStorage can carry it now.
      await page.reload({ waitUntil: 'networkidle' });
      const countAfterReload = await page.textContent('[data-cart-count]');
      check('state:persisted', countAfterReload === '1',
        'the cart survives a full page reload', `badge=${countAfterReload}`);

      // --- Control flow + cart interactions -----------------------------
      await page.goto(`${base}/cart`, { waitUntil: 'networkidle' });
      const hadTable = await page.locator('[data-cart-table]').count();
      await page.click('[data-inc="aeron-mug"]');
      await page.waitForFunction(() => document.querySelector('[data-qty="aeron-mug"]')?.textContent === '2');
      const subtotalAfterInc = await page.textContent('[data-subtotal]');

      // Empty it and back again, so both arms of <Show> are exercised.
      await page.click('[data-dec="aeron-mug"]');
      await page.click('[data-dec="aeron-mug"]');
      await page.waitForSelector('[data-cart-empty]');
      const emptyShown = await page.locator('[data-cart-empty]').count();

      check('cmp:control-flow',
        hadTable === 1 && subtotalAfterInc === '$36.00' && emptyShown === 1,
        'Show/For render and swap arms reactively',
        `table=${hadTable} subtotal=${subtotalAfterInc} empty=${emptyShown}`);

      // --- batch --------------------------------------------------------
      // The DOM is identical batched or not. The observable difference is how
      // many times a reader runs, so measure that directly against the store.
      const batching = await page.evaluate(async () => {
        // Same URLs the import map resolves, so these are the page's own module
        // instances, not fresh copies.
        const core = await import('/node_modules/what-framework/src/index.js');
        const store = await import('/src/store/cart.js');

        store.addItem({ slug: 'aeron-mug', title: 'Aeron Mug', price: 1800 }, 1);
        store.addItem({ slug: 'desk-mat', title: 'Wool Desk Mat', price: 6500 }, 1);

        let runs = 0;
        const dispose = core.effect(() => { store.count(); runs++; });
        const afterSubscribe = runs;

        store.applyBulk([['aeron-mug', 4], ['desk-mat', 5]]);
        const batched = runs - afterSubscribe;

        const beforeUnbatched = runs;
        store.setQty('aeron-mug', 6);
        store.setQty('desk-mat', 7);
        const unbatched = runs - beforeUnbatched;

        dispose?.();
        store.clear();
        return { batched, unbatched };
      });

      check('state:batch',
        batching.batched === 1 && batching.unbatched === 2,
        'batched writes settle once; the same writes unbatched settle twice',
        `batched=${batching.batched} unbatched=${batching.unbatched}`);
    });

    // === Query cache =====================================================
    await withPage(browser, `${base}/search`, async (page) => {
      // The first render queries with an empty term and lists everything, so
      // "aeron-mug is present" is true before the search even runs. Wait for the
      // list to NARROW, which is the only state that proves the reactive part of
      // the query key re-ran the fetch.
      const initialFetches = Number(await page.textContent('[data-fetch-count]'));
      await page.fill('[data-search-input]', 'mug');
      await page.waitForFunction(
        () => document.querySelectorAll('[data-result]').length === 1
          && document.querySelector('[data-result="aeron-mug"]'),
        undefined,
        { timeout: 10000 },
      );

      const results = await page.locator('[data-result]').count();
      const fetchesAfterSearch = Number(await page.textContent('[data-fetch-count]'));
      check('data:query', results === 1 && fetchesAfterSearch > initialFetches,
        'useQuery refetches when the reactive part of the key changes',
        `results=${results} fetches=${initialFetches} -> ${fetchesAfterSearch}`);

      // invalidateQueries(['products']) has to reach ['products','search',term]
      // as a PREFIX. Passing an array key here used to match nothing at all.
      await page.click('[data-invalidate]');
      await page.waitForFunction(
        (before) => Number(document.querySelector('[data-fetch-count]')?.textContent) > before,
        fetchesAfterSearch,
        { timeout: 5000 },
      );
      const fetchesAfterInvalidate = Number(await page.textContent('[data-fetch-count]'));
      check('data:invalidate', fetchesAfterInvalidate > fetchesAfterSearch,
        'invalidateQueries with an array prefix refetches the matching key',
        `${fetchesAfterSearch} -> ${fetchesAfterInvalidate}`);
    });

    // === Server actions, both paths ======================================
    // Warm the static product page so the revalidation assertion below is
    // measuring a real purge rather than a cold cache.
    const warm1 = await fetch(`${base}/product/cable-clip`);
    await warm1.text();
    const warm2 = await fetch(`${base}/product/cable-clip`);
    await warm2.text();
    reporter.assert(warm2.headers.get('x-what-cache') === 'HIT',
      'static product page is cached before the revalidation test',
      `x-what-cache=${warm2.headers.get('x-what-cache')}`);

    // --- With JavaScript: enhanceForms intercepts and posts ---------------
    await withPage(browser, `${base}/review`, async (page, diag) => {
      await page.selectOption('#review-slug', 'cable-clip');
      await page.fill('#review-body', 'Holds cables. Reviewed with JS.');
      await Promise.all([
        page.waitForURL(/\/review\?posted=1/, { timeout: 15000 }),
        page.click('[data-review-submit]'),
      ]);
      const posted = await page.locator('[data-review-posted]').count();
      check('server:action-js', posted === 1,
        'an enhanced <Form> posts the action and follows its redirect',
        diag.errors.slice(0, 2).join(' | '));
    });

    // --- Revalidation: the cached static page must show it ---------------
    const afterAction = await fetch(`${base}/product/cable-clip`);
    const afterActionHtml = await afterAction.text();
    check('server:revalidate',
      afterActionHtml.includes('Reviewed with JS.')
        && afterAction.headers.get('x-what-cache') !== 'HIT',
      'revalidateTag purges the cached page so the new data is visible',
      `x-what-cache=${afterAction.headers.get('x-what-cache')}`);

    // --- Without JavaScript ----------------------------------------------
    // A context that genuinely cannot run scripts. Enhancement is impossible by
    // construction, so this exercises the plain HTML form submit.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    try {
      await withPage(browser, `${base}/review`, async (page) => {
        await page.selectOption('#review-slug', 'field-notes');
        await page.fill('#review-body', 'Posted with scripting disabled.');
        await Promise.all([
          page.waitForURL(/\/review\?posted=1/, { timeout: 15000 }),
          page.click('[data-review-submit]'),
        ]);
        const posted = await page.locator('[data-review-posted]').count();

        const stored = await fetch(`${base}/product/field-notes`);
        const storedHtml = await stored.text();
        check('server:action-nojs',
          posted === 1 && storedHtml.includes('Posted with scripting disabled.'),
          'a <Form> action completes with JavaScript disabled',
          `redirected=${posted === 1} persisted=${storedHtml.includes('Posted with scripting disabled.')}`);
      }, { context: noJs });
    } finally {
      await noJs.close();
    }

    log('storefront checks complete');
  },
};
