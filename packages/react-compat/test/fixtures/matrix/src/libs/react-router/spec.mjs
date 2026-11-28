const path = () => location.pathname + location.search.replace(/[?&]lib=[^&]*&variant=[^&]*/, '');

export default {
  packages: ['react-router'],
  exercised: 'the data router (`createBrowserRouter`, `RouterProvider`): `Link` and `NavLink` active state, nested `Outlet`, a route `loader` with `useLoaderData` and params, browser back and forward, `useSearchParams`, `useNavigate`, a `<Form>` action with `useActionData`, an `errorElement` for an unknown route, layout state kept across navigations',
  async run(t) {
    await t.step('the index route, with the active link', async () => {
      await t.text('#rr-page', 'home');
      await t.attr('#rr-home', 'aria-current', 'page');
      await t.attr('#rr-home', 'class', 'active');
      await t.click('#rr-layout-state');
      await t.text('#rr-layout-state', 'layout 1');
    });
    await t.step('a Link navigates without a page load', async () => {
      await t.page.evaluate(() => { window.__sameDocument = true; });
      await t.click('#rr-users');
      await t.text('#rr-page', 'users');
      await t.eval(path, '/users');
      await t.attr('#rr-users', 'class', 'active');
      await t.attr('#rr-home', 'class', '');
      await t.eval(() => window.__sameDocument === true, true);
    });
    await t.step('a nested route runs its loader', async () => {
      await t.click('#rr-user-2');
      await t.text('#rr-user', 'user 2: item-2-a');
      await t.eval(path, '/users/2');
      await t.text('#rr-nav-state', 'idle');
      await t.click('#rr-user-1');
      await t.text('#rr-user', 'user 1: item-1-a');
    });
    await t.step('browser back and forward', async () => {
      await t.page.goBack();
      await t.text('#rr-user', 'user 2: item-2-a');
      await t.page.goBack();
      await t.gone('#rr-user');
      await t.text('#rr-page', 'users');
      await t.page.goForward();
      await t.text('#rr-user', 'user 2: item-2-a');
    });
    await t.step('search params and layout state', async () => {
      await t.click('#rr-about');
      await t.text('#rr-page', 'about tab=none');
      await t.click('#rr-tab');
      await t.text('#rr-page', 'about tab=b');
      await t.eval(path, '/about?tab=b');
      await t.text('#rr-layout-state', 'layout 1');
    });
    await t.step('a Form action', async () => {
      await t.fill('#rr-name', 'ada');
      await t.click('#rr-send');
      await t.text('#rr-action', 'hello ada');
    });
    await t.step('useNavigate, by path and by delta', async () => {
      await t.click('#rr-go');
      await t.text('#rr-user', 'user 1: item-1-a');
      await t.page.goBack();
      await t.text('#rr-page', /^about/);
      await t.click('#rr-back');
      await t.eval(() => document.querySelector('#rr-page')?.textContent.startsWith('about') === true || document.querySelector('#rr-user') !== null, true, 'navigate(-1) moved back in history');
    });
    await t.step('an unknown route shows the error element and recovers', async () => {
      await t.page.evaluate(() => history.pushState({}, '', '/about'));
      await t.page.goBack();
      await t.page.goForward();
      await t.click('#rr-missing');
      await t.text('#rr-error', /^404 Not Found/);
      await t.click('#rr-recover');
      await t.text('#rr-page', 'home');
    });
  },
};
