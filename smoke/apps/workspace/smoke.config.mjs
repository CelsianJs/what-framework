// Workspace smoke contract.
//
// The other apps each prove a few features in one screen. This one chains the
// workflows of a real product in one browser session, in the order a person
// would use them: a guarded deep link, sign-in, an optimistic edit and its
// rollback, a modal, a list that has to reflect the edit, a three-step wizard
// walked with the browser's back and forward buttons, a reload in the middle
// of it, and the project it creates. Each step starts from whatever the steps
// before it left behind, which is what a page reached by clicking around has
// and a page loaded fresh for one test does not.

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  description: 'Compiled SPA chaining sign-in, a guarded route, nested layouts, a queried list, an optimistic edit with rollback, a wizard across back/forward and a reload, a modal and toasts.',

  covers: [
    'route:guard',
    'route:nested-layout',
    'route:history',
    'data:query',
    'data:optimistic',
    'data:optimistic-rollback',
    'form:validation',
    'form:wizard',
    'state:persisted',
    'cmp:portal',
    'a11y:focus-trap',
    'a11y:live-region',
  ],

  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    const context = await browser.newContext();
    try {
      await withPage(browser, `${base}/projects/3`, async (page, diag) => {
        const path = () => page.evaluate(() => location.pathname + location.search);
        const text = (sel) => page.$eval(sel, (el) => el.textContent.trim());
        const value = (sel) => page.$eval(sel, (el) => el.value);

        // === A deep link while signed out =====================================
        await page.waitForSelector('[data-signin]');
        const guarded = await path();
        await page.fill('[data-signin-name]', 'Rey Castillo');
        await page.click('[data-signin-submit]');
        await page.waitForSelector('[data-project-name]');
        const resumed = await path();
        const firstName = await text('[data-project-name]');
        check('route:guard', guarded === '/signin?next=%2Fprojects%2F3' && resumed === '/projects/3' && firstName === 'Project Cinder',
          'a signed-out deep link goes to sign-in and comes back to the page it asked for',
          `guard=${guarded} resumed=${resumed} heading="${firstName}"`);

        // === Optimistic rename: shows at once, settles to the server's answer ==
        await page.fill('[data-rename-input]', 'Cinder Prime');
        const t0 = Date.now();
        await page.click('[data-rename-submit]');
        await page.waitForFunction(() => document.querySelector('[data-project-name]').textContent === 'Cinder Prime', null, { timeout: 2000 });
        const shownAfter = Date.now() - t0;
        const apiAtShow = await page.evaluate(() => window.__api.rename);
        await page.waitForSelector('[data-toast="success"]', { timeout: 3000 });
        await sleep(100);
        const settled = await text('[data-project-name]');
        check('data:optimistic', shownAfter < 300 && settled === 'Cinder Prime' && apiAtShow === 1,
          'a rename shows before the server answers and stays when it accepts',
          `shown after ${shownAfter}ms (server takes 400ms) settled="${settled}"`);

        // === The error path: the server refuses, the name rolls back ===========
        await page.fill('[data-rename-input]', 'Will fail');
        await page.click('[data-rename-submit]');
        await page.waitForFunction(() => document.querySelector('[data-project-name]').textContent === 'Will fail', null, { timeout: 2000 });
        await page.waitForSelector('[data-toast="error"]', { timeout: 3000 });
        await sleep(50);
        const rolledBack = await text('[data-project-name]');
        const errorToast = await text('[data-toast="error"] span');
        check('data:optimistic-rollback', rolledBack === 'Cinder Prime' && errorToast.includes('refused'),
          'a rename the server refuses shows at once and rolls back to the committed name',
          `after refusal heading="${rolledBack}" toast="${errorToast}"`);
        const liveRegion = await page.$eval('[data-toasts]', (el) => ({ live: el.getAttribute('aria-live'), role: el.getAttribute('role'), n: el.children.length }));
        check('a11y:live-region', liveRegion.live === 'polite' && liveRegion.role === 'status' && liveRegion.n >= 2,
          'outcomes are announced through a polite live region', JSON.stringify(liveRegion));

        // === The archive dialog: a portal with a focus trap ====================
        await page.click('[data-archive]');
        await page.waitForSelector('[data-dialog]');
        const placement = await page.evaluate(() => {
          const d = document.querySelector('[data-dialog]');
          return { inModalRoot: !!d.closest('#modal-root'), inApp: !!d.closest('#app') };
        });
        await sleep(50);
        const focusTrail = [];
        for (let i = 0; i < 6; i++) {
          await page.keyboard.press('Tab');
          focusTrail.push(await page.evaluate(() => !!document.activeElement?.closest('[data-dialog]')));
        }
        await page.keyboard.press('Shift+Tab');
        focusTrail.push(await page.evaluate(() => !!document.activeElement?.closest('[data-dialog]')));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-dialog]'), null, { timeout: 2000 });
        const restored = await page.evaluate(() => document.activeElement?.hasAttribute('data-archive'));
        check('cmp:portal', placement.inModalRoot && !placement.inApp,
          'the dialog renders into #modal-root, outside the page that opened it', JSON.stringify(placement));
        check('a11y:focus-trap', focusTrail.every(Boolean) && restored,
          'Tab and Shift+Tab stay inside the dialog; Escape closes it and focus returns to its trigger',
          `inside=${focusTrail.map((x) => (x ? 1 : 0)).join('')} restored=${restored}`);

        // === The list reflects the rename =======================================
        await page.click('[data-nav="projects"]');
        await page.waitForSelector('[data-projects] [data-project="3"]');
        const listRow = await text('[data-project="3"] a');
        const listCount = await page.locator('[data-projects] li').count();
        check('data:query', listRow === 'Cinder Prime' && listCount === 12,
          'the project list is queried and shows the edit made on the detail page',
          `row 3="${listRow}" rows=${listCount}`);

        // === The wizard =========================================================
        await page.click('[data-new-project]');
        await page.waitForSelector('[data-form="details"]');
        const nesting = await page.evaluate(() => !!document.querySelector('[data-shell] [data-outlet] [data-wizard] [data-form="details"]'));
        check('route:nested-layout', nesting,
          'a wizard step renders inside the wizard layout inside the shell', `nested=${nesting}`);
        // The layout's own state (its tips panel, closed here) has to survive a
        // step change, as a React Router or Next.js layout does
        // (smoke/FINDINGS.md 23).
        await page.click('[data-tips-toggle]');
        await page.waitForFunction(() => !document.querySelector('[data-tips]'));
        await page.evaluate(() => { document.querySelector('[data-wizard]').__stamp = 'kept'; });

        // Submitting an empty first step shows both errors and stays.
        await page.click('[data-next]');
        await page.waitForSelector('[data-error="name"]');
        const emptyErrors = await page.$$eval('[data-error]', (els) => els.map((e) => e.dataset.error).sort().join(','));
        const stayed = await path();
        await page.fill('[data-field="name"]', 'Or');
        await page.click('[data-next]');
        await sleep(100);
        const shortError = await text('[data-error="name"]').catch(() => '');
        check('form:validation', emptyErrors === 'name,owner' && stayed === '/new/details' && /3 characters/.test(shortError),
          'a step refuses invalid answers with an error per field',
          `errors=${emptyErrors} stayed=${stayed} short="${shortError}"`);

        await page.fill('[data-field="name"]', 'Orchard');
        await page.selectOption('[data-field="owner"]', 'Bo Lindqvist');
        await page.selectOption('[data-field="kind"]', 'research');
        await page.click('[data-next]');
        await page.waitForSelector('[data-form="team"]');
        const layoutKept = await page.evaluate(() => ({
          sameNode: document.querySelector('[data-wizard]').__stamp === 'kept',
          tipsHidden: !document.querySelector('[data-tips]'),
        }));
        check('route:nested-layout', layoutKept.sameNode && layoutKept.tipsHidden,
          'the wizard layout stays mounted, with its state, while the steps change under it',
          `same-node=${layoutKept.sameNode} tips-still-hidden=${layoutKept.tipsHidden}`);

        await page.fill('[data-field="email"]', 'nope');
        await page.click('[data-add-member]');
        await page.waitForSelector('[data-error="email"]');
        for (const email of ['mira@atlas.dev', 'tomas@atlas.dev']) {
          await page.fill('[data-field="email"]', email);
          await page.click('[data-add-member]');
          await page.waitForSelector(`[data-member="${email}"]`);
        }

        // Back to step one with the browser: the answers are there.
        await page.goBack();
        await page.waitForSelector('[data-form="details"]');
        const backPath = await path();
        const backValues = [await value('[data-field="name"]'), await value('[data-field="owner"]'), await value('[data-field="kind"]')];
        const currentStep = await page.$eval('[aria-current="step"]', (el) => el.dataset.step).catch(() => null);
        // And forward again: the team is there.
        await page.goForward();
        await page.waitForSelector('[data-form="team"]');
        const forwardMembers = await page.$$eval('[data-member]', (els) => els.map((e) => e.dataset.member));

        // A full reload in the middle of the wizard.
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-form="team"]', { timeout: 5000 }).catch(() => {});
        const reloadPath = await path();
        const reloadMembers = await page.$$eval('[data-member]', (els) => els.map((e) => e.dataset.member));
        const stillSignedIn = await page.$eval('[data-user]', (el) => el.textContent).catch(() => null);
        check('state:persisted', reloadPath === '/new/team' && reloadMembers.length === 2 && stillSignedIn === 'Rey Castillo',
          'a reload in the middle of the wizard keeps the session, the step and its answers',
          `path=${reloadPath} members=${reloadMembers.join(',')} user=${stillSignedIn}`);

        await page.click('[data-next]');
        await page.waitForSelector('[data-form="review"]');
        const review = {
          name: await text('[data-review="name"]'),
          owner: await text('[data-review="owner"]'),
          kind: await text('[data-review="kind"]'),
          members: await text('[data-review="members"]'),
        };
        check('form:wizard',
          backPath === '/new/details' && backValues.join('|') === 'Orchard|Bo Lindqvist|research' && currentStep === 'details'
            && forwardMembers.join(',') === 'mira@atlas.dev,tomas@atlas.dev'
            && review.name === 'Orchard' && review.owner === 'Bo Lindqvist' && review.kind === 'research'
            && review.members === 'mira@atlas.dev, tomas@atlas.dev',
          'the wizard validates per step and keeps every answer across back, forward and a reload',
          `back=${backPath} values=${backValues.join('|')} step=${currentStep} forward=${forwardMembers.join(',')} review=${JSON.stringify(review)}`);

        // Create it.
        await page.click('[data-create]');
        await page.waitForFunction(() => location.pathname === '/projects/13', null, { timeout: 5000 }).catch(() => {});
        await page.waitForSelector('[data-project-name]');
        const created = { path: await path(), name: await text('[data-project-name]') };
        const createdToast = await page.$$eval('[data-toast="success"] span', (els) => els.map((e) => e.textContent).join('|'));

        // === Browser history through all of it ===================================
        // Back from the new project: the review step's guard sends an emptied
        // draft to step one. Then back again, and forward to the project.
        await page.goBack();
        await page.waitForSelector('[data-form]', { timeout: 3000 }).catch(() => {});
        const backFromCreated = await path();
        const backToDetails = await page.$eval('[data-field="name"]', (el) => el.value).catch(() => null);
        await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
        await page.waitForSelector('[data-projects] li');
        const listAfterReload = await page.locator('[data-projects] li').count();
        await page.click('[data-project="13"] a');
        await page.waitForSelector('[data-project-name]');
        await page.goBack();
        await page.waitForSelector('[data-projects] li');
        const atList = await path();
        await page.goForward();
        await page.waitForSelector('[data-project-name]');
        const forwardName = await text('[data-project-name]');
        check('route:history',
          created.path === '/projects/13' && created.name === 'Orchard' && createdToast.includes('Created Orchard')
            && backFromCreated === '/new/details' && backToDetails === ''
            && listAfterReload === 13 && atList === '/projects' && forwardName === 'Orchard',
          'back and forward walk the session: wizard steps, the created project, the list',
          `created=${created.path} "${created.name}" back=${backFromCreated} (name="${backToDetails}") list=${listAfterReload} back=${atList} forward="${forwardName}"`);

        // Toasts dismiss themselves.
        await sleep(5300);
        const toastsLeft = await page.locator('[data-toast]').count();
        reporter.assert(toastsLeft === 0, 'toasts dismiss themselves', `left=${toastsLeft}`);

        reporter.assert(diag.errors.length === 0, 'the workspace ran with zero page errors', diag.errors.slice(0, 3).join(' | '));
        const warnings = diag.warnings.filter((w) => w.includes('[what]'));
        reporter.assert(warnings.length === 0, 'the workspace ran with no framework warnings', warnings.slice(0, 3).join(' | '));
      }, { context });
    } finally {
      await context.close();
    }
  },
};
