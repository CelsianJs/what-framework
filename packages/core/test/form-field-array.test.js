// useFieldArray({ control | form, name }), React Hook Form's field array:
// fields() lists the items, each with a stable id for its row's key, and
// append, prepend, insert, remove, move, swap, update and replace change the
// list. An item's values, errors and touched state move with it, a removed
// item's state goes with it (and a validation of it in flight never lands),
// and a field registered in a row keeps the item it was registered for while
// rows move around it: components run once, so the row is not built again.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

const { document } = installDOM();

const { useForm, useFieldArray } = await import('what-framework/form');
const { mount, flushSync, signal, h, computed } = await import('what-framework');

const typed = (reg, value) => reg.onchange({ type: 'input', target: { type: 'text', value } });
const ids = (array) => array.fields().map((f) => f.id);

function setup(vehicles = [{ vin: 'A' }, { vin: 'B' }, { vin: 'C' }], options = {}) {
  const form = useForm({ defaultValues: { owner: 'Ann', vehicles }, ...options });
  const array = useFieldArray({ control: form.control, name: 'vehicles' });
  return { form, array };
}

describe('useFieldArray', () => {
  it('lists the items from the defaults, each with an id, and takes { form } as well as { control }', () => {
    const { form, array } = setup();
    assert.deepEqual(array.fields().map(({ vin }) => vin), ['A', 'B', 'C']);
    assert.equal(new Set(ids(array)).size, 3);
    const again = useFieldArray({ form, name: 'vehicles' });
    assert.deepEqual(ids(again), ids(array), 'one array per name and form');
  });

  it('append, prepend and insert add items whose values join the form', () => {
    const { form, array } = setup([{ vin: 'B' }]);
    array.append({ vin: 'D' });
    array.prepend({ vin: 'A' });
    array.insert(2, [{ vin: 'C1' }, { vin: 'C2' }]);
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'A' }, { vin: 'B' }, { vin: 'C1' }, { vin: 'C2' }, { vin: 'D' }]);
    assert.equal(form.getValue('vehicles.2.vin'), 'C1');
    assert.equal(form.formState.isDirty(), true);
  });

  it('move and swap carry each item\'s values, errors and touched state with it', () => {
    const { form, array } = setup();
    const regB = form.register('vehicles.1.vin');
    typed(regB, 'B!');
    regB.onBlur();
    form.setError('vehicles.1.vin', { message: 'B is wrong' });
    const before = ids(array);

    array.move(1, 2);
    assert.deepEqual(ids(array), [before[0], before[2], before[1]]);
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'A' }, { vin: 'C' }, { vin: 'B!' }]);
    assert.deepEqual(form.formState.errors, { 'vehicles.2.vin': { message: 'B is wrong' } });
    assert.equal(form.formState.error('vehicles.2.vin')?.message, 'B is wrong');
    assert.equal(form.formState.error('vehicles.1.vin'), null);
    assert.deepEqual(form.formState.touched, { 'vehicles.2.vin': true });
    assert.equal(regB.name, 'vehicles.2.vin', 'the registration follows its item');
    assert.equal(regB.value, 'B!');

    array.swap(0, 2);
    assert.deepEqual(form.formState.values.vehicles.map((v) => v.vin), ['B!', 'C', 'A']);
    assert.deepEqual(Object.keys(form.formState.errors), ['vehicles.0.vin']);
    typed(regB, 'B2');
    assert.equal(form.getValue('vehicles.0.vin'), 'B2', 'an edit lands on the item, wherever it is');
  });

  it('a reader that ran again since the last move still follows the next one', () => {
    const { form, array } = setup();
    const regB = form.register('vehicles.1.vin');
    const regC = form.register('vehicles.2.vin');
    const dirty = form.formState.dirtyFields;
    const errors = computed(() => form.formState.errors);
    const name = computed(() => regB.name);
    typed(regB, 'B!');
    form.setError('vehicles.1.vin', { message: 'B is wrong' });
    assert.deepEqual(dirty(), { 'vehicles.1.vin': true });
    assert.deepEqual(Object.keys(errors()), ['vehicles.1.vin']);
    assert.equal(name(), 'vehicles.1.vin');
    typed(regC, 'C!');
    assert.deepEqual(dirty(), { 'vehicles.1.vin': true, 'vehicles.2.vin': true }, 'ran again for the keystroke');

    array.move(1, 0);
    assert.deepEqual(dirty(), { 'vehicles.0.vin': true, 'vehicles.2.vin': true });
    assert.deepEqual(Object.keys(errors()), ['vehicles.0.vin']);
    assert.equal(name(), 'vehicles.0.vin');
    typed(regC, 'C2');
    array.swap(0, 2);
    assert.deepEqual(dirty(), { 'vehicles.0.vin': true, 'vehicles.2.vin': true });
    assert.deepEqual(Object.keys(errors()), ['vehicles.2.vin']);
    assert.equal(name(), 'vehicles.2.vin');
    assert.deepEqual(form.formState.values.vehicles.map((v) => v.vin), ['C2', 'A', 'B!']);
  });

  it('remove releases the item: its value, its error, its touched state', () => {
    const { form, array } = setup();
    const regB = form.register('vehicles.1.vin');
    regB.onBlur();
    form.setError('vehicles.1.vin', { message: 'bad' });
    array.remove(1);
    assert.deepEqual(form.formState.values, { owner: 'Ann', vehicles: [{ vin: 'A' }, { vin: 'C' }] });
    assert.deepEqual(form.formState.errors, {});
    assert.equal(form.formState.isValid(), true);
    assert.deepEqual(form.formState.touched, {});
    assert.equal(form.getValue('vehicles.1.vin'), 'C');
    array.remove([0, 1]);
    assert.deepEqual(form.formState.values.vehicles, []);
    array.append([{ vin: 'X' }, { vin: 'Y' }]);
    array.remove();
    assert.deepEqual(form.formState.values.vehicles, []);
  });

  it('a validation of a removed item still in flight never lands', async () => {
    const answers = [];
    const { form, array } = setup(undefined, { mode: 'onChange', resolver: () => new Promise((resolve) => answers.push(resolve)) });
    typed(form.register('vehicles.1.vin'), 'bad');
    const whole = form.validate();
    array.remove(1);
    for (const answer of answers) answer({ values: {}, errors: { 'vehicles.1.vin': { message: 'Bad VIN' } } });
    await whole;
    assert.deepEqual(form.formState.errors, {}, 'the answer was about the removed item, not the one now at index 1');
    assert.equal(form.formState.isValidating(), false);
  });

  it('update makes the item a new one with the values given; replace makes every item new', () => {
    const { form, array } = setup();
    const before = ids(array);
    typed(form.register('vehicles.1.vin'), 'edited');
    array.update(1, { vin: 'U', year: '2024' });
    assert.notEqual(ids(array)[1], before[1]);
    assert.equal(ids(array)[0], before[0]);
    assert.deepEqual(form.formState.values.vehicles[1], { vin: 'U', year: '2024' });
    array.replace([{ vin: 'R' }]);
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'R' }]);
    assert.ok(!before.includes(ids(array)[0]));
  });

  it('a field array inside an item follows the item and goes with it', () => {
    const form = useForm({ defaultValues: { drivers: [{ name: 'Ann', incidents: [{ kind: 'Theft' }] }, { name: 'Bo', incidents: [] }] } });
    const drivers = useFieldArray({ control: form.control, name: 'drivers' });
    const annIncidents = useFieldArray({ control: form.control, name: 'drivers.0.incidents' });
    annIncidents.append({ kind: 'Speeding' });
    typed(form.register('drivers.0.incidents.1.detail'), '80 in a 50');
    drivers.swap(0, 1);
    assert.deepEqual(form.formState.values.drivers, [
      { name: 'Bo', incidents: [] },
      { name: 'Ann', incidents: [{ kind: 'Theft' }, { kind: 'Speeding', detail: '80 in a 50' }] },
    ]);
    annIncidents.remove(0);
    assert.deepEqual(form.getValue('drivers.1.incidents'), [{ kind: 'Speeding', detail: '80 in a 50' }]);
    drivers.remove(1);
    assert.deepEqual(form.formState.values.drivers, [{ name: 'Bo', incidents: [] }]);
  });

  // Removing items forgets them in one pass over the form's fields, not one
  // pass per item: counted as the key comparisons made, which a pass per
  // item multiplies by the number of items removed.
  it('removing many items compares each of the form\'s keys a fixed number of times', () => {
    const comparisons = (count) => {
      const form = useForm({ defaultValues: { rows: Array.from({ length: count }, (_, i) => ({ a: 'a' + i, b: 'b' + i, sub: [{ c: i }] })) } });
      const rows = useFieldArray({ control: form.control, name: 'rows' });
      for (let i = 0; i < count; i++) {
        typed(form.register(`rows.${i}.a`), 'x');
        form.register(`rows.${i}.b`).onBlur();
        form.setError(`rows.${i}.a`, { type: 'x', message: 'x' });
        useFieldArray({ control: form.control, name: `rows.${i}.sub` });
      }
      const startsWith = String.prototype.startsWith;
      let calls = 0;
      String.prototype.startsWith = function (...args) {
        calls++;
        return startsWith.apply(this, args);
      };
      try {
        if (count % 2) rows.remove();
        else rows.replace([{ a: 'new' }]);
      } finally {
        String.prototype.startsWith = startsWith;
      }
      assert.deepEqual(form.formState.values.rows, count % 2 ? [] : [{ a: 'new' }]);
      assert.deepEqual(form.formState.errors, {});
      assert.deepEqual(form.formState.touched, {});
      return calls;
    };
    for (const count of [301, 300]) assert.ok(comparisons(count) < 30 * count, `${comparisons(count)} comparisons for ${count} items`);
  });

  // Their errors leave the form's errors in one write, not one copy of the
  // errors per field: timed against removing the same items with no errors,
  // in the same run, so a slow machine slows both.
  it('removing many items with errors takes about as long as removing them without', () => {
    const removal = (withErrors) => {
      const form = useForm({ defaultValues: { rows: Array.from({ length: 600 }, (_, i) => ({ a: 'a' + i, b: 'b' + i })) } });
      const rows = useFieldArray({ control: form.control, name: 'rows' });
      for (let i = 0; i < 600; i++) {
        form.register(`rows.${i}.a`);
        if (withErrors) {
          form.setError(`rows.${i}.a`, { type: 'x', message: 'x' });
          form.setError(`rows.${i}.b`, { type: 'x', message: 'x' });
        }
      }
      form.setError('kept', { type: 'x', message: 'kept' });
      const start = performance.now();
      rows.remove();
      const ms = performance.now() - start;
      assert.deepEqual(form.formState.errors, { kept: { type: 'x', message: 'kept' } });
      assert.equal(form.formState.isValid(), false);
      return ms;
    };
    removal(true);
    const without = removal(false);
    const withErrors = removal(true);
    assert.ok(withErrors < 20 * without + 50, `${withErrors.toFixed(1)} ms with errors, ${without.toFixed(1)} ms without`);
  });

  it('setValue on the array\'s name replaces its items; watch(name) keeps the item it was given', () => {
    const { form, array } = setup();
    const b = form.watch('vehicles.1.vin');
    array.swap(1, 2);
    assert.equal(b(), 'B', 'watch() took the name once and follows its item');
    assert.equal(form.watch('vehicles.1.vin')(), 'C');
    form.setError('vehicles.0.vin', { message: 'old' });
    const before = ids(array);
    form.setValue('vehicles', [{ vin: 'X' }, { vin: 'Y' }]);
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'X' }, { vin: 'Y' }]);
    assert.deepEqual(array.fields().map((f) => f.vin), ['X', 'Y']);
    assert.ok(ids(array).every((id) => !before.includes(id)), 'new items');
    assert.deepEqual(form.formState.errors, {}, 'the old items went with their errors');
    assert.equal(form.getValue('vehicles.1.vin'), 'Y');
  });

  it('unregister on the array\'s name removes its items, and the array takes new ones', () => {
    const { form, array } = setup();
    typed(form.register('vehicles.0.vin'), 'edited');
    form.setError('vehicles.1.vin', { message: 'bad' });
    form.unregister('vehicles');
    assert.deepEqual(form.formState.values, { owner: 'Ann', vehicles: [] });
    assert.deepEqual(array.fields(), []);
    assert.deepEqual(form.formState.errors, {});
    array.append({ vin: 'N' });
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'N' }]);

    const kept = setup(undefined, { shouldUnregister: true });
    kept.form.unregister('vehicles');
    kept.array.append({ vin: 'K' });
    assert.deepEqual(kept.form.formState.values.vehicles, [{ vin: 'K' }], 'a form that keeps defaults shows the new items too');
    kept.form.reset();
    assert.deepEqual(kept.form.formState.values.vehicles, [{ vin: 'A' }, { vin: 'B' }, { vin: 'C' }]);
  });

  it('reset gives the array its items from the defaults again', () => {
    const { form, array } = setup();
    array.remove(0);
    typed(form.register('vehicles.0.vin'), 'changed');
    form.reset();
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'A' }, { vin: 'B' }, { vin: 'C' }]);
    form.reset({ vehicles: [{ vin: 'N' }] });
    assert.deepEqual(array.fields().map((f) => f.vin), ['N']);
    assert.equal(form.getValue('vehicles.0.vin'), 'N');
  });

  it('outlives the component that first used it: a step shown later takes its items on', () => {
    const step = signal(1);
    let form;
    let later;
    function Drivers() {
      useFieldArray({ control: form.control, name: 'vehicles' });
      return h('p', null, 'drivers');
    }
    function Review() {
      later = useFieldArray({ control: form.control, name: 'vehicles' });
      return h('p', null, 'review');
    }
    function Wizard() {
      form = useForm({ defaultValues: { vehicles: [{ vin: 'A' }] } });
      return h('div', null, () => (step() === 1 ? h(Drivers) : h(Review)));
    }
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mount(h(Wizard), host);
    flushSync();
    step(2);
    flushSync();
    later.append({ vin: 'B' });
    const vin = form.register('vehicles.1.vin');
    typed(vin, 'B!');
    assert.equal(vin.name, 'vehicles.1.vin');
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'A' }, { vin: 'B!' }]);
    later.move(1, 0);
    assert.equal(vin.name, 'vehicles.0.vin');
    assert.deepEqual(form.formState.values.vehicles, [{ vin: 'B!' }, { vin: 'A' }]);
    dispose();
    host.remove();
  });
});

