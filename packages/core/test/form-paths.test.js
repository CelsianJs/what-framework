// A field's name is a path, as in React Hook Form: register('vehicles.0.vin')
// reads and writes values.vehicles[0].vin, so formState.values and what
// handleSubmit hands over are nested, and a schema resolver sees the arrays
// and objects it describes. Errors, touched and dirtyFields stay keyed by
// the field's name ('vehicles.0.vin'), which is how zodResolver and
// yupResolver report a nested issue. A name without a dot is a key, as
// before.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const { useForm, zodResolver, simpleResolver, rules } = await import('../src/form.js');

const typed = (form, name, value) => form.register(name).onchange({ type: 'input', target: { type: 'text', value } });

// zod's shape, as zodResolver reads it: parseAsync resolves the values or
// throws an error carrying `issues` with a path of keys and indices. This one
// reads the nested values the way z.object({ vehicles: z.array(...) }) does.
const vehiclesSchema = {
  seen: null,
  async parseAsync(values) {
    this.seen = values;
    const issues = [];
    if (!Array.isArray(values.vehicles)) issues.push({ code: 'invalid_type', path: ['vehicles'], message: 'Expected array' });
    else {
      values.vehicles.forEach((v, i) => {
        if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin)) issues.push({ code: 'custom', path: ['vehicles', i, 'vin'], message: '17 characters' });
        (v.drivers ?? []).forEach((d, j) => { if (!d.name) issues.push({ code: 'too_small', path: ['vehicles', i, 'drivers', j, 'name'], message: 'Enter a name' }); });
      });
    }
    if (issues.length) throw Object.assign(new Error('invalid'), { issues });
    return values;
  },
};

describe('useForm dotted names', () => {
  it('nests values by path, arrays where a segment is an index', async () => {
    const form = useForm({ defaultValues: { owner: 'Ann' } });
    typed(form, 'vehicles.0.vin', 'A');
    typed(form, 'vehicles.1.vin', 'B');
    typed(form, 'address.city', 'Paris');
    assert.deepEqual(form.formState.values, { owner: 'Ann', vehicles: [{ vin: 'A' }, { vin: 'B' }], address: { city: 'Paris' } });
    assert.equal(form.getValue('vehicles.1.vin'), 'B');
    assert.deepEqual(form.getValue('vehicles'), [{ vin: 'A' }, { vin: 'B' }], 'a name that holds fields reads them');
    let submitted;
    await form.handleSubmit((v) => { submitted = v; })();
    assert.deepEqual(submitted.vehicles, [{ vin: 'A' }, { vin: 'B' }]);
  });

  it('a field starts from its default at the path, and dirtyFields measures from it', () => {
    const defaults = { vehicles: [{ vin: 'V1', year: '2020' }], address: { city: 'Lyon' } };
    const form = useForm({ defaultValues: defaults });
    assert.equal(form.register('vehicles.0.vin').value, 'V1');
    assert.equal(form.getValue('address.city'), 'Lyon');
    typed(form, 'vehicles.0.vin', 'V2');
    assert.deepEqual(form.formState.values, { vehicles: [{ vin: 'V2', year: '2020' }], address: { city: 'Lyon' } });
    assert.deepEqual(form.formState.dirtyFields(), { 'vehicles.0.vin': true });
    assert.equal(defaults.vehicles[0].vin, 'V1', 'the defaults object is never written');
    form.reset();
    assert.equal(form.getValue('vehicles.0.vin'), 'V1');
  });

  it('zodResolver sees nested arrays and its errors land on the fields by name', async () => {
    const form = useForm({ resolver: zodResolver(vehiclesSchema) });
    typed(form, 'vehicles.0.vin', '1HGCM82633A004352');
    typed(form, 'vehicles.1.vin', 'short');
    typed(form, 'vehicles.1.drivers.0.name', '');
    let invalid;
    await form.handleSubmit(() => assert.fail('submitted'), (errors) => { invalid = errors; })();
    assert.deepEqual(vehiclesSchema.seen.vehicles, [{ vin: '1HGCM82633A004352' }, { vin: 'short', drivers: [{ name: '' }] }]);
    assert.deepEqual(Object.keys(invalid), ['vehicles.1.vin', 'vehicles.1.drivers.0.name']);
    assert.equal(form.formState.error('vehicles.1.vin')?.message, '17 characters');
    assert.equal(form.formState.errors['vehicles.1.drivers.0.name']?.message, 'Enter a name');
  });

  it('simpleResolver and rules.match read a dotted field at its path', async () => {
    const form = useForm({
      mode: 'onChange',
      resolver: simpleResolver({
        'account.password': [rules.minLength(4, 'Too short')],
        'account.confirm': [rules.match('account.password', 'Must match')],
      }),
    });
    typed(form, 'account.password', 'abc');
    typed(form, 'account.confirm', 'abcd');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(form.formState.error('account.password')?.message, 'Too short');
    assert.equal(form.formState.error('account.confirm')?.message, 'Must match');
    typed(form, 'account.password', 'abcd');
    typed(form, 'account.confirm', 'abcd');
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(form.formState.errors, {});
  });

  it('a name without a dot is the key it always was', () => {
    const form = useForm({ defaultValues: { email: 'a@b.c', count: 0 } });
    typed(form, 'email', 'x@y.z');
    form.setValue('hidden', 'h');
    assert.deepEqual(form.formState.values, { email: 'x@y.z', count: 0, hidden: 'h' });
    assert.equal(form.register('email').name, 'email');
  });
});
