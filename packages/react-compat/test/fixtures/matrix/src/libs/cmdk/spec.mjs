const visible = (root) => [...document.querySelectorAll(`${root} [cmdk-item]`)].map((i) => i.textContent).join(',');

export default {
  packages: ['cmdk'],
  exercised: '`Command` with a controlled input: filtering and ranking as you type (items and groups hide), the empty state, arrow-key selection, Enter to pick; `Command.Dialog` (Radix dialog portal) with focus on its input',
  async run(t) {
    await t.step('all items render, the first is selected', async () => {
      await t.eval(visible, 'Apple,Banana,Cherry,Hammer,Wrench', undefined, '#ck-root');
      await t.eval(() => document.querySelector('#ck-root [cmdk-item][aria-selected="true"]')?.textContent, 'Apple');
    });
    await t.step('typing filters items and hides empty groups', async () => {
      await t.click('#ck-root [cmdk-input]');
      await t.type('#ck-root [cmdk-input]', 'wr');
      await t.eval(visible, 'Wrench', undefined, '#ck-root');
      await t.text('#ck-search', 'wr');
      await t.value('#ck-root [cmdk-input]', 'wr');
      await t.eval(() => document.activeElement === document.querySelector('#ck-root [cmdk-input]'), true, 'the input kept focus');
      await t.eval(() => [...document.querySelectorAll('#ck-root [cmdk-group]')].filter((g) => !g.hidden).map((g) => g.querySelector('[cmdk-group-heading]').textContent).join(','), 'Tools');
    });
    await t.step('the empty state', async () => {
      await t.type('#ck-root [cmdk-input]', 'zzz');
      await t.eval(() => document.querySelector('#ck-root [cmdk-empty]')?.textContent ?? null, 'No results.');
      await t.count('#ck-root [cmdk-item]', 0);
    });
    await t.step('clearing brings everything back; arrows select, Enter picks', async () => {
      await t.fill('#ck-root [cmdk-input]', '');
      await t.eval(visible, 'Apple,Banana,Cherry,Hammer,Wrench', undefined, '#ck-root');
      await t.gone('#ck-root [cmdk-empty]');
      await t.press('ArrowDown');
      await t.press('ArrowDown');
      await t.eval(() => document.querySelector('#ck-root [cmdk-item][aria-selected="true"]')?.textContent, 'Cherry');
      await t.press('Enter');
      await t.text('#ck-picked', /^cherry$/i);
    });
    await t.step('the dialog opens in a portal with focus on its input, filters and picks', async () => {
      await t.click('#ck-open');
      await t.present('[cmdk-dialog]');
      await t.eval(() => document.activeElement === document.querySelector('[cmdk-dialog] [cmdk-input]'), true, 'the dialog input has focus');
      await t.type('[cmdk-dialog] [cmdk-input]', 'ban');
      await t.eval(visible, 'Banana', undefined, '[cmdk-dialog]');
      await t.press('Enter');
      await t.text('#ck-picked', /^dialog:banana$/i);
      await t.gone('[cmdk-dialog]');
    });
  },
};
