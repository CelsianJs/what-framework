export default {
  packages: ['react-router'],
  exercised: 'declarative routing (`BrowserRouter`, `Routes`, `Route`): `NavLink` class function, `useLocation`, link state, `useParams`, `<Navigate>` redirect, `navigate(..., { replace })`, browser back, a catch-all route, layout state kept',
  async run(t) {
    await t.step('first route', async () => {
      await t.text('#rd-page', 'home');
      await t.attr('#rd-home', 'class', 'on');
      await t.attr('#rd-items', 'class', 'off');
      await t.click('#rd-n');
    });
    await t.step('Link, useLocation and the active class', async () => {
      await t.click('#rd-items');
      await t.text('#rd-page', 'items');
      await t.text('#rd-path', '/items');
      await t.attr('#rd-items', 'class', 'on');
      await t.attr('#rd-home', 'class', 'off');
    });
    await t.step('params and link state', async () => {
      await t.click('#rd-item-7');
      await t.text('#rd-page', 'item 7 from list');
      await t.eval(() => location.pathname, '/items/7');
    });
    await t.step('back, then a replace navigation', async () => {
      await t.page.goBack();
      await t.text('#rd-page', 'items');
      await t.click('#rd-go');
      await t.text('#rd-page', 'item 9 from nowhere');
      await t.page.goBack();
      await t.text('#rd-page', 'home');
    });
    await t.step('a <Navigate> redirect and layout state', async () => {
      await t.click('#rd-old');
      await t.text('#rd-page', 'items');
      await t.text('#rd-path', '/items');
      await t.text('#rd-n', '1');
    });
    await t.step('a catch-all route', async () => {
      await t.page.evaluate(() => { history.pushState({}, '', '/nowhere'); dispatchEvent(new PopStateEvent('popstate')); });
      await t.text('#rd-page', 'not found');
    });
  },
};
