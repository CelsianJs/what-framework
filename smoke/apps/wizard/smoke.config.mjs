// Wizard smoke contract.
//
// An eight-step insurance quote, the shape of every onboarding, checkout and
// quote flow: one route per step under a shared layout, a step added by an
// earlier answer, dependent fields (a state list loaded for the country),
// field arrays nested two deep, four kinds of validation (sync rules, a zod
// schema, an async check on a slow server that answers out of order, rules
// that read other fields), a draft saved to storage as the visitor types and
// restored on a reload, and a submit the server validates again, its errors
// mapped back to the field and step they belong to.
//
// The check drives it as a visitor would, with real keystrokes and clicks.
// Expected answers come from the app's own reference data (src/data.js),
// imported here. Timings are taken in the page, from the event to the DOM
// showing its result.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { startProcess, waitForHttp, withPage } from '../../harness/index.mjs';

const BUDGET = { keystroke: 50, stepChange: 250 };
const LONG = 'Garage kept in a locked building; parked on the street only when visiting family. Fitted with winter tyres from November to March and a dash camera that records every trip, front and rear, kept 30 days.';
const TEXT_200 = LONG.slice(0, 200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];
const fmt = (xs) => `median ${pct(xs, 0.5).toFixed(1)}ms, p90 ${pct(xs, 0.9).toFixed(1)}ms, max ${Math.max(...xs).toFixed(1)}ms over ${xs.length}`;
const isoDay = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

// In the page before the app: live listeners on the document and the window
// by event type (an item's menu listens on the document while it is open),
// and a timer that acts, then waits for the DOM to show the result.
const INIT = `
  (() => {
    const live = {};
    window.__listeners = live;
    for (const proto of [Document.prototype, Window.prototype]) {
      const add = proto.addEventListener;
      const remove = proto.removeEventListener;
      proto.addEventListener = function (type, fn, opts) { live[type] = (live[type] || 0) + 1; return add.call(this, type, fn, opts); };
      proto.removeEventListener = function (type, fn, opts) { live[type] = (live[type] || 0) - 1; return remove.call(this, type, fn, opts); };
    }
    window.__timed = async (act, done) => {
      const t0 = performance.now();
      act();
      await new Promise((r) => setTimeout(r, 0));
      for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => requestAnimationFrame(r));
      return done() ? performance.now() - t0 : -1;
    };
    window.__type = (el, value) => {
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
  })();
`;

export default {
  description: 'Compiled SPA: an eight-step quote on nested routes with a conditional step, dependent fields, nested field arrays, sync, schema, async and cross-field validation, a draft saved as you type, and a server-validated submit.',

  covers: [
    'form:wizard',
    'form:validation',
    'form:submit',
    'form:async-validation',
    'form:field-array',
    'form:draft-persist',
    'form:dependent-fields',
    'form:server-errors',
    'form:fast-typing',
    'route:conditional-step',
    'route:nested-layout',
    'route:history',
    'state:persisted',
  ],

  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    const base = `http://127.0.0.1:${appPort}`;
    const data = await import(pathToFileURL(join(workDir, 'src/data.js')).href);

    const buildLog = run('npm', ['run', 'build'], { cwd: workDir });
    reporter.assert(/built in/.test(buildLog), 'vite build produced a bundle', buildLog.trim().split('\n').pop());

    const server = startProcess(
      'npx',
      ['vite', 'preview', '--port', String(appPort), '--strictPort', '--host', '127.0.0.1'],
      { cwd: workDir, env: { ...process.env } },
    );
    await waitForHttp(`${base}/`, { child: server });

    const context = await browser.newContext();
    await context.addInitScript(INIT);
    try {
      await withPage(browser, `${base}/quote/about`, async (page, diag) => {
        await walk(page, { base, data, check, reporter, log });
        // A 422 from the quote endpoint is the server refusing a stolen VIN,
        // which the walk provokes on purpose; the browser logs the status.
        const errors = diag.errors.filter((e) => !/status of 422/.test(e));
        reporter.assert(errors.length === 0, 'no console errors or page errors through the quote', errors.slice(0, 3).join(' | '));
      }, { context });
    } finally {
      await context.close();
    }

    const fresh = await browser.newContext();
    await fresh.addInitScript(INIT);
    try {
      await withPage(browser, `${base}/quote/about`, async (page, diag) => {
        await deepLinks(page, { base, data, check });
        await timings(page, { base, data, check, log });
        // The quote sent without its photo is refused with a 422, on purpose.
        const errors = diag.errors.filter((e) => !/status of 422/.test(e));
        reporter.assert(errors.length === 0, 'no console errors on deep links', errors.slice(0, 3).join(' | '));
      }, { context: fresh });
    } finally {
      await fresh.close();
    }
  },
};

// --- Page helpers -------------------------------------------------------------

const errorOf = (page, name) => page.$eval(`[data-error="${name}"]`, (el) => el.textContent).catch(() => null);
const waitError = (page, name, expected, timeout = 3000) => page.waitForFunction(
  ([n, e]) => (document.querySelector(`[data-error="${n}"]`)?.textContent ?? null) === e,
  [name, expected],
  { timeout },
).then(() => true, () => false);
const stepShown = (page, id, timeout = 5000) => page.waitForSelector(`[data-step-form="${id}"]`, { timeout }).then(() => true, () => false);
const pathOf = (page) => new URL(page.url()).pathname;
const progressIds = (page) => page.$$eval('[data-progress] li', (els) => els.map((el) => el.dataset.step));
const progressText = (page) => page.$eval('[data-progress-text]', (el) => el.textContent);
const probes = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__wizard.probes)));
const listeners = (page, type) => page.evaluate((t) => window.__listeners[t] || 0, type);
const focusedName = (page) => page.evaluate(() => document.activeElement?.getAttribute('name') ?? document.activeElement?.tagName);
// Every field of the step as it shows: a checkbox or radio by its checkedness.
const fieldsOf = (page) => page.$$eval('[data-step-form] [name]', (els) => els
  .filter((el) => el.type !== 'file')
  .map((el) => `${el.name}${el.type === 'radio' ? `=${el.value}` : ''}:${el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value}`));
