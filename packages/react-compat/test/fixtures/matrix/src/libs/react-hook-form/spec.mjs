export default {
  packages: ['react-hook-form'],
  exercised: '`register` (uncontrolled inputs through refs), validation on submit with focus on the first error, an error that clears while typing, `Controller`, `useFieldArray` append and remove, `useWatch`, `setFocus`, `reset`, `formState`',
  async run(t) {
    await t.step('an invalid submit shows errors and focuses the first bad field', async () => {
      await t.click('#h-submit');
      await t.text('#h-name-error', 'name is required');
      await t.text('#h-rating-error', 'rate it');
      await t.focus('h-name');
      await t.text('#h-submits', '1');
    });
    await t.step('typing keeps the value and revalidates', async () => {
      await t.type('#h-name', 'ad');
      await t.text('#h-name-error', 'too short');
      await t.type('#h-name', 'a');
      await t.gone('#h-name-error');
      await t.value('#h-name', 'ada');
      await t.text('#h-watch', 'ada');
      await t.text('#h-dirty', 'true');
    });
    await t.step('a Controller field', async () => {
      await t.click('#h-star-2');
      await t.attr('#h-star-2', 'aria-pressed', 'true');
      await t.attr('#h-star-3', 'aria-pressed', 'false');
      await t.gone('#h-rating-error');
    });
    await t.step('useFieldArray appends and removes, keeping typed values', async () => {
      await t.click('#h-append');
      await t.count('.h-tag', 2);
      await t.page.locator('.h-tag').nth(1).fill('two');
      await t.click('#h-append');
      await t.page.locator('.h-remove').nth(0).click();
      await t.count('.h-tag', 2);
      await t.eval(() => [...document.querySelectorAll('.h-tag')].map((i) => i.value).join(','), 'two,new');
    });
    await t.step('setFocus, a pattern error, then a valid submit', async () => {
      await t.click('#h-focus');
      await t.focus('h-email');
      await t.type('#h-email', 'nope');
      await t.click('#h-submit');
      await t.text('#h-email-error', 'bad email');
      await t.type('#h-email', '@x.io');
      await t.click('#h-submit');
      await t.text('#h-sent', '{"name":"ada","email":"nope@x.io","rating":2,"tags":[{"value":"two"},{"value":"new"}]}');
    });
    await t.step('reset restores the defaults in the DOM', async () => {
      await t.click('#h-reset');
      await t.value('#h-name', '');
      await t.count('.h-tag', 1);
      await t.text('#h-dirty', 'false');
    });
  },
};
