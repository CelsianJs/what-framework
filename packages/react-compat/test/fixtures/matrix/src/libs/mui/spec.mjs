export default {
  packages: ['@mui/material', '@emotion/react', '@emotion/styled'],
  exercised: 'Emotion styles from a custom theme (`ThemeProvider`, `styled`), Button with ripple, a controlled TextField, Select (Menu in a Popover and Modal portal, keyboard and pointer), Dialog (focus trap, `autoFocus`, a Select inside it, fade-out then unmount), Checkbox, Autocomplete (type, pick), Tabs, Tooltip, Snackbar auto-hide',
  async run(t) {
    await t.step('Emotion writes the theme styles', async () => {
      await t.style('#mu-btn', 'backgroundColor', 'rgb(156, 39, 176)');
      await t.style('#mu-tag', 'color', 'rgb(156, 39, 176)');
      await t.style('#mu-tag', 'paddingLeft', '8px');
    });
    await t.step('a button click', async () => {
      await t.click('#mu-btn');
      await t.click('#mu-btn');
      await t.text('#mu-btn', /Clicked 2/);
    });
    await t.step('a controlled TextField keeps focus and floats its label', async () => {
      await t.click('#mu-text');
      await t.type('#mu-text', 'grace');
      await t.value('#mu-text', 'grace');
      await t.text('#mu-echo', 'grace');
      await t.focus('mu-text');
      await t.attr('label[for="mu-text"]', 'data-shrink', 'true');
    });
    await t.step('a Select opens its menu in a portal and picks by pointer', async () => {
      await t.click('#mu-plan');
      await t.count('[role="listbox"] [role="option"]', 3);
      await t.eval(() => !document.querySelector('#main').contains(document.querySelector('[role="listbox"]')), true, 'the menu is in a portal');
      await t.click('[role="option"][data-value="pro"]');
      await t.text('#mu-plan-value', 'pro');
      await t.gone('[role="listbox"]');
      await t.text('#mu-plan', 'Pro');
    });
    await t.step('a Select picks by keyboard', async () => {
      await t.page.focus('#mu-plan');
      await t.press('Enter');
      await t.count('[role="listbox"] [role="option"]', 3);
      await t.press('ArrowDown');
      await t.press('Enter');
      await t.text('#mu-plan-value', 'team');
      await t.gone('[role="listbox"]');
    });
    await t.step('a Dialog opens, focuses its autoFocus field and traps focus', async () => {
      await t.click('#mu-open');
      await t.present('[role="dialog"]');
      await t.focus('mu-note');
      await t.type('#mu-note', 'hello');
      await t.text('#mu-note-echo', 'hello');
      for (let i = 0; i < 6; i++) await t.press('Tab');
      await t.eval(() => document.querySelector('[role="dialog"]').contains(document.activeElement), true, 'focus is still inside the dialog');
    });
    await t.step('a Select inside the Dialog works and leaves the Dialog open', async () => {
      await t.click('#mu-inner');
      await t.count('[role="listbox"] [role="option"]', 3);
      await t.click('[role="option"][data-value="free"]');
      await t.text('#mu-plan-value', 'free');
      await t.gone('[role="listbox"]');
      await t.present('[role="dialog"]');
    });
    await t.step('the Dialog fades out and unmounts', async () => {
      await t.click('#mu-close');
      await t.gone('[role="dialog"]');
      await t.focus('mu-open');
    });
    await t.step('a Checkbox through its label', async () => {
      await t.click('text=Agree');
      await t.text('#mu-agree', 'true');
      await t.eval(() => document.querySelector('#mu-check').checked, true);
    });
    await t.step('Autocomplete filters and picks', async () => {
      await t.click('#mu-auto');
      await t.type('#mu-auto', 'gr');
      await t.count('[role="listbox"] [role="option"]', 1);
      await t.click('[role="option"]');
      await t.text('#mu-person', 'Grace');
      await t.value('#mu-auto', 'Grace');
    });
    await t.step('Tabs', async () => {
      await t.click('#mu-tab-1');
      await t.text('#mu-panel', 'panel 1');
      await t.attr('#mu-tab-1', 'aria-selected', 'true');
    });
    await t.step('Tooltip on hover', async () => {
      await t.hover('#mu-tip');
      await t.eval(() => document.querySelector('[role="tooltip"]')?.textContent ?? null, 'Helpful');
    });
    await t.step('Snackbar shows and hides itself', async () => {
      await t.click('#mu-snack');
      await t.eval(() => document.querySelector('.MuiSnackbar-root')?.textContent ?? null, 'Saved!');
      await t.gone('.MuiSnackbar-root');
    });
  },
};
