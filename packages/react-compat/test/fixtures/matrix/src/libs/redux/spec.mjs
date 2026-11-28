export default {
  packages: ['@reduxjs/toolkit', 'react-redux'],
  exercised: '`configureStore`, `createSlice`, `useSelector` (plain, `createSelector`, `shallowEqual`), `useDispatch`, `createAsyncThunk` pending then fulfilled, a dispatch from outside React, a component that selects another slice does not re-render',
  async run(t) {
    await t.step('first render', async () => {
      await t.text('#r-count', '0');
      await t.text('#r-status', 'idle');
      await t.text('#r-summary', '0:none');
    });
    await t.step('dispatch from a click', async () => {
      await t.click('#r-inc');
      await t.click('#r-add5');
      await t.text('#r-count', '6');
    });
    await t.step('dispatch from outside React', async () => {
      await t.page.evaluate(() => window.rStore.dispatch(window.rInc()));
      await t.text('#r-count', '7');
    });
    await t.step('a component selecting another slice did not re-render', async () => {
      await t.attr('#r-status', 'data-renders', '1');
    });
    await t.step('an async thunk goes pending then fulfilled', async () => {
      await t.click('#r-load');
      await t.text('#r-status', 'done');
      await t.text('#r-summary', '2:item-7-a');
      await t.text('#r-pair', 'item-7-a|item-7-b');
    });
    await t.step('the counter did not re-render for the items slice', async () => {
      await t.attr('#r-count', 'data-renders', '4');
    });
  },
};
