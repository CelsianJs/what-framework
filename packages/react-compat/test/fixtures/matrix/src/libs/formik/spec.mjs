export default {
  packages: ['formik'],
  exercised: '`<Formik>` render prop, `<Field>` as input, select and checkbox (controlled), `validate` with `<ErrorMessage>`, `useField` helpers, `<FieldArray>` push and remove, `useFormikContext`, submit and reset',
  async run(t) {
    await t.step('an invalid submit touches the fields and shows errors', async () => {
      await t.text('#f-status', 'false|true|0|1');
      await t.click('#f-submit');
      await t.text('#f-email-error', 'required');
      await t.text('#f-code-error', 'code too short');
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
      await t.text('#f-sent', '{"email":"ada@x.io","code":"AB","plan":"pro","agree":true,"friends":["cy"]}');
    });
    await t.step('reset restores the initial values', async () => {
      await t.click('#f-reset');
      await t.value('#f-email', '');
      await t.value('#f-plan', 'free');
      await t.eval(() => document.querySelector('#f-agree').checked, false);
      await t.text('#f-status', /^false\|/);
    });
  },
};
