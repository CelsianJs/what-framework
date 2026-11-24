export default {
  packages: ['react-markdown', 'remark-gfm'],
  exercised: 'CommonMark and GFM (table, strikethrough, task list) rendered to elements, custom `components` (one with an effect and a ref, one with state, a link with a click handler), raw HTML kept as text, a block inserted before a list whose items keep their state, new source reconciled in place',
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
    await t.step('a custom component with an effect and a ref (what a highlighter does)', async () => {
      await t.attr('#md-out pre code', 'data-highlighted', 'js:12');
      await t.eval(() => globalThis.__mdLive.blocks, 1, 'one code block is mounted');
    });
    await t.step('a custom link handles its click and stops the navigation', async () => {
      const pages = t.page.context().pages().length;
      await t.click('#md-out a');
      await t.text('#md-clicked', 'https://example.com:true');
      await t.eval(() => location.href.includes('example.com'), false, 'the page did not navigate');
      if (t.page.context().pages().length !== pages) throw new Error('the link opened a new page');
    });
    await t.step('a block inserted before a list keeps the state of its items', async () => {
      await t.click('#md-out ul:first-of-type li:first-child');
      await t.attr('#md-out ul:first-of-type li:first-child', 'data-picked', 'true');
      await t.page.evaluate(() => { window.__li = document.querySelector('#md-out ul:first-of-type li:first-child'); });
      await t.click('#md-intro');
      await t.text('#md-out h1 + p', 'An intro line.');
      await t.attr('#md-out ul:first-of-type li:first-child', 'data-picked', 'true');
      await t.eval(() => window.__li === document.querySelector('#md-out ul:first-of-type li:first-child'), true, 'the same <li> element');
      await t.eval(() => globalThis.__mdLive.blocks, 1, 'still one code block');
    });
    await t.step('new source re-renders', async () => {
      await t.click('#md-set');
      await t.text('#md-out h2', 'Changed');
      await t.count('#md-out h1', 0);
      await t.eval(() => globalThis.__mdLive.blocks, 0, 'the code block that left was cleaned up');
      await t.eval(() => [...document.querySelectorAll('#md-out ol li')].map((li) => li.textContent).join(','), 'first,second');
      await t.fill('#md-source', '');
      await t.type('#md-source', 'plain *words*');
      await t.text('#md-out p', 'plain words');
      await t.text('#md-out em', 'words');
    });
  },
};
