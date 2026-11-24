export default {
  packages: ['react-error-boundary'],
  exercised: 'a class error boundary (`getDerivedStateFromError`, `componentDidCatch`): a render error shows the fallback and calls `onError`, `resetErrorBoundary`, `resetKeys`, and `useErrorBoundary().showBoundary` for an error raised outside render',
  async run(t) {
    await t.step('a render error shows the fallback; the rest of the page stays', async () => {
      await t.text('#eb-ok', 'all good');
      await t.click('#eb-count');
      await t.click('#eb-arm');
      await t.text('#eb-message', 'boom in render');
      await t.gone('#eb-ok');
      await t.gone('#eb-count');
      await t.text('#eb-errors', 'boom in render');
      await t.text('#eb-outside', 'outside stays');
    });
    await t.step('resetErrorBoundary renders the children again', async () => {
      await t.click('#eb-retry');
      await t.text('#eb-ok', 'all good');
      await t.text('#eb-resets', '1');
      await t.text('#eb-count', 'count 0');
      await t.gone('#eb-message');
    });
    await t.step('resetKeys reset the boundary', async () => {
      await t.click('#eb-arm');
      await t.text('#eb-message', 'boom in render');
      await t.click('#eb-key');
      await t.text('#eb-ok', 'all good');
      await t.gone('#eb-message');
    });
    await t.step('showBoundary routes a later error to the boundary', async () => {
      await t.click('#eb-async');
      await t.text('#eb-message', 'boom later');
      await t.text('#eb-errors', /boom later$/);
      await t.click('#eb-retry');
      await t.text('#eb-ok', 'all good');
    });
  },
};
