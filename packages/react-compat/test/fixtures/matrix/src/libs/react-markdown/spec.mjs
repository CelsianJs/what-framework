export default {
  packages: ['react-markdown', 'remark-gfm'],
  exercised: 'CommonMark and GFM (table, strikethrough, task list) rendered to elements, custom `components`, raw HTML kept as text, and new source reconciled in place',
  async run(t) {
    await t.step('markdown renders to elements', async () => {
      await t.text('#md-out h1', 'Title!');
      await t.attr('#md-out h1', 'data-custom', 'yes');
      await t.text('#md-out strong', 'bold');
      await t.text('#md-out em', 'emphasis');
      await t.text('#md-out del', 'struck');
      await t.eval(() => [...document.querySelectorAll('#md-out ul:first-of-type li')].map((li) => li.textContent).join(','), 'one,two');
    });
    await t.step('GFM: table and task list', async () => {
      await t.eval(() => [...document.querySelectorAll('#md-out table th, #md-out table td')].map((c) => c.textContent).join(','), 'a,b,1,2');
      await t.eval(() => [...document.querySelectorAll('#md-out input[type="checkbox"]')].map((c) => `${c.checked}:${c.disabled}`).join(','), 'true:true,false:true');
      await t.text('#md-out pre code', /const x = 1;/);
      await t.attr('#md-out pre code', 'class', 'language-js');
    });
    await t.step('custom components and no raw HTML', async () => {
      await t.attr('#md-out a', 'class', 'md-link');
      await t.attr('#md-out a', 'href', 'https://example.com');
      await t.attr('#md-out a', 'target', '_blank');
      await t.count('#md-out script', 0);
    });
    await t.step('new source re-renders', async () => {
      await t.click('#md-set');
      await t.text('#md-out h2', 'Changed');
      await t.count('#md-out h1', 0);
      await t.eval(() => [...document.querySelectorAll('#md-out ol li')].map((li) => li.textContent).join(','), 'first,second');
      await t.fill('#md-source', '');
      await t.type('#md-source', 'plain *words*');
      await t.text('#md-out p', 'plain words');
      await t.text('#md-out em', 'words');
    });
  },
};
