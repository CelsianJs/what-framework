// Step 3: the vehicles, a field array (useFieldArray). Each vehicle is a row
// keyed by its field's id, whose fields are named by its place
// (`vehicles.0.vin`): a row is built once, and its fields keep their vehicle,
// its element and its focus when rows are added, removed or reordered
// around it. Alt+ArrowUp and Alt+ArrowDown move the row being edited; its
// menu (which closes on a click outside it) duplicates or removes it.

import { flushSync, onCleanup, useEffect, useState } from 'what-framework';
import { useFieldArray } from 'what-framework/form';
import { Link } from 'what-router';

import { MAKES, USAGES, emptyVehicle, newId } from '../data.js';
import { vehiclesResolver } from '../validation.js';
import { fieldError, previousStepPath, problemCount, useStepForm } from '../step-form.js';
import { countBinding, probes } from '../probes.js';

const MAX_VEHICLES = 6;

// A row's place now: the index it was built at goes stale when rows move.
export const placeOf = (fields, field) => () => fields().findIndex((f) => f.id === field.id);

export function focusIn(selector) {
  queueMicrotask(() => document.querySelector(selector)?.focus());
}

// Runs a reorder and keeps the field being edited focused, with its caret. A
// row the framework moves with moveBefore keeps it on its own (Chromium,
// Firefox); where the browser has no moveBefore (WebKit) the move blurs the
// field, and the focus is put back (counted).
export function keepFocus(reorder) {
  const active = document.activeElement;
  const caret = active && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  reorder();
  flushSync();
  if (active && active !== document.activeElement && active.isConnected) {
    probes.focusRestored++;
    active.focus();
    if (caret) active.setSelectionRange(caret[0], caret[1]);
  }
}

// Moves the item at `at` by `by` places, when there is room.
export function moveBy(array, at, by) {
  const to = at + by;
  if (at !== -1 && to >= 0 && to < array.fields.peek().length) keepFocus(() => array.move(at, to));
}

// A row's menu, open until a click lands outside it. The listener on the
// document lives exactly as long as the menu is open: removing the row from
// its own menu must take the listener with it.
export function RowMenu({ label, actions }) {
  const [open, setOpen] = useState(false);
  let box;
  useEffect(() => {
    if (!open()) return undefined;
    const outside = (e) => { if (box && !box.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });
  return (
    <div class="row-menu" ref={(el) => { box = el; }}>
      <button type="button" class="link" aria-haspopup="menu" aria-expanded={open() ? 'true' : 'false'} data-menu-toggle onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open()
        ? <div role="menu" class="menu" data-menu>{actions.map((a) => (
          <button type="button" role="menuitem" data-menu-action={a.name} onClick={() => { setOpen(false); a.run(); }}>{a.label}</button>
        ))}</div>
        : null}
    </div>
  );
}

// `id` is the vehicle's own id in the draft, which the page's test hooks
// (data-vehicle, data-error) carry; field.id is the row's key.
function VehicleRow({ field, index, array, form, onRemove, onDuplicate }) {
  const id = form.getValue(`vehicles.${index}.id`);
  probes.created.vehicle++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.vehicle++; probes.effectsLive--; });
  const { register } = form;
  const place = placeOf(array.fields, field);
  const onMove = (by) => moveBy(array, place(), by);
  const onKeyDown = (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(e.key === 'ArrowUp' ? -1 : 1);
  };
  const cell = (f, label, input) => (
    <div class="field">
      <label for={`f-${id}-${f}`}>{label}</label>
      {input}
      <span class="field-error" data-error={`vehicles.${id}.${f}`} role="alert">{fieldError(form, () => `vehicles.${place()}.${f}`, () => countBinding(id))}</span>
    </div>
  );
  const name = (f) => `vehicles.${index}.${f}`;
  return (
    <fieldset class="item" data-vehicle={id} onKeyDown={onKeyDown}>
      <legend>
        <span data-vehicle-number>{() => `Vehicle ${place() + 1}`}</span>
        <RowMenu label="Vehicle" actions={[
          { name: 'up', label: 'Move up', run: () => onMove(-1) },
          { name: 'down', label: 'Move down', run: () => onMove(1) },
          { name: 'duplicate', label: 'Duplicate', run: () => onDuplicate(place()) },
          { name: 'remove', label: 'Remove', run: () => onRemove(place()) },
        ]} />
      </legend>
      <div class="grid three">
        {cell('year', 'Year', <input id={`f-${id}-year`} type="number" inputmode="numeric" {...register(name('year'))} />)}
        {cell('make', 'Make', (
          <select id={`f-${id}-make`} {...register(name('make'))}>
            <option value="">Choose…</option>
            {MAKES.map((m) => <option value={m}>{m}</option>)}
          </select>
        ))}
        {cell('model', 'Model', <input id={`f-${id}-model`} {...register(name('model'))} />)}
      </div>
      <div class="grid two">
        {cell('vin', 'VIN', <input id={`f-${id}-vin`} class="mono" maxlength="17" {...register(name('vin'))} />)}
        {cell('miles', 'Miles a year', <input id={`f-${id}-miles`} type="number" {...register(name('miles'))} />)}
      </div>
      <div class="field" role="radiogroup" aria-label="Used for">
        <span class="label">Used for</span>
        <div class="radios">
          {USAGES.map((u) => (
            <label class="check">
              <input type="radio" data-usage={u.value} {...register(name('usage'), { type: 'radio', value: u.value })} />
              {u.label}
            </label>
          ))}
        </div>
        <span class="field-error" data-error={`vehicles.${id}.usage`} role="alert">{fieldError(form, () => `vehicles.${place()}.usage`)}</span>
      </div>
    </fieldset>
  );
}

export function VehiclesStep() {
  const form = useStepForm('vehicles', {
    defaults: (d) => ({ vehicles: d.vehicles }),
    collect: (values) => values.vehicles,
    resolver: vehiclesResolver,
    mode: 'onChange',
  });
  const array = useFieldArray({ control: form.control, name: 'vehicles' });
  const { fields } = array;

  const add = (from) => {
    if (fields.peek().length >= MAX_VEHICLES) return;
    const id = newId('v');
    if (from === undefined) array.append(emptyVehicle(id));
    else array.insert(from + 1, { ...form.getValue(`vehicles.${from}`), id });
    focusIn(`[data-vehicle="${id}"] [name$=".year"]`);
  };
  const remove = (at) => {
    const ids = form.getValue('vehicles').map((v) => v.id);
    array.remove(at);
    const next = ids[at + 1] ?? ids[at - 1];
    if (next) focusIn(`[data-vehicle="${next}"] [data-menu-toggle]`);
    else focusIn('[data-add-vehicle]');
  };

  return (
    <form data-step-form="vehicles" onSubmit={form.next} novalidate>
      <h2>Your vehicles</h2>
      <p class="muted">Up to {MAX_VEHICLES}. Alt+↑ and Alt+↓ move the vehicle you are editing.</p>
      <div class="items" data-vehicles>
        {fields().map((field, index) => <VehicleRow key={field.id} field={field} index={index} array={array} form={form} onRemove={remove} onDuplicate={add} />)}
      </div>
      <span class="field-error" data-error="vehicles" role="alert">{fieldError(form, 'vehicles')}</span>
      <p class="field-error" data-step-problems>{problemCount(form)}</p>
      <button type="button" data-add-vehicle onClick={() => add()} disabled={fields().length >= MAX_VEHICLES}>Add a vehicle</button>
      <footer class="actions">
        <Link href={previousStepPath('vehicles')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
