// Readers of the whole form (formState.values, watch(), dirtyFields,
// formState.touched) follow fields that come into being after they first ran.
//
// A form's summary is usually rendered above its fields, so it first runs
// before a single field is registered. It has to pick up every field
// registered after it, or it shows the defaults forever.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { useForm } = await import('../src/form.js');
const { computed } = await import('../src/reactive.js');

const edit = (registration, value) => registration.onchange({ type: 'input', target: { type: 'text', value } });

describe('whole-form readers and fields registered after them', () => {
  it('a summary over formState.values computed before the fields register follows their edits', () => {
    const form = useForm({ defaultValues: { a: '1', b: '2' } });
    const total = computed(() => {
      const values = form.formState.values;
      return Number(values.a) + Number(values.b);
    });
    assert.equal(total(), 3);

    const a = form.register('a');
    form.register('b');
    edit(a, '10');
    assert.equal(total(), 12);
  });

  it('watch() made before the fields register follows their edits', () => {
    const form = useForm({ defaultValues: { name: 'x' } });
    const all = form.watch();
    assert.equal(all().name, 'x');
    edit(form.register('name'), 'y');
    assert.equal(all().name, 'y');
  });

  it('dirtyFields read before a field registers marks it dirty after an edit', () => {
    const form = useForm({ defaultValues: { a: '' } });
    assert.deepEqual(form.formState.dirtyFields(), {});
    edit(form.register('a'), 'changed');
    assert.deepEqual(form.formState.dirtyFields(), { a: true });
  });

  it('formState.touched read before any blur follows the first blur', () => {
    const form = useForm({ defaultValues: { a: '', b: '' } });
    const touched = computed(() => Object.keys(form.formState.touched).sort().join(','));
    assert.equal(touched(), '');
    form.register('a').onBlur();
    assert.equal(touched(), 'a');
    form.register('b').onBlur();
    assert.equal(touched(), 'a,b');
  });

  it('a value set with setValue on a field never registered reaches formState.values', () => {
    const form = useForm({ defaultValues: { a: '1' } });
    const keys = computed(() => JSON.stringify(form.formState.values));
    assert.equal(keys(), '{"a":"1"}');
    form.setValue('hidden', 'h');
    assert.equal(keys(), '{"a":"1","hidden":"h"}');
  });

  it('a reader of one field does not run again when another field registers', () => {
    const form = useForm({ defaultValues: { a: '1', b: '2' } });
    let runs = 0;
    const a = computed(() => { runs++; return form.getValue('a'); });
    assert.equal(a(), '1');
    form.register('b');
    assert.equal(a(), '1');
    assert.equal(runs, 1);
  });
});
