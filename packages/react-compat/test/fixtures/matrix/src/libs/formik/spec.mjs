export default {
  packages: ['formik'],
  exercised: '`<Formik>` render prop, `<Field>` as input, select and checkbox (controlled), `validate` with `<ErrorMessage>`, a field touched on blur, focus on the first bad field through `innerRef` and an effect, `useField` helpers, `<FieldArray>` push, remove and swap of keyed rows, `useFormikContext`, submit, reset, `enableReinitialize`',
  async run(t) {
    await t.step('leaving a field touches it: its error shows, the others\' do not', async () => {
      await t.text('#f-status', 'false|true|0|1');
      await t.click('#f-code');
      await t.type('#f-code', 'a');
      await t.value('#f-code', 'A');
      await t.count('#f-code-error', 0);
      await t.press('Tab');
      await t.text('#f-code-error', 'code too short');
      await t.count('#f-email-error', 0);
      await t.fill('#f-code', '');
    });
    await t.step('an invalid submit touches the fields, shows errors and focuses the first bad field', async () => {
      await t.click('#f-submit');
      await t.text('#f-email-error', 'required');
      await t.text('#f-code-error', 'code too short');
      await t.focus('f-email');
    });
    await t.step('controlled inputs keep what is typed and revalidate', async () => {
      await t.type('#f-email', 'ada');
      await t.text('#f-email-error', 'invalid');
      await t.type('#f-email', '@x.io');
      await t.gone('#f-email-error');
      await t.value('#f-email', 'ada@x.io');
      await t.focus('f-email');
      await t.type('#f-code', 'ab');
      await t.value('#f-code', 'AB');
      await t.gone('#f-code-error');
    });
    await t.step('a select and a checkbox', async () => {
      await t.page.selectOption('#f-plan', 'pro');
      await t.value('#f-plan', 'pro');
      await t.click('#f-agree');
      await t.eval(() => document.querySelector('#f-agree').checked, true);
    });
    await t.step('FieldArray push and remove', async () => {
      await t.click('#f-add');
      await t.count('.f-friend', 2);
      await t.page.locator('.f-friend').nth(1).fill('cy');
      await t.page.locator('.f-remove').nth(0).click();
      await t.count('.f-friend', 1);
      await t.eval(() => document.querySelector('.f-friend').value, 'cy');
    });
    await t.step('a valid submit', async () => {
      await t.click('#f-submit');
      await t.text('#f-sent', '{"email":"ada@x.io","code":"AB","plan":"pro","agree":true,"friends":["cy"],"pets":[{"id":1,"name":"rex"},{"id":2,"name":"tom"}]}');
    });
    await t.step('FieldArray swap moves the keyed rows', async () => {
      await t.page.evaluate(() => { window.__pets = [...document.querySelectorAll('.f-pet-row')]; });
      await t.page.locator('.f-pet').first().fill('rex!');
      await t.click('#f-swap');
      await t.eval(() => [...document.querySelectorAll('.f-pet')].map((i) => i.value).join(','), 'tom,rex!');
      await t.eval(() => { const now = [...document.querySelectorAll('.f-pet-row')]; return now[0] === window.__pets[1] && now[1] === window.__pets[0]; }, true, 'the same two rows, swapped');
    });
    await t.step('reset restores the initial values', async () => {
      await t.click('#f-reset');
      await t.value('#f-email', '');
      await t.value('#f-plan', 'free');
      await t.eval(() => document.querySelector('#f-agree').checked, false);
      await t.text('#f-status', /^false\|/);
    });
    await t.step('new initialValues reinitialize the form', async () => {
      await t.click('#f-load');
      await t.value('#f-email', 'loaded@x.io');
      await t.value('#f-code', 'ZZ');
      await t.value('#f-plan', 'pro');
      await t.eval(() => [...document.querySelectorAll('.f-pet')].map((i) => i.value).join(','), 'ace');
      await t.text('#f-status', 'false|true|0|1');
    });
  },
};