// Two frames. Firefox can drop a key pressed within a frame of a focused
// field's row moving (moveBefore), which a person, slower than Playwright,
// never presses.
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const rowIds = (page, kind) => page.$$eval(`[data-${kind}]`, (els, k) => els.map((el) => el.dataset[k]), kind);
const menuAction = async (page, row, action) => {
  await page.click(`${row} [data-menu-toggle]`);
  await page.click(`${row} [data-menu-action="${action}"]`);
};
const next = async (page, id) => {
  await page.click('[data-next]');
  return stepShown(page, id);
};

// Types `text` at Playwright's fastest into the field, then reads back what it
// holds and where the caret is.
async function typeFast(page, selector, text) {
  await page.fill(selector, '');
  await page.focus(selector);
  await page.keyboard.type(text);
  return page.$eval(selector, (el) => ({ value: el.value, caret: el.selectionStart }));
}

// --- The walk: every step, with what each one is responsible for ---------------

async function walk(page, { base, data, check, reporter, log }) {
  const { STEPS, REGIONS, STOLEN_VINS, TAKEN, stepsFor, emptyDraft } = data;
  const snapshots = {};
  const leave = async (id) => { snapshots[id] = await fieldsOf(page); };

  await stepShown(page, 'about');
  const firstIds = stepsFor(emptyDraft()).map((s) => s.id);
  check('form:wizard', JSON.stringify(await progressIds(page)) === JSON.stringify(firstIds) && (await progressText(page)) === `Step 1 of ${firstIds.length}`,
    'the progress indicator lists the steps that apply and marks the first', `${(await progressIds(page)).join(',')} / ${await progressText(page)}`);
  await page.evaluate(() => { document.querySelector('main.quote').__layoutMark = 'kept'; });

  // === About: errors on blur, on submit, then as typed; async out of order ===
  await page.fill('#f-phone', 'abc');
  const beforeBlur = await errorOf(page, 'phone');
  await page.press('#f-phone', 'Tab');
  const onBlur = await waitError(page, 'phone', 'Enter a phone number');
  check('form:validation', beforeBlur === '' && onBlur, 'a field validated on blur shows nothing while typed and its error once left', `before blur "${beforeBlur}"`);

  await page.click('[data-next]');
  await page.waitForFunction(() => document.querySelector('[data-error="firstName"]').textContent !== '', null, { timeout: 3000 }).catch(() => {});
  const submitErrors = await Promise.all(['firstName', 'lastName', 'email', 'birthDate'].map((n) => errorOf(page, n)));
  const blocked = pathOf(page) === '/quote/about' && submitErrors.every((e) => e && e.length > 0);
  check('form:wizard', blocked && (await focusedName(page)) === 'firstName', 'Next on an invalid step stays, shows every error and focuses the first field', `${pathOf(page)} errors=${JSON.stringify(submitErrors)} focus=${await focusedName(page)}`);

  await page.keyboard.type('A');
  check('form:validation', await waitError(page, 'firstName', ''), 'after a failed Next, an error clears as the field is typed, without leaving it', `firstName "${await errorOf(page, 'firstName')}"`);

  // The email check: a taken address answers in 600 ms, a free one in 40 ms.
  // Typing past the taken one must never show its answer for the free one.
  await page.evaluate(() => {
    const el = document.querySelector('[data-error="email"]');
    window.__emailErrors = [];
    new MutationObserver(() => window.__emailErrors.push([document.querySelector('#f-email').value, el.textContent]))
      .observe(el, { childList: true, characterData: true, subtree: true });
    const ind = document.querySelector('[data-validating]');
    window.__checking = [];
    new MutationObserver(() => window.__checking.push(ind.textContent)).observe(ind, { childList: true, characterData: true, subtree: true });
  });
  await page.focus('#f-email');
  await page.keyboard.type(TAKEN[0]);
  await page.keyboard.type('x');
  const stillChecking = await page.evaluate(() => document.querySelector('[data-validating]').textContent);
  await sleep(data.EMAIL_DELAY.taken + 300);
  const emailLog = await page.evaluate(() => window.__emailErrors);
  const stale = emailLog.filter(([value, text]) => value !== 'taken@harbor.test' && /already has/.test(text));
  check('form:async-validation', stale.length === 0 && (await errorOf(page, 'email')) === '' && stillChecking === 'Checking…',
    'a slow "taken" answer that lands after the free address was typed never shows, and Checking… holds until it lands',
    `stale=${JSON.stringify(stale)} final="${await errorOf(page, 'email')}" while in flight "${stillChecking}"`);
  await page.keyboard.press('Backspace');
  check('form:async-validation', await waitError(page, 'email', 'This email already has a Harbor policy. Sign in instead.', 2000),
    'the taken address itself gets its answer', `email "${await errorOf(page, 'email')}"`);

  // 200 characters at full speed into a field checked on every keystroke.
  const longEmail = `${'a'.repeat(188)}@harbor.test`;
  const typedEmail = await typeFast(page, '#f-email', longEmail);
  // An email input has no caret to read (selectionStart is null): the focus
  // staying in it is what is checked.
  check('form:fast-typing', typedEmail.value === longEmail && (await focusedName(page)) === 'email',
    '200 characters typed into a field validated per keystroke with a server check arrive exactly, and it keeps the focus',
    `length ${typedEmail.value.length}, focus ${await focusedName(page)}`);

  await page.fill('#f-firstName', 'Ada');
  await page.fill('#f-lastName', 'Byron');
  await page.fill('#f-email', 'ada@harbor.test');
  await page.fill('#f-phone', '+1 555 0100');
  await page.fill('#f-birthDate', '1990-04-12');
  await leave('about');
  const toAddress = await next(page, 'address');
  const layoutKept = await page.evaluate(() => document.querySelector('main.quote').__layoutMark === 'kept');
  check('route:nested-layout', toAddress && layoutKept, 'the quote layout stays the same element while the step under it changes', `address=${toAddress} kept=${layoutKept}`);

  // === Address: dependent state list (out of order), conditional fields ===
  await page.waitForSelector('[data-regions-for="US"]');
  await page.selectOption('#f-country', 'AU');
  await page.selectOption('#f-country', 'US');
  await page.selectOption('#f-country', 'CA');
  await sleep(data.REGION_DELAY.US + 250);
  const regionList = await page.$$eval('#f-region option', (o) => o.map((x) => x.value).filter(Boolean));
  const regionsFor = await page.$eval('#f-region', (el) => el.dataset.regionsFor);
  check('form:dependent-fields', regionsFor === 'CA' && JSON.stringify(regionList) === JSON.stringify(REGIONS.CA),
    'country changed to AU, US, CA quickly: the state list is Canada\'s although the United States answered last', `for=${regionsFor} first=${regionList.slice(0, 2).join(',')}`);

  await page.fill('#f-postal', 'ABC');
  const caFormat = await waitError(page, 'postal', 'Use the format A1A 1A1');
  await page.selectOption('#f-country', 'US');
  const usFormat = await waitError(page, 'postal', 'Use the format 5 digits');
  const regionCleared = await page.$eval('#f-region', (el) => el.value === '');
  await page.selectOption('#f-country', 'GB');
  const noRegion = await page.waitForSelector('[data-no-region]', { timeout: 2000 }).then(() => true, () => false) && !(await page.$('#f-region'));
  check('form:dependent-fields', caFormat && usFormat && regionCleared && noRegion,
    'the postal rule reads the country (its error follows a country change), the state clears, and the United Kingdom has no state field',
    `ca=${caFormat} us=${usFormat} cleared=${regionCleared} gb=${noRegion}`);

  await page.selectOption('#f-country', 'CA');
  await page.waitForSelector('[data-regions-for="CA"]');
  await page.selectOption('#f-region', 'Ontario');
  await page.fill('#f-postal', 'M5V 2T6');
  await page.fill('#f-city', 'Toronto');
  await page.check('[data-field="mailingDiffers"]');
  const shown = !!(await page.waitForSelector('#f-mailingStreet', { timeout: 2000 }).catch(() => null));
  await page.uncheck('[data-field="mailingDiffers"]');
  const hidden = await page.waitForSelector('#f-mailingStreet', { state: 'detached', timeout: 2000 }).then(() => true, () => false);
  await page.check('[data-field="mailingDiffers"]');
  await page.fill('#f-mailingStreet', '1 Front St');
  check('form:dependent-fields', shown && hidden, 'the mailing street shows only while its checkbox is checked', `shown=${shown} hidden=${hidden}`);
  await leave('address');
  await next(page, 'vehicles');

  // === Vehicles: a field array ==============================================
  const v0 = (await rowIds(page, 'vehicle'))[0];
  // A field of a field array item is named by the item's place
  // (`vehicles.0.vin`); the check finds it in the item's row.
  const vn = (id, f) => `[data-vehicle="${id}"] [name$=".${f}"]`;
  const placeIn = async (kind, id) => (await rowIds(page, kind)).indexOf(id);
  const fillVehicle = async (id, v) => {
    await page.fill(vn(id, 'year'), v.year);
    await page.selectOption(vn(id, 'make'), v.make);
    await page.fill(vn(id, 'model'), v.model);
    await page.fill(vn(id, 'vin'), v.vin);
    await page.fill(vn(id, 'miles'), v.miles);
    await page.check(`${vn(id, 'usage')}[data-usage="${v.usage}"]`);
  };
  await fillVehicle(v0, { year: '2019', make: 'Subaru', model: 'Outback', vin: 'BAD', miles: '12000', usage: 'commute' });
  const vinError = await waitError(page, `vehicles.${v0}.vin`, 'A VIN is 17 letters and digits, without I, O or Q');
  // A character typed in the middle that makes the VIN valid: the error goes
  // and the caret stays after the character.
  await page.fill(vn(v0, 'vin'), '4S4BSNC5K3123456');
  await waitError(page, `vehicles.${v0}.vin`, 'A VIN is 17 letters and digits, without I, O or Q');
  await page.evaluate((sel) => document.querySelector(sel).setSelectionRange(5, 5), vn(v0, 'vin'));
  await page.keyboard.type('A');
  const vinFixed = await waitError(page, `vehicles.${v0}.vin`, '');
  const vinCaret = await page.$eval(vn(v0, 'vin'), (el) => ({ value: el.value, caret: el.selectionStart, focused: el === document.activeElement }));
  check('form:fast-typing', vinFixed && vinCaret.value === '4S4BSANC5K3123456' && vinCaret.caret === 6 && vinCaret.focused,
    'a character typed mid-field that clears its error keeps the focus and the caret after it', JSON.stringify(vinCaret));

  const baseListeners = await listeners(page, 'pointerdown');
  await page.click('[data-add-vehicle]');
  const [, v1] = await rowIds(page, 'vehicle');
  const focusOnNew = (await focusedName(page)) === `vehicles.${await placeIn('vehicle', v1)}.year`;
  const otherErrors = await page.$$eval(`[data-vehicle="${v0}"] [data-error]`, (els) => els.map((e) => e.textContent).filter(Boolean));
  check('form:field-array', vinError && vinFixed && focusOnNew && otherErrors.length === 0,
    'an item\'s rules judge only it, and a new item\'s first field takes the focus', `vin=${vinError}/${vinFixed} focus=${await focusedName(page)} others=${otherErrors.length}`);

  await fillVehicle(v1, { year: '2021', make: 'Tesla', model: 'Model 3', vin: STOLEN_VINS[0], miles: '8000', usage: 'business' });
  const withBusiness = await progressIds(page);
  const textWith = await progressText(page);
  await page.check(`${vn(v1, 'usage')}[data-usage="commute"]`);
  const withoutBusiness = await progressIds(page);
  await page.check(`${vn(v1, 'usage')}[data-usage="business"]`);
  check('route:conditional-step', withBusiness.includes('business') && textWith === `Step 3 of ${STEPS.length}` && !withoutBusiness.includes('business') && (await progressIds(page)).includes('business'),
    'a vehicle used for business adds the Business step to the progress, and taking it back removes it', `${withBusiness.length} then ${withoutBusiness.length} steps, "${textWith}"`);

  await page.click('[data-add-vehicle]');
  const v2 = (await rowIds(page, 'vehicle'))[2];
  await fillVehicle(v2, { year: '2015', make: 'Honda', model: 'Civic', vin: '2HGFG12678H500001', miles: '9000', usage: 'pleasure' });

  // Move the third vehicle up twice from its model field, keyboard only.
  await page.$$eval('[data-vehicle]', (els) => { for (const el of els) el.__rowMark = el.dataset.vehicle; });
  await page.focus(vn(v2, 'model'));
  await page.evaluate((sel) => { const el = document.querySelector(sel); el.__fieldMark = true; el.setSelectionRange(3, 3); }, vn(v2, 'model'));
  const moves = [];
  for (const expected of [[v0, v2, v1], [v2, v0, v1]]) {
    await page.keyboard.press('Alt+ArrowUp');
    await frames(page);
    moves.push({
      order: (await rowIds(page, 'vehicle')).join(',') === expected.join(','),
      focus: await page.evaluate(() => document.activeElement.__fieldMark === true && document.activeElement.selectionStart === 3),
    });
  }
  const rowsKept = await page.$$eval('[data-vehicle]', (els) => els.every((el) => el.__rowMark === el.dataset.vehicle));
  await frames(page);
  await page.keyboard.type('ic'); // Civic -> Civicic at the caret: Civ|ic -> Civic|ic
  const afterTyping = await page.$eval(vn(v2, 'model'), (el) => el.value);
  check('form:field-array', moves.every((m) => m.order && m.focus) && rowsKept && afterTyping === 'Civicic',
    'Alt+ArrowUp twice moves the vehicle being edited up; each row keeps its element, the field keeps the focus and the caret', `${JSON.stringify(moves)} rowsKept=${rowsKept} typed="${afterTyping}"`);
  await page.fill(vn(v2, 'model'), 'Civic');

  // Duplicate, then remove the copy from its own menu, with the menu open.
  await menuAction(page, `[data-vehicle="${v0}"]`, 'duplicate');
  const afterDup = await rowIds(page, 'vehicle');
  const copy = afterDup[afterDup.indexOf(v0) + 1];
  const copied = await page.$eval(vn(copy, 'model'), (el) => el.value) === 'Outback';
  const p0 = await probes(page);
  await page.click(`[data-vehicle="${copy}"] [data-menu-toggle]`);
  const openListeners = await listeners(page, 'pointerdown');
  await page.click(`[data-vehicle="${copy}"] [data-menu-action="remove"]`);
  const p1 = await probes(page);
  check('form:field-array', copied && openListeners === baseListeners + 1 && (await listeners(page, 'pointerdown')) === baseListeners && p1.disposed.vehicle - p0.disposed.vehicle === 1,
    'a duplicated item carries its values; removing it from its open menu disposes it and its menu\'s document listener',
    `copied=${copied} listeners ${baseListeners}/${openListeners}/${await listeners(page, 'pointerdown')} disposed +${p1.disposed.vehicle - p0.disposed.vehicle}`);

  // Ten more added and removed from their open menus: nothing accumulates.
  const c0 = await probes(page);
  for (let i = 0; i < 10; i++) {
    await page.click('[data-add-vehicle]');
    const added = (await rowIds(page, 'vehicle')).at(-1);
    await page.fill(vn(added, 'model'), `Churn ${i}`);
    await menuAction(page, `[data-vehicle="${added}"]`, 'remove');
  }
  const c1 = await probes(page);
  const live = (await rowIds(page, 'vehicle')).length;
  check('form:field-array', c1.created.vehicle - c0.created.vehicle === 10 && c1.disposed.vehicle - c0.disposed.vehicle === 10
    && c1.created.vehicle - c1.disposed.vehicle === live && (await listeners(page, 'pointerdown')) === baseListeners,
    'ten items added, typed in and removed from their open menus: ten built, ten disposed, no document listener left',
    `built +${c1.created.vehicle - c0.created.vehicle}, disposed +${c1.disposed.vehicle - c0.disposed.vehicle}, live ${c1.created.vehicle - c1.disposed.vehicle}/${live} rows, pointerdown listeners ${await listeners(page, 'pointerdown')}/${baseListeners}`);

  // The draft is the form's values (values.vehicles), so a removed item's
  // values must have left the form: the saved draft lists the rows shown.
  await sleep(400);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('harbor:quote')).vehicles.map((v) => v.id));
  const shownRows = await rowIds(page, 'vehicle');
  check('form:field-array', saved.join(',') === shownRows.join(','),
    'the saved draft, built from the form\'s values, holds exactly the vehicles shown: a removed item\'s values left the form', `saved ${saved.join(',')} shown ${shownRows.join(',')}`);

  // An empty item with errors, then removed: its errors go with it, and its
  // bindings never run again.
  await page.click('[data-add-vehicle]');
  const doomed = (await rowIds(page, 'vehicle')).at(-1);
  await page.click('[data-next]');
  await waitError(page, `vehicles.${doomed}.vin`, 'A VIN is 17 letters and digits, without I, O or Q');
  const problemsBefore = await page.$eval('[data-step-problems]', (el) => el.textContent);
  await menuAction(page, `[data-vehicle="${doomed}"]`, 'remove');
  const problemsAfter = await page.$eval('[data-step-problems]', (el) => el.textContent);
  const runsAfterRemove = (await probes(page)).bindingRuns[doomed] || 0;
  await page.fill(vn(v0, 'vin'), 'X');
  await page.fill(vn(v0, 'vin'), '4S4BSANC5K3123456');
  await page.click('[data-next]').catch(() => {});
  await stepShown(page, 'drivers');
  const runsLater = (await probes(page)).bindingRuns[doomed] || 0;
  check('form:field-array', /things to fix/.test(problemsBefore) && problemsAfter === '' && runsLater === runsAfterRemove,
    'removing an item with errors takes its errors off the step, and its bindings never run again', `"${problemsBefore}" -> "${problemsAfter}", runs ${runsAfterRemove} -> ${runsLater}`);

  // === Drivers: an array of items, each with an array =========================
  const dn = (id, f) => `[data-driver="${id}"] > .grid [name$=".${f}"]`;
  const inc = (_d, i, f) => `[data-incident="${i}"] [name$=".${f}"]`;
  const d0 = (await rowIds(page, 'driver'))[0];
  await page.fill(dn(d0, 'name'), 'Ada Byron');
  await page.fill(dn(d0, 'license'), 'AB123456');
  await page.fill(dn(d0, 'since'), '2010-06-01');
  await page.click(`[data-driver="${d0}"] [data-add-incident]`);
  const i0 = (await rowIds(page, 'incident'))[0];
  const incidentFocused = (await focusedName(page)) === `drivers.${await placeIn('driver', d0)}.incidents.0.date`;
  await page.fill(inc(d0, i0, 'date'), '2009-01-15');
  await page.click('[data-step-form] h2'); // leave the field (Tab moves between a date's parts)
  const tooEarly = await waitError(page, `drivers.${d0}.incidents.${i0}.date`, 'Before this driver was licensed');
  await page.fill(dn(d0, 'since'), '2008-05-01');
  const rejudged = await waitError(page, `drivers.${d0}.incidents.${i0}.date`, '');
  check('form:dependent-fields', incidentFocused && tooEarly && rejudged,
    'an incident dated before its driver was licensed is refused, and moving the licence date earlier clears it', `focus=${incidentFocused} refused=${tooEarly} cleared=${rejudged}`);

  await page.fill(inc(d0, i0, 'detail'), '');
  const detail = await typeFast(page, inc(d0, i0, 'detail'), TEXT_200);
  await page.click(`[data-driver="${d0}"] [data-add-incident]`);
  const i1 = (await rowIds(page, 'incident'))[1];
  await page.fill(inc(d0, i1, 'date'), '2015-03-02');
  await page.selectOption(inc(d0, i1, 'kind'), 'Speeding');

  // A second driver, its licence half typed, moved up: the field keeps the
  // focus and is not left, so its blur rule does not judge the half.
  await page.click('[data-add-driver]');
  const d1 = (await rowIds(page, 'driver'))[1];
  await page.fill(dn(d1, 'name'), 'Byron King');
  await page.focus(dn(d1, 'license'));
  await page.keyboard.type('BK');
  await page.keyboard.press('Alt+ArrowUp');
  const movedDriver = (await rowIds(page, 'driver')).join(',') === [d1, d0].join(',');
  // The field's name follows the driver to its new place.
  const stillFocused = (await focusedName(page)) === `drivers.${await placeIn('driver', d1)}.license`;
  await sleep(50);
  const noBlurError = (await errorOf(page, `drivers.${d1}.license`)) === '';
  await frames(page);
  await page.keyboard.type('778899');
  check('form:field-array', movedDriver && stillFocused && noBlurError && detail.value === TEXT_200,
    'a driver moved while its licence is typed keeps the focus and is not judged as left (blur rules)',
    `moved=${movedDriver} focus=${await focusedName(page)} error="${await errorOf(page, `drivers.${d1}.license`)}"`);
  await page.fill(dn(d1, 'since'), '2012-01-01');

  // A third driver with two incidents, removed whole.
  await page.click('[data-add-driver]');
  const d2 = (await rowIds(page, 'driver'))[2];
  await page.click(`[data-driver="${d2}"] [data-add-incident]`);
  await page.click(`[data-driver="${d2}"] [data-add-incident]`);
  const q0 = await probes(page);
  await menuAction(page, `[data-driver="${d2}"]`, 'remove');
  const q1 = await probes(page);
  check('form:field-array', q1.disposed.driver - q0.disposed.driver === 1 && q1.disposed.incident - q0.disposed.incident === 2 && q1.effectsLive === q0.effectsLive - 3,
    'removing a driver disposes it and both its incidents', `drivers -${q1.disposed.driver - q0.disposed.driver}, incidents -${q1.disposed.incident - q0.disposed.incident}, live ${q0.effectsLive} -> ${q1.effectsLive}`);

  check('form:fast-typing', detail.value === TEXT_200 && detail.caret === 200,
    '200 characters typed into a nested item\'s textarea arrive exactly, caret at the end', `length ${detail.value.length}, caret ${detail.caret}`);

  // Reload in the middle of the step, inside the save's debounce window.
  await page.focus(dn(d1, 'name'));
  await page.keyboard.press('End');
  await page.keyboard.type(' Jr');
  const beforeReload = await fieldsOf(page);
  await page.reload();
  await stepShown(page, 'drivers');
  const afterReload = await fieldsOf(page);
  check('form:draft-persist', pathOf(page) === '/quote/drivers' && JSON.stringify(afterReload) === JSON.stringify(beforeReload),
    'a reload in the middle of a step, right after typing, comes back to the step with every field, nested arrays and their order intact',
    `${afterReload.length}/${beforeReload.length} fields, first difference ${afterReload.find((f, i) => f !== beforeReload[i]) ?? 'none'}`);
  check('state:persisted', JSON.stringify(afterReload) === JSON.stringify(beforeReload), 'the draft survives a full reload (localStorage)', `${afterReload.length} fields`);
  await leave('drivers');

  // Back to the vehicles after the reload: the array as it was left.
  await page.goBack();
  await stepShown(page, 'vehicles');
  const vehiclesBack = await rowIds(page, 'vehicle');
  const radioBack = await page.$eval(`${vn(v1, 'usage')}[data-usage="business"]`, (el) => el.checked);
  check('form:draft-persist', vehiclesBack.join(',') === [v2, v0, v1].join(',') && radioBack,
    'after the reload the vehicles keep their order and their radio choices', `${vehiclesBack.join(',')} business=${radioBack}`);
  await leave('vehicles');
  await next(page, 'drivers');
  await next(page, 'business');

  // === Business (added by the business vehicle): errors on submit only ===
  await page.fill('#f-ein', '12');
  const quiet = (await errorOf(page, 'ein')) === '';
  await page.click('[data-next]');
  const shownOnSubmit = await waitError(page, 'company', 'Enter the company name') && await waitError(page, 'ein', 'An EIN looks like 12-3456789');
  await page.fill('#f-company', 'Byron Analytics');
  const clearedAsTyped = await waitError(page, 'company', '');
  await page.fill('#f-ein', '12-3456789');
  await page.fill('#f-fleet', '3');
  check('form:validation', quiet && shownOnSubmit && clearedAsTyped, 'a step validated on submit shows nothing while typed, every error on Next, then follows typing', `quiet=${quiet} submit=${shownOnSubmit} cleared=${clearedAsTyped}`);
  await leave('business');
  await next(page, 'coverage');

  // === Coverage: a schema with a cross-field rule ===========================
  const start = isoDay(30);
  await page.fill('#f-start', start);
  await page.fill('#f-end', isoDay(20));
  const endBefore = await waitError(page, 'end', 'The end date must be after the start date');
  await page.fill('#f-start', isoDay(10));
  const endFixed = await waitError(page, 'end', '');
  await page.fill('#f-end', isoDay(10 + 400));
  const tooLong = await waitError(page, 'end', 'A policy lasts at most a year');
  await page.fill('#f-end', isoDay(10 + 180));
  // Start from the current policy (reset() with fetched values): no change
  // counted until the visitor makes one.
  await page.click('[data-load-policy]');
  const loaded = await page.waitForFunction(() => document.querySelector('[data-policy-changes]').textContent !== '', null, { timeout: 3000 }).then(() => true, () => false);
  const policyShown = {
    changes: await page.$eval('[data-policy-changes]', (el) => el.textContent),
    limit: await page.$eval('[data-limit="250/500"]', (el) => el.checked),
    deductible: await page.$eval('#f-deductible', (el) => el.value),
    end: await page.$eval('#f-end', (el) => el.value),
  };
  await page.selectOption('#f-deductible', '500');
  const oneChange = await page.$eval('[data-policy-changes]', (el) => el.textContent);
  await page.selectOption('#f-deductible', '1000');
  const backToNone = await page.$eval('[data-policy-changes]', (el) => el.textContent);
  check('form:dependent-fields', loaded && policyShown.changes === '0 changes from your current policy' && policyShown.limit && policyShown.deductible === '1000'
    && policyShown.end === isoDay(10 + 180) && oneChange === '1 change from your current policy' && backToNone === '0 changes from your current policy',
    'values loaded with reset() show in their fields and become what changes are counted from', `${JSON.stringify(policyShown)} then "${oneChange}", "${backToNone}"`);
  const addons = await page.$eval('[data-addon-count]', (el) => el.textContent);
  check('form:dependent-fields', endBefore && endFixed && tooLong && addons === '2 add-ons',
    'the end date is judged against the start date: an earlier end is refused, moving the start fixes it, over a year is refused', `before=${endBefore} fixed=${endFixed} year=${tooLong} addons="${addons}"`);
  await leave('coverage');
  await next(page, 'documents');

  // === Documents: a file, and notes typed at full speed ======================
  await page.click('[data-next]');
  const needFile = await waitError(page, 'license', 'Attach a photo of your license');
  await page.setInputFiles('#f-license', { name: 'license.png', mimeType: 'image/png', buffer: Buffer.alloc(3000, 7) });
  const fileCleared = await waitError(page, 'license', '');
  const chosen = await page.$eval('[data-license-chosen]', (el) => el.textContent);
  const notes = await typeFast(page, '#f-notes', TEXT_200);
  const counter = await page.$eval('[data-notes-count]', (el) => el.textContent);
  check('form:validation', needFile && fileCleared && chosen === 'license.png (2.9 KB)', 'a required file input is refused empty and takes the file chosen', `need=${needFile} cleared=${fileCleared} chosen="${chosen}"`);
  check('form:fast-typing', notes.value === TEXT_200 && notes.caret === 200 && counter === '200 / 500',
    '200 characters typed into notes with a live count arrive exactly', `length ${notes.value.length}, caret ${notes.caret}, count "${counter}"`);
  await page.focus('#f-notes');
  await page.evaluate(() => document.querySelector('#f-notes').setSelectionRange(10, 10));
  await page.keyboard.type('XYZ');
  const inserted = await page.$eval('#f-notes', (el) => ({ value: el.value, caret: el.selectionStart }));
  check('form:fast-typing', inserted.value === `${TEXT_200.slice(0, 10)}XYZ${TEXT_200.slice(10)}` && inserted.caret === 13,
    'text typed in the middle lands at the caret, which stays after it', `caret ${inserted.caret}, "${inserted.value.slice(5, 18)}"`);
  await page.fill('#f-notes', 'Garage kept.');
  await leave('documents');
  await next(page, 'review');

  // === Back and forward through every step =====================================
  const order = ['about', 'address', 'vehicles', 'drivers', 'business', 'coverage', 'documents'];
  const walked = [];
  const compare = async (id) => {
    if (!(await stepShown(page, id))) return `${id}:MISSING(${pathOf(page)})`;
    if (id === 'review') return `${id}:ok`;
    // After the reload in Drivers the state list is fetched again: the
    // address shows its state once the list has landed.
    if (id === 'address') await page.waitForSelector('[data-regions-for="CA"]', { timeout: 3000 }).catch(() => {});
    const now = await fieldsOf(page);
    const diff = now.findIndex((f, i) => f !== snapshots[id][i]);
    return diff === -1 && now.length === snapshots[id].length ? `${id}:ok` : `${id}:DIFF(${now[diff]} was ${snapshots[id][diff]})`;
  };
  for (const id of [...order].reverse()) {
    await page.goBack();
    walked.push(await compare(id));
  }
  for (const id of [...order.slice(1), 'review']) {
    await page.goForward();
    walked.push(await compare(id));
  }
  check('route:history', walked.every((w) => w.endsWith(':ok')), 'back through all seven steps and forward again: each shows exactly what was left in it', walked.join(' '));

  // === Submit: the server refuses the stolen VIN, then accepts ==================
  const reviewVehicles = await page.$eval('[data-review="vehicles"]', (el) => el.textContent);
  await page.click('[data-submit]');
  const backToVehicles = await stepShown(page, 'vehicles');
  const stolenShown = await waitError(page, `vehicles.${v1}.vin`, 'This VIN is reported stolen');
  const stolenFocused = (await focusedName(page)) === `vehicles.${await placeIn('vehicle', v1)}.vin`;
  check('form:server-errors', backToVehicles && stolenShown && stolenFocused,
    'the server\'s "reported stolen" is shown on that vehicle\'s VIN, on the vehicles step, which the visitor is taken to with the field focused',
    `path=${pathOf(page)} shown=${stolenShown} focus=${await focusedName(page)}`);
  await page.fill(vn(v1, 'vin'), '5YJ3E1EA7MF000001');
  const cleared = await waitError(page, `vehicles.${v1}.vin`, '');
  for (const id of ['drivers', 'business', 'coverage', 'documents', 'review']) await next(page, id);
  // A double click sends the quote once: the button is disabled while the
  // action is pending.
  await page.dblclick('[data-submit]');
  const done = await page.waitForSelector('[data-done]', { timeout: 5000 }).then(() => true, () => false);
  const bytes = done ? await page.$eval('[data-license-bytes]', (el) => el.textContent) : '';
  const quoteId = done ? await page.$eval('[data-quote-id]', (el) => el.textContent) : '';
  await sleep(300);
  const stats = await (await fetch(`${base}/api/stats`)).json();
  check('form:submit', done && cleared && /^HQ-\d+$/.test(quoteId) && bytes === '3000' && reviewVehicles.includes('Civic') && stats.quotes.length === 2,
    'fixed and sent again with a double click, the quote is accepted once: the server got the answers and the 3,000-byte license photo',
    `quote=${quoteId} bytes=${bytes} posts=${stats.quotes.map((q) => (q.ok ? 'ok' : 'refused')).join(',')}`);
  const draftLeft = await page.evaluate(() => localStorage.getItem('harbor:quote'));
  reporter.assert(draftLeft === null, 'an accepted quote clears its draft', `left: ${String(draftLeft).slice(0, 40)}`);

  const steps = await probes(page);
  check('form:wizard', steps.created.step - steps.disposed.step === 0,
    'every step page built was disposed when left (none is on screen after the quote)', `built ${steps.created.step}, disposed ${steps.disposed.step}`);
}

