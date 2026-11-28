export default {
  packages: ['@tanstack/react-query'],
  exercised: '`useQuery` pending then data, an error state, a query key change with placeholder data, the cache on going back, `useMutation` with `invalidateQueries` refetching, `useSuspenseQuery` under `<Suspense>`, `useIsFetching`',
  async run(t) {
    await t.step('pending then data, and an error', async () => {
      await t.text('#q-status', 'success');
      await t.text('#q-data', 'item-1-a,item-1-b,saved-0');
      await t.text('#q-error', 'nope');
    });
    await t.step('useSuspenseQuery resolves through Suspense', async () => {
      await t.text('#q-profile', 'item-9-b');
      await t.gone('#q-fallback');
    });
    await t.step('a key change fetches the next page', async () => {
      await t.click('#q-next');
      await t.text('#q-data', 'item-2-a,item-2-b,saved-0');
      await t.text('#q-next', 'page 2');
    });
    await t.step('going back reads the cache', async () => {
      await t.click('#q-prev');
      await t.text('#q-data', 'item-1-a,item-1-b,saved-0');
    });
    await t.step('a mutation invalidates and refetches', async () => {
      await t.click('#q-save');
      await t.text('#q-mutation', 'success');
      await t.text('#q-data', 'item-1-a,item-1-b,saved-1');
      await t.text('#q-fetching', '0');
    });
  },
};
