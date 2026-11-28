export default {
  packages: ['react-aria-components'],
  exercised: 'Button `onPress`, a controlled TextField, Select (collection built from JSX, popover, keyboard pick), ComboBox (type to filter, pick), modal Dialog (portal, autoFocus, focus containment, Escape), Checkbox, Switch, Tabs with arrow keys',
  async run(t) {
    await t.step('press events', async () => {
      await t.click('#ra-btn');
      await t.click('#ra-btn');
      await t.text('#ra-btn', 'Pressed 2');
      await t.page.focus('#ra-btn');
      await t.press('Enter');
      await t.text('#ra-btn', 'Pressed 3');
    });
    await t.step('a controlled TextField with its label wired', async () => {
      await t.click('#ra-input');
      await t.type('#ra-input', 'grace');
      await t.value('#ra-input', 'grace');
      await t.text('#ra-echo', 'grace');
      await t.eval(() => { const i = document.querySelector('#ra-input'); return document.getElementById(i.getAttribute('aria-labelledby'))?.textContent; }, 'Name');
    });
    await t.step('Select shows its value, opens, and picks with the keyboard', async () => {
      await t.text('#ra-select', /Cat/);
      await t.click('#ra-select');
      await t.count('[role="listbox"] [role="option"]', 3);
      await t.press('ArrowDown');
      await t.press('Enter');
      await t.text('#ra-animal', 'dog');
      await t.gone('[role="listbox"]');
      await t.text('#ra-select', /Dog/);
    });
    await t.step('ComboBox filters as you type and picks', async () => {
      await t.click('#ra-combo');
      await t.type('#ra-combo', 'ap');
      await t.count('[role="listbox"] [role="option"]', 2);
      await t.page.getByRole('option', { name: 'Apricot' }).click();
      await t.text('#ra-fruit', 'apricot');
      await t.value('#ra-combo', 'Apricot');
    });
    await t.step('a modal Dialog opens in a portal, focuses, and closes on Escape', async () => {
      await t.click('#ra-open');
      await t.attr('#ra-dialog', 'role', 'dialog');
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('#ra-dialog')), true, 'the dialog is in a portal');
      await t.focus('ra-email');
      await t.type('#ra-email', 'a@b.c');
      await t.value('#ra-email', 'a@b.c');
      for (let i = 0; i < 4; i++) await t.press('Tab');
      await t.eval(() => document.querySelector('#ra-dialog').contains(document.activeElement), true, 'focus is contained');
      await t.press('Escape');
      await t.gone('#ra-dialog');
      await t.focus('ra-open');
    });
    await t.step('Checkbox and Switch', async () => {
      await t.click('text=Agree');
      await t.text('#ra-agree', 'true');
      await t.click('text=Wifi');
      await t.text('#ra-on', 'true');
      await t.attr('label:has(#ra-switch)', 'data-selected', 'true');
    });
    await t.step('Tabs with the arrow key', async () => {
      await t.text('#ra-panel', 'panel one');
      await t.page.getByRole('tab', { name: 'One' }).click();
      await t.press('ArrowRight');
      await t.text('#ra-panel', 'panel two');
      await t.eval(() => document.querySelector('[role="tab"][aria-selected="true"]').textContent, 'Two');
    });
  },
};
