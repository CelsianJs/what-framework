export default {
  packages: ['jotai'],
  exercised: 'primitive, derived and writable atoms, a controlled input bound to an atom, `atomWithStorage`, an async atom under `<Suspense>`, `unwrap`, a write from the store outside React',
  async run(t) {
    await t.step('first render, async atom resolves through Suspense', async () => {
      await t.text('#j-count', '0/0');
      await t.value('#j-name', 'ADA');
      await t.text('#j-user', 'item-1-a');
      await t.text('#j-loadable', 'item-1-a');
      await t.gone('#j-fallback');
    });
    await t.step('useAtom updates a derived atom', async () => {
      await t.click('#j-count');
      await t.click('#j-count');
      await t.text('#j-count', '2/4');
    });
    await t.step('a write from the store outside React', async () => {
      await t.page.evaluate(() => window.jStore.set(window.jCount, 20));
      await t.text('#j-count', '20/40');
    });
    await t.step('a controlled input through a writable derived atom', async () => {
      await t.fill('#j-name', '');
      await t.type('#j-name', 'grace');
      await t.value('#j-name', 'GRACE');
      await t.eval(() => localStorage.getItem('j-name'), '"grace"');
      await t.focus('j-name');
    });
    await t.step('a dependency change refetches the async atom', async () => {
      await t.click('#j-next');
      await t.text('#j-user', 'item-2-a');
      await t.text('#j-loadable', 'item-2-a');
      // The counter kept its state while the user suspended.
      await t.text('#j-count', '20/40');
    });
  },
};