// --- Timings: a keystroke in an array item, and a step change -----------------

async function timings(page, { base, data, check, log }) {
  const seed = data.emptyDraft();
  seed.about = { firstName: 'Ada', lastName: 'Byron', email: 'ada@harbor.test', phone: '+1 555 0100', birthDate: '1990-04-12' };
  seed.vehicles = [{ id: 'v0', year: '2019', make: 'Subaru', model: 'Outback', vin: '4S4BSANC5K3123456', usage: 'commute', miles: '12000' },
    { id: 'v1', year: '2021', make: 'Tesla', model: 'Model 3', vin: '5YJ3E1EA7MF000001', usage: 'pleasure', miles: '8000' }];
  seed.drivers = [{ id: 'd0', name: 'Ada Byron', license: 'AB123456', since: '2010-06-01', incidents: [{ id: 'i0', date: '2015-03-02', kind: 'Speeding', detail: '' }] }];
  seed.done = { about: true, address: true, vehicles: true, drivers: true };
  await page.evaluate((d) => localStorage.setItem('harbor:quote', JSON.stringify(d)), seed);
  await page.goto(`${base}/quote/vehicles`);
  await stepShown(page, 'vehicles');

  const perKey = await page.evaluate(async () => {
    const el = document.querySelector('[data-vehicle="v1"] [name="vehicles.1.vin"]');
    const err = document.querySelector('[data-error="vehicles.v1.vin"]');
    const times = [];
    for (let i = 0; i < 40; i++) {
      const valid = i % 2 === 1;
      times.push(await window.__timed(() => window.__type(el, valid ? '5YJ3E1EA7MF000001' : '5YJ3E1EA7MF00000'), () => (err.textContent === '') === valid));
    }
    return times;
  });
  // The 90th percentile, so one pause of a shared machine does not fail it.
  check('form:wizard', perKey.every((t) => t >= 0) && pct(perKey, 0.9) < BUDGET.keystroke,
    `a keystroke in a vehicle's VIN shows its validation within ${BUDGET.keystroke} ms (90th percentile)`, fmt(perKey));

  const changes = await page.evaluate(async () => {
    const times = [];
    for (let i = 0; i < 10; i++) {
      const forward = i % 2 === 0;
      const button = document.querySelector(forward ? '[data-next]' : '[data-back]');
      const target = forward ? 'drivers' : 'vehicles';
      times.push(await window.__timed(() => button.click(), () => !!document.querySelector(`[data-step-form="${target}"]`)));
    }
    return times;
  });
  check('form:wizard', changes.every((t) => t >= 0) && pct(changes, 0.9) < BUDGET.stepChange,
    `Next (a whole-step validation) and Back each show the other step within ${BUDGET.stepChange} ms (90th percentile)`, fmt(changes));
  log(`keystroke ${fmt(perKey)}; step change ${fmt(changes)}`);
}

