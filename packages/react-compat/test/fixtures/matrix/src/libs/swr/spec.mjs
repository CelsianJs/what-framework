export default {
  packages: ['swr'],
  exercised: '`useSWR` loading then data, three hooks on one key share a request, a key change, a local `mutate` without revalidation, a global `mutate` that revalidates, `useSWRMutation`',
  async run(t) {
    await t.step('loading then data, one request for three hooks on a key', async () => {
      await t.text('#s-data', 'item-1-a,item-1-b');
      await t.count('[id="s-items-1"]', 2);
      await t.eval(() => [...document.querySelectorAll('[id="s-items-1"]')].map((e) => e.textContent).join('|'), 'item-1-a,item-1-b|item-1-a,item-1-b');
    });
    await t.step('a local mutate shows at once in every hook on the key', async () => {
      await t.click('#s-optimistic');
      await t.text('#s-data', 'local');
      await t.eval(() => [...document.querySelectorAll('[id="s-items-1"]')].map((e) => e.textContent).join('|'), 'local|local');
    });
    await t.step('a global mutate revalidates', async () => {
      await t.click('#s-revalidate');
      await t.text('#s-data', 'item-1-a,item-1-b');
    });
    await t.step('a key change fetches', async () => {
      await t.click('#s-next');
      await t.text('#s-data', 'item-2-a,item-2-b');
      await t.text('#s-next', 'key 2');
    });
    await t.step('useSWRMutation triggers and returns data', async () => {
      await t.click('#s-send');
      await t.text('#s-sent', '42');
      await t.text('#s-send', 'send');
    });
  },
};
