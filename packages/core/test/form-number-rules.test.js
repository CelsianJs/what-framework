// rules.min and rules.max check what a number field actually gives a form: a
// registered <input type="number"> hands over its value as a string ("0",
// "900"), the way the DOM reports it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { rules, simpleResolver, useForm } = await import('../src/form.js');

describe('rules.min and rules.max on the strings a number field gives', () => {
  it('a numeric string below min or above max is an error', () => {
    assert.equal(rules.min(1)('0'), 'Must be at least 1');
    assert.equal(rules.max(500)('900'), 'Must be at most 500');
    assert.equal(rules.min(1, 'At least 1 KB')(' 0.5 '), 'At least 1 KB');
  });

  it('a numeric string within the bounds passes', () => {
    assert.equal(rules.min(1)('1'), undefined);
    assert.equal(rules.max(500)('500'), undefined);
    assert.equal(rules.min(-5)('-2'), undefined);
  });

  it('an empty or non-numeric string is left to required and pattern', () => {
    assert.equal(rules.min(1)(''), undefined);
    assert.equal(rules.min(1)('   '), undefined);
    assert.equal(rules.max(5)('abc'), undefined);
  });

  it('numbers behave as before', () => {
    assert.equal(rules.min(10)(5), 'Must be at least 10');
    assert.equal(rules.max(100)(150), 'Must be at most 100');
    assert.equal(rules.min(10)(15), undefined);
  });

  it('a registered number field below its minimum shows the error as the user types', async () => {
    const form = useForm({
      defaultValues: { budget: '20' },
      mode: 'onChange',
      resolver: simpleResolver({ budget: [rules.required(), rules.min(1, 'At least 1 KB')] }),
    });
    const field = form.register('budget');
    field.onchange({ type: 'input', target: { type: 'number', value: '0' } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(form.formState.error('budget')?.message, 'At least 1 KB');
  });
});
