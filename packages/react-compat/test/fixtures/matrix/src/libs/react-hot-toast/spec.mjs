const texts = () => [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent);

export default {
  packages: ['react-hot-toast'],
  exercised: '`toast.success`, `toast.error` with an id (no duplicate), a short toast that removes itself, `toast.promise` loading then success, a JSX toast dismissed by id, dismiss all with exit removal',
  async run(t) {
    await t.step('a success toast renders', async () => {
      await t.click('#ht-success');
      await t.until(() => t.page.evaluate(texts), (list) => list.includes('Saved!'), 'the toast text');
    });
    await t.step('a toast with an id is not duplicated', async () => {
      await t.click('#ht-error');
      await t.click('#ht-error');
      await t.until(() => t.page.evaluate(texts), (list) => list.filter((x) => x === 'Broken').length === 1, 'one Broken toast');
    });
    await t.step('a short toast removes itself', async () => {
      await t.click('#ht-short');
      await t.until(() => t.page.evaluate(texts), (list) => list.includes('Short'), 'the short toast shows');
      await t.until(() => t.page.evaluate(texts), (list) => !list.includes('Short'), 'the short toast is removed');
    });
    await t.step('toast.promise goes from loading to success', async () => {
      await t.click('#ht-promise');
      await t.until(() => t.page.evaluate(texts), (list) => list.includes('Working'), 'the loading toast');
      await t.until(() => t.page.evaluate(texts), (list) => list.includes('Finished') && !list.includes('Working'), 'the loading toast became Finished');
    });
    await t.step('a JSX toast, dismissed by id', async () => {
      await t.click('#ht-custom');
      await t.present('#ht-jsx');
      await t.click('#ht-jsx-close');
      await t.gone('#ht-jsx');
      await t.text('#ht-closed', '1');
    });
    await t.step('dismiss all', async () => {
      await t.click('#ht-dismiss');
      await t.until(() => t.page.evaluate(texts), (list) => list.length === 0, 'no toasts left');
    });
  },
};
