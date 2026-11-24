export default {
  packages: ['zustand'],
  exercised: 'selectors, `useShallow`, a store action from a click and from outside React, `persist` to localStorage, a component that selects another slice does not re-render',
  async run(t) {
    await t.step('first render', async () => {
      await t.text('#z-count', '0');
      await t.text('#z-todos', 'a');
      await t.text('#z-pref', 'light');
    });
    await t.step('an action from a click', async () => {
      await t.click('#z-inc');
      await t.click('#z-inc');
      await t.text('#z-count', '2');
    });
    await t.step('an action and setState from outside React', async () => {
      await t.page.evaluate(() => window.zStore.getState().inc());
      await t.text('#z-count', '3');
      await t.page.evaluate(() => window.zStore.setState({ count: 10 }));
      await t.text('#z-count', '10');
    });
    await t.step('a component selecting another slice did not re-render', async () => {
      await t.attr('#z-todos', 'data-renders', '1');
    });
    await t.step('useShallow selection updates', async () => {
      await t.click('#z-add');
      await t.text('#z-todos', 'a,t1');
      await t.attr('#z-todos', 'data-renders', '2');
    });
    await t.step('persist writes localStorage', async () => {
      await t.click('#z-pref');
      await t.text('#z-pref', 'dark');
      await t.eval(() => JSON.parse(localStorage.getItem('z-pref')).state.dark, true);
    });
  },
};
