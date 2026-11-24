const names = () => [...document.querySelectorAll('#tt-table tbody tr td:first-child')].map((td) => td.textContent).join(',');

export default {
  packages: ['@tanstack/react-table'],
  exercised: '`useTable` (v9) with sorting, column filtering and pagination features, `FlexRender` for header and cell templates, a header click cycling the sort, typing in a filter, page buttons, new data',
  async run(t) {
    await t.step('first page, with header and cell templates', async () => {
      await t.eval(names, 'Linus,Ada,Grace');
      await t.text('#tt-page', '1/3');
      await t.eval(() => document.querySelector('#tt-h-city i')?.textContent, 'City');
      await t.eval(() => document.querySelector('#tt-table tbody td:nth-child(2) b')?.textContent, '54');
    });
    await t.step('a header click sorts, a second reverses', async () => {
      await t.click('#tt-h-name');
      await t.eval(names, 'Ada,Alan,Barbara');
      await t.attr('#tt-h-name', 'data-sort', 'asc');
      await t.click('#tt-h-name');
      await t.eval(names, 'Margaret,Linus,Grace');
      await t.attr('#tt-h-name', 'data-sort', 'desc');
      await t.click('#tt-h-age');
      await t.attr('#tt-h-name', 'data-sort', 'none');
    });
    await t.step('pagination', async () => {
      await t.click('#tt-next');
      await t.text('#tt-page', '2/3');
      await t.click('#tt-next');
      await t.text('#tt-page', '3/3');
      await t.count('#tt-table tbody tr', 1);
      await t.eval(() => document.querySelector('#tt-next').disabled, true);
      await t.click('#tt-prev');
      await t.text('#tt-page', '2/3');
    });
    await t.step('typing in the filter narrows the rows and keeps focus', async () => {
      await t.click('#tt-filter');
      await t.type('#tt-filter', 'ar');
      await t.eval(() => [...document.querySelectorAll('#tt-table tbody tr td:first-child')].map((td) => td.textContent).sort().join(','), 'Barbara,Margaret');
      await t.text('#tt-page', '1/1');
      await t.focus('tt-filter');
      await t.value('#tt-filter', 'ar');
    });
    await t.step('new data reaches the table', async () => {
      await t.click('#tt-add');
      await t.count('#tt-table tbody tr', 3);
      await t.eval(() => [...document.querySelectorAll('#tt-table tbody tr td:first-child')].map((td) => td.textContent).sort().join(','), 'Aaron,Barbara,Margaret');
    });
  },
};
