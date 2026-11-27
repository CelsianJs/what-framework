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
const { mount, flushSync } = await import('what-framework');

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
