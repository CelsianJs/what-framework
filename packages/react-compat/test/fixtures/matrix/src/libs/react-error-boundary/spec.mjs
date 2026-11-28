const life = () => globalThis.__ebLife.join(',');

export default {
  packages: ['react-error-boundary'],
  exercised: 'a class error boundary (`getDerivedStateFromError`, `componentDidCatch`): a render error shows the fallback, calls `onError` and cleans up the effects of what it replaced; a fallback that focuses its button through a ref in an effect; `resetErrorBoundary` as a click handler (the event reaches `onReset`); `resetKeys`; `useErrorBoundary().showBoundary`; an error thrown in an effect; a new `key` on the boundary',
  async run(t) {
    await t.step('a render error shows the fallback; the rest of the page stays', async () => {
      await t.text('#eb-ok', 'all good');
      await t.eval(life, 'layout+,effect+', 'the effects inside the boundary ran');
      await t.click('#eb-count');
      await t.click('#eb-arm');
      await t.text('#eb-message', 'boom in render');
      await t.gone('#eb-ok');
      await t.gone('#eb-count');
      await t.text('#eb-errors', 'boom in render');
      await t.text('#eb-outside', 'outside stays');
    });
    await t.step('what the fallback replaced is cleaned up, and the fallback takes focus', async () => {
      await t.eval(life, 'layout+,effect+,layout-,effect-', 'the cleanups of the children the boundary dropped');
      await t.focus('eb-retry');
    });
    await t.step('resetErrorBoundary renders the children again', async () => {
      await t.click('#eb-retry');
      await t.text('#eb-ok', 'all good');
      await t.text('#eb-resets', '1');
      await t.text('#eb-count', 'count 0');
      await t.gone('#eb-message');
      await t.text('#eb-reason', 'imperative-api:click:function');
      await t.eval(life, 'layout+,effect+,layout-,effect-,layout+,effect+');
    });
    await t.step('resetKeys reset the boundary', async () => {
      await t.click('#eb-arm');
      await t.text('#eb-message', 'boom in render');
      await t.click('#eb-key');
      await t.text('#eb-ok', 'all good');
      await t.gone('#eb-message');
      await t.text('#eb-reason', 'keys');
    });
    await t.step('showBoundary routes a later error to the boundary', async () => {
      await t.click('#eb-async');
      await t.text('#eb-message', 'boom later');
      await t.text('#eb-errors', /boom later$/);
      await t.click('#eb-retry');
      await t.text('#eb-ok', 'all good');
    });
    await t.step('an error thrown in an effect reaches the boundary', async () => {
      await t.text('#eb-effect', 'effect ok');
      await t.click('#eb-arm-effect');
      await t.text('#eb-message', 'boom in effect');
      await t.text('#eb-errors', /boom in effect$/);
      await t.focus('eb-retry');
      await t.click('#eb-retry');
      await t.text('#eb-effect', 'effect ok');
      await t.gone('#eb-message');
    });
    await t.step('a new key remounts the boundary and what is inside', async () => {
      await t.click('#eb-count');
      await t.click('#eb-count');
      await t.text('#eb-count', 'count 2');
      const before = await t.page.evaluate(life);
      await t.click('#eb-remount');
      await t.text('#eb-count', 'count 0');
      // One commit: the layout phase (the old tree's cleanup, the new tree's
      // effect), then the passive phase the same way.
      await t.eval(life, `${before},layout-,layout+,effect-,effect+`, 'the old children cleaned up and the new ones mounted, phase by phase');
    });
  },
};
