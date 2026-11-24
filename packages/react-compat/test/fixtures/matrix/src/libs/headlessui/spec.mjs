export default {
  packages: ['@headlessui/react'],
  exercised: 'Menu (anchored portal, keyboard focus, item click closes), Switch, Listbox (keyboard pick), Combobox (type to filter, pick), Dialog (portal, focus trap, Escape), Disclosure, Tabs with arrow keys',
  async run(t) {
    await t.step('the menu opens with ARIA and an item click runs and closes', async () => {
      await t.click('#hm-button');
      await t.attr('#hm-items', 'role', 'menu');
      await t.attr('#hm-button', 'aria-expanded', 'true');
      await t.count('#hm-items [role="menuitem"]', 2);
      await t.press('ArrowDown');
      await t.eval(() => document.querySelector('#hm-items [data-focus]')?.textContent ?? null, 'Edit');
      await t.page.getByRole('menuitem', { name: 'Delete' }).click();
      await t.text('#hm-picked', 'delete');
      await t.gone('#hm-items');
    });
    await t.step('the switch toggles', async () => {
      await t.attr('#hs-switch', 'aria-checked', 'false');
      await t.click('#hs-switch');
      await t.attr('#hs-switch', 'aria-checked', 'true');
      await t.text('#hs-switch', 'on');
    });
    await t.step('the listbox picks with the keyboard', async () => {
      await t.click('#hl-button');
      await t.attr('#hl-options', 'role', 'listbox');
      await t.count('#hl-options [role="option"]', 4);
      await t.press('ArrowDown');
      await t.press('Enter');
      await t.text('#hl-value', 'Grace');
      await t.gone('#hl-options');
      await t.text('#hl-button', 'Grace');
    });
    await t.step('the combobox filters as you type and picks', async () => {
      await t.click('#hc-input');
      await t.type('#hc-input', 'ar');
      await t.count('#hc-options [role="option"]', 1);
      await t.value('#hc-input', 'ar');
      await t.page.getByRole('option', { name: 'Margaret' }).click();
      await t.text('#hc-value', 'Margaret');
      await t.value('#hc-input', 'Margaret');
    });
    await t.step('the dialog opens in a portal, traps focus, closes on Escape', async () => {
      await t.click('#hd-open');
      await t.present('#hd-panel');
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('#hd-panel')), true, 'the dialog is outside the app root');
      await t.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement), true, 'focus is inside the dialog');
      await t.type('#hd-input', 'abc');
      await t.value('#hd-input', 'abc');
      await t.press('Escape');
      await t.gone('#hd-panel');
      await t.focus('hd-open');
    });
    await t.step('the disclosure opens', async () => {
      await t.gone('#hx-panel');
      await t.click('#hx-button');
      await t.text('#hx-panel', 'Hidden details');
      await t.attr('#hx-button', 'aria-expanded', 'true');
    });
    await t.step('tabs switch with the arrow key', async () => {
      await t.attr('#ht-1', 'aria-selected', 'true');
      await t.click('#ht-1');
      await t.press('ArrowRight');
      await t.attr('#ht-2', 'aria-selected', 'true');
      await t.text('#ht-panel-2', 'second panel');
    });
  },
};
