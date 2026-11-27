// useForm forgets a field with unregister(name | names), as React Hook Form
// does: its value leaves formState.values and what handleSubmit hands over,
// its error leaves formState.errors (so isValid follows), its touched state
// goes, and a validation of it still in flight never lands. A field a
// condition hides, or one whose input unmounts with `shouldUnregister`, is
// forgotten the same way. An input that still shows the field keeps working:
// it shows the field's default, and the next edit brings the field back
// instead of being undone.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document } = installDOM();

const { useForm, useFieldArray } = await import('../src/form.js');
const { computed, createRoot, flushSync } = await import('../src/reactive.js');
const { h } = await import('../src/h.js');
const { mount } = await import('../src/dom.js');

const typed = (form, name, value) => form.register(name).onchange({ type: 'input', target: { type: 'text', value } });
const at = (values, name) => name.split('.').reduce((v, k) => v?.[k], values);

describe('useForm unregister', () => {
  it('forgets a removed item: its value, its error and its touched state', async () => {
    const form = useForm({
      mode: 'onChange',
      resolver: async (values, _ctx, options) => {
        const errors = {};
        for (const name of options?.names ?? Object.keys(values.items ?? {}).map((item) => `items.${item}.name`)) if (!at(values, name)) errors[name] = { type: 'required', message: 'Required' };
        return { values, errors };
      },
    });
    typed(form, 'items.a.name', 'kept');
    typed(form, 'items.b.name', 'x');
    typed(form, 'items.b.name', '');
    form.register('items.b.name').onBlur();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(form.formState.error('items.b.name')?.message, 'Required');
    assert.deepEqual(form.formState.touched, { 'items.b.name': true });

    form.unregister(['items.b.name']);
    assert.deepEqual(form.formState.values, { items: { a: { name: 'kept' } } });
    assert.equal(form.formState.error('items.b.name'), null);
    assert.deepEqual(form.formState.errors, {});
    assert.equal(form.formState.isValid(), true);
    assert.deepEqual(form.formState.touched, {});

    let submitted;
    await form.handleSubmit((values) => { submitted = values; })();
    assert.deepEqual(submitted, { items: { a: { name: 'kept' } } });
  });

  it('a validation of the field still in flight never lands after it', async () => {
    let answer;
    const form = useForm({
      mode: 'onChange',
      resolver: () => new Promise((resolve) => { answer = resolve; }),
    });
    typed(form, 'items.b.vin', 'BAD');
    form.unregister('items.b.vin');
    answer({ values: {}, errors: { 'items.b.vin': { type: 'format', message: 'Bad VIN' } } });
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(form.formState.errors, {});
    assert.equal(form.formState.isValidating(), false);
  });

  it('a whole-form validation in flight never lands on a field unregistered meanwhile', async () => {
    let answer;
    const form = useForm({ resolver: () => new Promise((resolve) => { answer = resolve; }) });
    typed(form, 'promo', 'X');
    typed(form, 'email', 'a@b');
    const valid = form.validate();
    form.unregister('promo');
    answer({ values: {}, errors: { promo: { message: 'Expired' }, email: { message: 'Bad' } } });
    assert.equal(await valid, false);
    assert.deepEqual(Object.keys(form.formState.errors), ['email']);
  });

  it('forgets a flat field and its default, and keeps what the options keep', () => {
    const form = useForm({ defaultValues: { name: 'Ann', promo: 'SPRING', note: 'n' } });
    form.register('promo');
    form.setError('promo', { message: 'Expired' });
    form.register('promo').onBlur();
    form.unregister('promo');
    assert.deepEqual(form.formState.values, { name: 'Ann', note: 'n' });
    form.reset();
    assert.deepEqual(form.formState.values, { name: 'Ann', note: 'n' }, 'the default went with the field');

    form.register('name');
    form.unregister('name', { keepDefaultValue: true });
    assert.deepEqual(form.formState.values, { note: 'n' }, 'the value leaves, its default stays');
    form.reset();
    assert.deepEqual(form.formState.values, { name: 'Ann', note: 'n' }, 'and reset() brings it back');

    form.register('note').onBlur();
    form.setError('note', { message: 'Too short' });
    form.unregister('note', { keepValue: true, keepError: true, keepTouched: true });
    assert.equal(form.formState.values.note, 'n');
    assert.equal(form.formState.error('note')?.message, 'Too short');
    assert.deepEqual(form.formState.touched, { note: true });
  });

  it('unregister() with no name forgets every field', () => {
    const form = useForm();
    typed(form, 'a', '1');
    typed(form, 'b.c', '2');
    form.unregister();
    assert.deepEqual(form.formState.values, {});
  });

  it('never changes the defaults or an appended item the app passed', () => {
    const defaults = { owner: 'Ann', address: { city: 'Lyon', zip: '69001' }, vehicles: [{ vin: 'A', extra: { x: 1 } }] };
    const snapshot = structuredClone(defaults);
    const form = useForm({ defaultValues: defaults });
    typed(form, 'owner', 'Bo');
    form.register('address.city');
    form.unregister(['owner', 'address.city', 'address.zip']);
    assert.deepEqual(defaults, snapshot);
    assert.deepEqual(form.formState.values, { vehicles: [{ vin: 'A', extra: { x: 1 } }] }, 'an emptied object goes too');
    const array = useFieldArray({ control: form.control, name: 'vehicles' });
    const item = { vin: 'B', extra: { x: 2 } };
    array.append(item);
    form.register('vehicles.1.extra.x');
    form.unregister('vehicles.1.extra.x');
    assert.deepEqual(item, { vin: 'B', extra: { x: 2 } });
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'A', extra: { x: 1 } }, { vin: 'B' }]);
    assert.deepEqual(defaults, snapshot);
  });

  it('a reader of the whole form and watch(name) follow the field going', () => {
    const form = useForm();
    typed(form, 'a', '1');
    typed(form, 'promo', 'X');
    const all = computed(() => JSON.stringify(form.formState.values));
    const promo = form.watch('promo');
    assert.equal(all(), '{"a":"1","promo":"X"}');
    assert.equal(promo(), 'X');
    form.unregister('promo');
    assert.equal(all(), '{"a":"1"}');
    assert.equal(promo(), '');
    typed(form, 'promo', 'Y');
    assert.equal(promo(), 'Y', 'watch() follows the field when it comes back');
    assert.equal(all(), '{"a":"1","promo":"Y"}');
  });

  it('an input still showing an unregistered field shows its default and keeps the next edits', () => {
    const form = useForm({ defaultValues: { title: '' } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mount(h('input', { ...form.register('title'), value: () => form.getValue('title') }), host);
    flushSync();
    const input = host.querySelector('input');
    input.value = 'draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    assert.equal(form.formState.values.title, 'draft');

    form.unregister('title');
    flushSync();
    assert.equal(input.value, '', 'the field is gone, so the input shows its default');
    assert.deepEqual(form.formState.values, {});

    for (const text of ['n', 'ne', 'new']) {
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      assert.equal(input.value, text, 'an edit after unregister is not undone');
    }
    assert.deepEqual(form.formState.values, { title: 'new' });
    dispose();
    host.remove();
  });

  it('shouldUnregister forgets a field when the scope that registered it goes', () => {
    const form = useForm({ defaultValues: { street: '' } });
    let dispose;
    createRoot((d) => {
      dispose = d;
      typed(form, 'mailing', 'yes');
      form.register('street', { shouldUnregister: true }).onchange({ type: 'input', target: { type: 'text', value: '1 Main St' } });
    });
    assert.equal(form.formState.values.street, '1 Main St');
    dispose();
    assert.deepEqual(form.formState.values, { mailing: 'yes' });

    const everyField = useForm({ shouldUnregister: true });
    createRoot((d) => { dispose = d; typed(everyField, 'a', '1'); });
    dispose();
    assert.deepEqual(everyField.formState.values, {});
  });

  it('a field inside <Show> registered with shouldUnregister leaves the values when hidden, and comes back from its default', async () => {
    const mod = await loadCompiled(`
      import { signal, Show } from 'what-framework';
      import { useForm } from 'what-framework/form';
      export const mailing = signal(true);
      export function Address({ expose }) {
        const form = useForm({ defaultValues: { city: 'Lyon', street: '1 Main St' } });
        expose(form);
        return <form>
          <input class="city" {...form.register('city')} />
          <Show when={mailing}><input class="street" {...form.register('street', { shouldUnregister: true })} /></Show>
        </form>;
      }
    `);
    const { mount: mountApp, flushSync: flush } = await import('what-framework');
    let form;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mountApp(mod.Address({ expose: (f) => { form = f; } }), host);
    flush();
    const street = () => host.querySelector('.street');
    street().value = '9 Side St';
    street().dispatchEvent(new Event('input', { bubbles: true }));
    flush();
    assert.deepEqual(form.formState.values, { city: 'Lyon', street: '9 Side St' });
    mod.mailing(false);
    flush();
    assert.equal(street(), null);
    assert.deepEqual(form.formState.values, { city: 'Lyon' });
    mod.mailing(true);
    flush();
    assert.equal(street().value, '1 Main St', 'shown again, the field starts from its default');
    assert.deepEqual(form.formState.values, { city: 'Lyon', street: '1 Main St' });
    dispose();
    host.remove();
  });
});
