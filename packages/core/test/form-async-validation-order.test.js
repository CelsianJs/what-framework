// A resolver whose answer takes longer for some values (a registry lookup, a
// server check) answers validations of a field typed quickly out of order.
// The form shows the answer for what the field holds now, and reports
// validating until the last answer has landed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { useForm } = await import('../src/form.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edit = (registration, value) => registration.onchange({ type: 'input', target: { type: 'text', value } });

// "core" is taken and slow to look up; every other scope is free and quick.
function registryResolver(log = []) {
  return async (values) => {
    log.push(values.scope);
    await sleep(values.scope === 'core' ? 60 : 5);
    return { values, errors: values.scope === 'core' ? { scope: { type: 'taken', message: '@core is taken' } } : {} };
  };
}

describe('async validation answers that arrive out of order', () => {
  it('a slow answer for an earlier value does not replace the answer for the current one', async () => {
    const form = useForm({ defaultValues: { scope: '' }, mode: 'onChange', resolver: registryResolver() });
    const scope = form.register('scope');
    edit(scope, 'core');
    edit(scope, 'core-ui');
    await sleep(100);
    assert.equal(form.formState.error('scope'), null);
    assert.deepEqual(form.formState.errors, {});
  });

  it('the answer for the current value lands when it is the slow one', async () => {
    const form = useForm({ defaultValues: { scope: '' }, mode: 'onChange', resolver: registryResolver() });
    const scope = form.register('scope');
    edit(scope, 'cor');
    edit(scope, 'core');
    await sleep(100);
    assert.equal(form.formState.error('scope')?.message, '@core is taken');
  });

  it('isValidating stays true until the last answer has landed', async () => {
    const form = useForm({ defaultValues: { scope: '' }, mode: 'onChange', resolver: registryResolver() });
    const scope = form.register('scope');
    edit(scope, 'core');
    edit(scope, 'core-ui');
    await sleep(25); // core-ui has answered, core has not
    assert.equal(form.formState.isValidating(), true);
    await sleep(80);
    assert.equal(form.formState.isValidating(), false);
  });

  it('a whole-form validation that lands after a newer field validation keeps the field\'s answer', async () => {
    const form = useForm({ defaultValues: { scope: 'core' }, mode: 'onChange', resolver: registryResolver() });
    const scope = form.register('scope');
    const whole = form.validate(); // slow: core is taken
    edit(scope, 'core-ui');        // quick: free
    const valid = await whole;
    await sleep(20);
    assert.equal(valid, false);
    assert.equal(form.formState.error('scope'), null);
  });

  it('a field answer that lands after a newer whole-form validation started is dropped', async () => {
    const form = useForm({ defaultValues: { scope: '' }, mode: 'onChange', resolver: registryResolver() });
    const scope = form.register('scope');
    edit(scope, 'core');      // slow, taken
    form.setValue('scope', 'free-name');
    await form.validate();    // quick, free
    await sleep(80);
    assert.equal(form.formState.error('scope'), null);
  });
});
