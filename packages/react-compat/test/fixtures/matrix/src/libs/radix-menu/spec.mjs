export default {
  packages: ['@radix-ui/react-dropdown-menu', '@radix-ui/react-select', '@radix-ui/react-tabs'],
  exercised: 'DropdownMenu: opens in a portal, arrow keys move focus past a disabled item, Enter selects and closes, a checkbox item, a submenu opened with the keyboard. Select: opens from the keyboard, the selected item is focused, arrow and Enter pick a value, the trigger shows it. Tabs: click and arrow keys with roving tabindex',
  async run(t) {
    await t.step('the menu opens and arrow keys move focus', async () => {
      await t.click('#rm-trigger');
      await t.attr('#rm-content', 'role', 'menu');
      await t.attr('#rm-trigger', 'aria-expanded', 'true');
      await t.press('ArrowDown');
      await t.focus('Copy');
      await t.press('ArrowDown');
      await t.focus('Paste');
    });
    await t.step('Enter selects the item and closes the menu', async () => {
      await t.press('Enter');
      await t.text('#rm-picked', 'paste');
      await t.gone('#rm-content');
      await t.focus('rm-trigger');
    });
    await t.step('a checkbox item toggles', async () => {
      await t.click('#rm-trigger');
      await t.attr('#rm-bold', 'aria-checked', 'false');
      await t.click('#rm-bold');
      await t.text('#rm-bold-state', 'true');
      await t.gone('#rm-content');
      await t.click('#rm-trigger');
      await t.attr('#rm-bold', 'aria-checked', 'true');
      await t.attr('#rm-bold', 'data-state', 'checked');
    });
    await t.step('a submenu opens with the keyboard and its item selects', async () => {
      await t.press('End');
      await t.focus('rm-sub');
      await t.press('ArrowRight');
      await t.focus('rm-deep');
      await t.press('Enter');
      await t.text('#rm-picked', 'deep');
      await t.gone('#rm-content');
      // Radix gives the focus back to the trigger a task after the menu
      // unmounts (FocusScope, setTimeout 0): wait for it, or the next step's
      // focus can be taken back from under it.
      await t.focus('rm-trigger');
    });
    await t.step('the select shows its value and opens from the keyboard', async () => {
      await t.text('#rs-trigger', /Apple/);
      await t.page.focus('#rs-trigger');
      await t.press('Enter');
      await t.attr('#rs-content', 'role', 'listbox');
      await t.focus('Apple');
      await t.count('[role="option"]', 3);
    });
    await t.step('arrow and Enter pick a value', async () => {
      await t.press('ArrowDown');
      await t.focus('Banana');
      await t.press('Enter');
      await t.gone('#rs-content');
      await t.text('#rs-value', 'banana');
      await t.text('#rs-trigger', /Banana/);
    });
    await t.step('a pointer picks a value too', async () => {
      await t.click('#rs-trigger');
      await t.present('#rs-content');
      await t.page.getByRole('option', { name: 'Cherry' }).click();
      await t.text('#rs-value', 'cherry');
      await t.gone('#rs-content');
    });
    await t.step('tabs switch by click and by arrow key', async () => {
      await t.text('#panel', 'Panel one');
      await t.click('#tab-two');
      await t.text('#panel', 'Panel two');
      await t.attr('#tab-two', 'aria-selected', 'true');
      await t.attr('#tab-one', 'tabindex', '-1');
      await t.press('ArrowRight');
      await t.focus('tab-three');
      await t.text('#panel', 'Panel three');
      await t.count('#panel', 1);
    });
  },
};
