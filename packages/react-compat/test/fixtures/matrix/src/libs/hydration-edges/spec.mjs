export default {
  packages: ['react', 'react-dom'],
  exercised: 'hydration beyond a clean match: `draggable={false}` on an image and a link, a form whose `action` is a `useActionState` function (submitted after mounting, and with --serve=ssr before the page hydrates: no navigation, the action runs once it has), and in native.jsx an island that throws while it hydrates beside two islands and native text that must stay live',
  async run(t) {
    await t.step('draggable={false} holds', async () => {
      await t.eval(() => document.querySelector('#edge-img').draggable === false && document.querySelector('#edge-link').draggable === false, true, 'the image and the link are not draggable');
      await t.attr('#edge-img', 'draggable', 'false');
    });
    await t.step('the islands and the native text are live', async () => {
      await t.click('#edge-good1');
      await t.text('#edge-good1', 'edge-good1 1');
      await t.click('#edge-good2');
      await t.text('#edge-good2', 'edge-good2 1');
      await t.click('#edge-native-btn');
      await t.text('#edge-native', '1');
    });
    await t.step('an island that throws while it hydrates is left empty', async () => {
      const hydrated = await t.page.evaluate(() => Boolean(window.__ssr && window.__ssr.rendered));
      if (t.column === 'native' && hydrated) await t.gone('#edge-boom');
      else if (t.column === 'native') await t.text('#edge-boom', 'rendered on the server');
      else await t.gone('#edge-boom');
    });
    await t.step('a form action runs with the form\'s data', async () => {
      await t.fill('#edge-name', 'ada');
      await t.click('#edge-submit');
      await t.text('#edge-out', '1:ada');
    });
  },
  beforeHydrationName: 'a form submitted before the page hydrates does not navigate, and its action runs once it has',
  async beforeHydration(t) {
    await t.fill('#edge-name', 'bob');
    await t.click('#edge-submit');
  },
  async afterHydration(t) {
    await t.text('#edge-out', '1:bob');
    await t.eval(() => location.search.includes('lib=hydration-edges') && !location.search.includes('name='), true, 'the page did not navigate');
  },
};