// --- Deep links ------------------------------------------------------------------

async function deepLinks(page, { base, data, check }) {
  const { emptyDraft } = data;
  const go = async (path) => {
    await page.goto(`${base}${path}`);
    await page.waitForSelector('[data-step-form]');
    return pathOf(page);
  };
  const empty = await go('/quote/coverage');
  const seed = emptyDraft();
  seed.about = { firstName: 'Ada', lastName: 'Byron', email: 'ada@harbor.test', phone: '+1 555 0100', birthDate: '1990-04-12' };
  seed.done = { about: true, address: true, vehicles: true, drivers: true };
  await page.evaluate((d) => localStorage.setItem('harbor:quote', JSON.stringify(d)), seed);
  const skipped = await go('/quote/business');
  const open = await go('/quote');
  const ahead = await go('/quote/review');
  const kept = await go('/quote/address');
  seed.vehicles[0].usage = 'business';
  seed.done = { ...seed.done, coverage: true, documents: true };
  await page.evaluate((d) => localStorage.setItem('harbor:quote', JSON.stringify(d)), seed);
  const added = await go('/quote/review');
  const name = await go('/quote/about').then(() => page.$eval('#f-firstName', (el) => el.value));

  // A reload loses the chosen file (a browser rule): sent from Review, the
  // server's error on it lands on the Documents step's file input.
  const complete = emptyDraft();
  complete.about = seed.about;
  complete.address = { country: 'US', region: 'Maine', city: 'Portland', postal: '04101', mailingDiffers: false, mailingStreet: '' };
  complete.vehicles = [{ id: 'v0', year: '2019', make: 'Subaru', model: 'Outback', vin: '4S4BSANC5K3123456', usage: 'commute', miles: '12000' }];
  complete.drivers = [{ id: 'd0', name: 'Ada Byron', license: 'AB123456', since: '2010-06-01', incidents: [] }];
  complete.coverage = { ...complete.coverage, start: isoDay(5), end: isoDay(100) };
  complete.done = { about: true, address: true, vehicles: true, drivers: true, coverage: true, documents: true };
  await page.evaluate((d) => localStorage.setItem('harbor:quote', JSON.stringify(d)), complete);
  await go('/quote/review');
  await page.click('[data-submit]');
  const toDocuments = await stepShown(page, 'documents');
  const fileError = await waitError(page, 'license', 'Attach a photo of your license');
  const fileFocused = (await focusedName(page)) === 'license';
  check('form:server-errors', toDocuments && fileError && fileFocused,
    'after a reload, a quote sent without its photo comes back from the server as an error on the Documents step\'s file input, focused',
    `path=${pathOf(page)} error=${fileError} focus=${await focusedName(page)}`);
  check('route:conditional-step',
    empty === '/quote/about' && skipped === '/quote/coverage' && open === '/quote/coverage' && ahead === '/quote/coverage' && kept === '/quote/address' && added === '/quote/business' && name === 'Ada',
    'deep links: a step goes there when the steps before it are done, a skipped step sends on to the next, an added step not done is where review sends you back to',
    `empty->${empty} business(skipped)->${skipped} /quote->${open} review->${ahead} address->${kept} review(business added)->${added}`);
}