describe('useFieldArray rows', () => {
  const moved = [];
  let realInsertBefore;
  before(() => {
    // jsdom has no moveBefore (Chromium and Firefox move a focused row with
    // it and keep its focus); this one records the rows it moves.
    realInsertBefore = Node.prototype.insertBefore;
    Element.prototype.moveBefore = function moveBefore(node, ref) {
      moved.push(node);
      return realInsertBefore.call(this, node, ref);
    };
  });
  after(() => { delete Element.prototype.moveBefore; });

  it('rows keyed by field.id keep their elements, and their fields keep their item, across move and swap', async () => {
    const mod = await loadCompiled(`
      import { useForm, useFieldArray } from 'what-framework/form';
      export function Vehicles({ expose }) {
        const form = useForm({ defaultValues: { vehicles: [{ vin: 'A' }, { vin: 'B' }, { vin: 'C' }] } });
        const { fields, move, swap, remove } = useFieldArray({ control: form.control, name: 'vehicles' });
        expose({ form, move, swap, remove });
        return <ul>{fields().map((field, index) => (
          <li key={field.id} data-id={field.id}>
            <input {...form.register(\`vehicles.\${index}.vin\`)} />
            <span>{() => form.formState.error(\`vehicles.\${fields().findIndex((f) => f.id === field.id)}.vin\`)?.message ?? ''}</span>
          </li>
        ))}</ul>;
      }
    `);
    let api;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mount(mod.Vehicles({ expose: (x) => { api = x; } }), host);
    flushSync();
    const rows = () => [...host.querySelectorAll('li')];
    const inputs = () => rows().map((li) => li.querySelector('input'));
    const [rowA, rowB, rowC] = rows();
    assert.deepEqual(inputs().map((i) => [i.name, i.value]), [['vehicles.0.vin', 'A'], ['vehicles.1.vin', 'B'], ['vehicles.2.vin', 'C']]);

    const b = inputs()[1];
    b.focus();
    b.value = 'B!';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    api.form.setError('vehicles.1.vin', { message: 'check B' });
    flushSync();

    api.move(1, 0);
    flushSync();
    assert.deepEqual(rows(), [rowB, rowA, rowC], 'the rows are the same elements, moved');
    assert.ok(moved.includes(rowB) || moved.includes(rowA), 'moved with moveBefore');
    assert.deepEqual(inputs().map((i) => [i.name, i.value]), [['vehicles.0.vin', 'B!'], ['vehicles.1.vin', 'A'], ['vehicles.2.vin', 'C']]);
    assert.equal(rows()[0].querySelector('span').textContent, 'check B', 'the error follows the item');
    assert.equal(rows()[1].querySelector('span').textContent, '');

    api.swap(0, 2);
    flushSync();
    assert.deepEqual(rows(), [rowC, rowA, rowB]);
    assert.deepEqual(inputs().map((i) => i.name), ['vehicles.0.vin', 'vehicles.1.vin', 'vehicles.2.vin']);
    assert.deepEqual(api.form.formState.values.vehicles.map((v) => v.vin), ['C', 'A', 'B!']);
    b.value = 'B!!';
    b.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    assert.equal(b.value, 'B!!', 'an edit in a moved row is kept');
    assert.equal(api.form.getValue('vehicles.2.vin'), 'B!!');

    api.remove(2);
    flushSync();
    assert.deepEqual(rows(), [rowC, rowA]);
    assert.deepEqual(api.form.formState.errors, {});
    dispose();
    host.remove();
  });

  it('fields() keeps each item\'s object, so a component row keyed by field.id is built once', async () => {
    const mod = await loadCompiled(`
      import { useForm, useFieldArray } from 'what-framework/form';
      export const built = [];
      function Row({ field, index, form }) {
        built.push(field.id);
        return <li><input {...form.register(\`items.\${index}.title\`)} /></li>;
      }
      export function List({ expose }) {
        const form = useForm({ defaultValues: { items: [{ title: 'a' }, { title: 'b' }] } });
        const array = useFieldArray({ form, name: 'items' });
        expose(array);
        return <ul>{array.fields().map((field, index) => <Row key={field.id} field={field} index={index} form={form} />)}</ul>;
      }
    `);
    let array;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mount(mod.List({ expose: (x) => { array = x; } }), host);
    flushSync();
    const first = array.fields();
    array.append({ title: 'c' });
    array.swap(0, 2);
    array.move(1, 0);
    array.remove(1);
    flushSync();
    assert.equal(mod.built.length, 3, 'one build per item');
    assert.ok(array.fields().includes(first[1]), 'the same object for the same item');
    assert.deepEqual([...host.querySelectorAll('input')].map((i) => i.value), ['b', 'a']);
    dispose();
    host.remove();
  });

  it('the radios of moved rows keep their choice as their groups are renamed', async () => {
    const mod = await loadCompiled(`
      import { useForm, useFieldArray } from 'what-framework/form';
      export function Usage({ expose }) {
        const form = useForm({ defaultValues: { vehicles: [{ usage: 'business' }, { usage: 'commute' }, { usage: 'business' }] } });
        const array = useFieldArray({ form, name: 'vehicles' });
        expose({ form, array });
        return <form>{array.fields().map((field, index) => (
          <fieldset key={field.id}>
            {['commute', 'business'].map((u) => <input key={u} type="radio" data-u={u} {...form.register(\`vehicles.\${index}.usage\`, { type: 'radio', value: u })} />)}
          </fieldset>
        ))}</form>;
      }
    `);
    let api;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const dispose = mount(mod.Usage({ expose: (x) => { api = x; } }), host);
    flushSync();
    const shown = () => [...host.querySelectorAll('fieldset')].map((f) => {
      const checked = [...f.querySelectorAll('input')].filter((i) => i.checked);
      return checked.length === 1 ? `${checked[0].name}=${checked[0].dataset.u}` : `${checked.length} checked`;
    });
    const held = () => api.form.formState.values.vehicles.map((v, i) => `vehicles.${i}.usage=${v.usage}`);
    assert.deepEqual(shown(), held());
    for (const op of [() => api.array.swap(0, 1), () => api.array.move(0, 2), () => api.array.move(2, 0), () => api.array.remove(0), () => api.array.prepend({ usage: 'commute' })]) {
      op();
      flushSync();
      assert.deepEqual(shown(), held());
    }
    dispose();
    host.remove();
  });
});
