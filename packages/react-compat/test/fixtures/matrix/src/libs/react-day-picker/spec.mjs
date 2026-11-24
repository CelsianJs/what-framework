const day = (root, n) => `${root} td[data-day$="-${String(n).padStart(2, '0')}"] button`;

export default {
  packages: ['react-day-picker'],
  exercised: 'a single-date `DayPicker`: a click selects, arrow keys move focus between days, Enter selects, the next-month button; a range `DayPicker` with disabled days and the range modifiers',
  async run(t) {
    await t.step('the month grid renders', async () => {
      await t.eval(() => document.querySelector('#dp-single [role="grid"]').getAttribute('aria-label'), 'January 2026');
      await t.count('#dp-single td[data-day^="2026-01"]', 31);
    });
    await t.step('a click selects a day', async () => {
      await t.click(day('#dp-single', 15));
      await t.text('#dp-selected', '2026-01-15');
      await t.attr('#dp-single td[data-day="2026-01-15"]', 'aria-selected', 'true');
      await t.count('#dp-single td[aria-selected="true"]', 1);
    });
    await t.step('arrow keys move focus, Enter selects', async () => {
      await t.press('ArrowRight');
      await t.eval(() => document.activeElement.closest('td')?.dataset.day, '2026-01-16');
      await t.press('ArrowDown');
      await t.eval(() => document.activeElement.closest('td')?.dataset.day, '2026-01-23');
      await t.press('Enter');
      await t.text('#dp-selected', '2026-01-23');
      await t.count('#dp-single td[aria-selected="true"]', 1);
    });
    await t.step('the next-month button', async () => {
      await t.page.locator('#dp-single').getByRole('button', { name: /next month/i }).click();
      await t.eval(() => document.querySelector('#dp-single [role="grid"]').getAttribute('aria-label'), 'February 2026');
      await t.count('#dp-single td[data-day^="2026-02"]', 28);
    });
    await t.step('a range, with disabled days', async () => {
      await t.eval(() => document.querySelector('#dp-range td[data-day="2026-06-07"] button').disabled, true, 'Sundays are disabled');
      await t.click(day('#dp-range', 9));
      await t.click(day('#dp-range', 12));
      await t.text('#dp-range-value', '2026-06-09..2026-06-12');
      await t.count('#dp-range td[aria-selected="true"]', 4);
      await t.eval(() => document.querySelector('#dp-range td[data-day="2026-06-10"]').className.includes('range_middle'), true, 'the days between carry the range modifier');
    });
  },
};
