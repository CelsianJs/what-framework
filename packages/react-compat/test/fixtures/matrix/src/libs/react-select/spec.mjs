export default {
  packages: ['react-select'],
  exercised: 'a single Select (class component, Emotion styles): the menu in a portal, type to filter, Enter picks, keyboard open and arrows, clear, a ref to the instance (`focus()`), the menu closing on blur with `onMenuOpen` and `onMenuClose`, an `onKeyDown` that prevents the default; a multi Select with removable values (the one that stays keeps its element) and Backspace; an async Select loading options as you type',
  async run(t) {
    await t.step('Emotion styles the control', async () => {
      await t.style('.rs__control', 'display', 'flex');
      await t.eval(() => document.querySelector('.rs__placeholder')?.textContent, 'Select...');
    });
    await t.step('the menu opens in a portal; typing filters; Enter picks', async () => {
      await t.click('.rs__control');
      await t.count('.rs__option', 3);
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('.rs__menu')), true, 'the menu is in a portal');
      await t.type('#rs-input', 'va');
      await t.count('.rs__option', 1);
      await t.value('#rs-input', 'va');
      await t.press('Enter');
      await t.text('#rs-one', 'vanilla');
      await t.text('.rs__single-value', 'Vanilla');
      await t.gone('.rs__menu');
      await t.focus('rs-input');
    });
    await t.step('keyboard: arrow opens and moves, Enter picks', async () => {
      await t.press('ArrowDown');
      await t.count('.rs__option', 3);
      await t.eval(() => document.querySelector('.rs__option--is-focused')?.textContent, 'Vanilla');
      await t.press('ArrowUp');
      await t.eval(() => document.querySelector('.rs__option--is-focused')?.textContent, 'Strawberry');
      await t.press('Enter');
      await t.text('#rs-one', 'strawberry');
    });
    await t.step('clear', async () => {
      await t.click('.rs__clear-indicator');
      await t.text('#rs-one', 'none');
      await t.press('Escape');
    });
    await t.step('multi: pick two, remove one by its button, one by Backspace', async () => {
      await t.click('.rsm__control');
      await t.page.locator('.rsm__option', { hasText: 'Chocolate' }).click();
      await t.click('.rsm__control');
      await t.page.locator('.rsm__option', { hasText: 'Vanilla' }).click();
      await t.text('#rs-many', 'chocolate,vanilla');
      await t.count('.rsm__multi-value', 2);
      await t.page.evaluate(() => { window.__values = [...document.querySelectorAll('.rsm__multi-value')]; });
      await t.page.locator('.rsm__multi-value__remove').first().click();
      await t.text('#rs-many', 'vanilla');
      await t.eval(() => document.querySelector('.rsm__multi-value') === window.__values[1], true, 'the value that stays is the element it was');
      await t.page.focus('#rsm-input');
      await t.press('Backspace');
      await t.text('#rs-many', 'none');
      await t.press('Escape');
    });
    await t.step('async options load as you type', async () => {
      await t.click('.rsa__control');
      await t.type('#rsa-input', 'straw');
      await t.until(() => t.page.evaluate(() => [...document.querySelectorAll('.rsa__option')].map((o) => o.textContent).join(',')), (v) => v === 'Strawberry', 'the loaded option');
      await t.press('Enter');
      await t.text('#rs-remote', 'strawberry');
    });
    await t.step('a ref focuses the select; leaving it closes the menu', async () => {
      await t.click('#rs-focus');
      await t.focus('rs-input');
      await t.press('ArrowDown');
      await t.count('.rs__option', 3);
      const before = await t.page.evaluate(() => document.querySelector('#rs-log').textContent);
      if (!before.endsWith('open')) throw new Error(`onMenuOpen was not the last callback: ${before}`);
      // A press on empty page, away from the menu (which covers what is under the select).
      await t.page.mouse.click(700, 600);
      await t.gone('.rs__menu');
      await t.text('#rs-log', `${before},close`);
    });
    await t.step('a key handler that prevents the default keeps the select from handling the key', async () => {
      await t.click('#rs-lock');
      await t.attr('#rs-lock', 'aria-pressed', 'true');
      await t.click('#rs-focus');
      await t.press('ArrowDown');
      await t.count('.rs__option', 3);
      await t.press('Enter');
      await t.sleep(150);
      await t.text('#rs-one', 'none');
      await t.count('.rs__option', 3);
      await t.press('Escape');
      await t.gone('.rs__menu');
      await t.click('#rs-lock');
      await t.attr('#rs-lock', 'aria-pressed', 'false');
      await t.click('#rs-focus');
      await t.press('ArrowDown');
      await t.count('.rs__option', 3);
      await t.press('Enter');
      await t.text('#rs-one', 'chocolate');
    });
  },
};
