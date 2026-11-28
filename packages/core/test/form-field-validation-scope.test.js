// Validating one field (each keystroke in mode: 'onChange') tells the
// resolver which field it is for, and simpleResolver runs only that field's
// rules: in a 300-field form a keystroke runs one field's rules, not 300.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { rules, simpleResolver, useForm } = await import('../src/form.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const edit = (registration, value) => registration.onchange({ type: 'input', target: { type: 'text', value } });

function countedRules(names) {
  const runs = Object.create(null);
  const map = {};
  for (const name of names) {
    map[name] = [(value) => { runs[name] = (runs[name] || 0) + 1; return rules.required()(value); }];
  }
  return { runs, map };
}

describe('the fields a validation is for', () => {
  it('a keystroke in one field runs only that field\'s rules', async () => {
    const names = Array.from({ length: 300 }, (_, i) => `f${i}`);
    const { runs, map } = countedRules(names);
    const form = useForm({ defaultValues: Object.fromEntries(names.map((n) => [n, 'x'])), mode: 'onChange', resolver: simpleResolver(map) });
    const field = form.register('f7');
    for (const n of names) if (n !== 'f7') form.register(n);
    edit(field, '');
    await sleep(0);
    assert.deepEqual({ ...runs }, { f7: 1 });
    assert.equal(form.formState.error('f7')?.message, 'This field is required');
  });

  it('a whole-form validation still runs every rule', async () => {
    const { runs, map } = countedRules(['a', 'b', 'c']);
    const form = useForm({ defaultValues: { a: 'x', b: '', c: 'x' }, resolver: simpleResolver(map) });
    const valid = await form.validate();
    assert.equal(valid, false);
    assert.deepEqual({ ...runs }, { a: 1, b: 1, c: 1 });
    assert.equal(form.formState.error('b')?.message, 'This field is required');
  });

  it('a resolver is handed the names of the fields a validation is for', async () => {
    const seen = [];
    const resolver = async (values, context, options) => {
      seen.push(options?.names ?? null);
      return { values, errors: {} };
    };
    const form = useForm({ defaultValues: { a: '' }, mode: 'onChange', resolver });
    edit(form.register('a'), 'z');
    await sleep(0);
    await form.validate();
    assert.deepEqual(seen, [['a'], null]);
  });

  it('a cross-field rule still reads every value', async () => {
    const form = useForm({
      defaultValues: { password: 'secret', confirm: '' },
      mode: 'onChange',
      resolver: simpleResolver({ password: [rules.required()], confirm: [rules.match('password', 'Must match')] }),
    });
    form.register('password');
    const confirm = form.register('confirm');
    edit(confirm, 'secre');
    await sleep(0);
    assert.equal(form.formState.error('confirm')?.message, 'Must match');
    edit(confirm, 'secret');
    await sleep(0);
    assert.equal(form.formState.error('confirm'), null);
  });
});
