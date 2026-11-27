// Step 3: the vehicles, a field array. Each vehicle is a keyed row whose
// fields are named `vehicles.<id>.<field>`, so a row keeps its fields, its
// element and its focus when rows are added, removed or reordered around it.
// Alt+ArrowUp and Alt+ArrowDown move the row being edited; its menu (which
// closes on a click outside it) duplicates or removes it.

import { flushSync, onCleanup, useEffect, useSignal, useState } from 'what-framework';
import { Link } from 'what-router';

import { MAKES, USAGES, emptyVehicle, newId } from '../data.js';
import { draft } from '../draft.js';
import { VEHICLE_FIELDS, vehiclesResolver } from '../validation.js';
import { fieldError, forgetFields, previousStepPath, problemCount, useStepForm } from '../step-form.js';
import { countBinding, probes } from '../probes.js';

const MAX_VEHICLES = 6;

function flatten(list) {
  const out = {};
  for (const v of list) for (const f of VEHICLE_FIELDS) out[`vehicles.${v.id}.${f}`] = v[f];
  return out;
}

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

export function moveIn(list, id, by) {
  const at = list.indexOf(id);
  const to = at + by;
  if (at === -1 || to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(at, 1);
  next.splice(to, 0, id);
  return next;
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

function VehicleRow({ id, ids, form, onMove, onRemove, onDuplicate }) {
  probes.created.vehicle++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.vehicle++; probes.effectsLive--; });
  const { register } = form;
  const name = (f) => `vehicles.${id}.${f}`;
  const onKeyDown = (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    onMove(id, e.key === 'ArrowUp' ? -1 : 1);
  };
  const field = (f, label, input) => (
    <div class="field">
      <label for={`f-${name(f)}`}>{label}</label>
      {input}
      <span class="field-error" data-error={name(f)} role="alert">{fieldError(form, name(f), () => countBinding(id))}</span>
    </div>
  );
  return (
    <fieldset class="item" data-vehicle={id} onKeyDown={onKeyDown}>
      <legend>
        <span data-vehicle-number>{`Vehicle ${ids().indexOf(id) + 1}`}</span>
        <RowMenu label="Vehicle" actions={[
          { name: 'up', label: 'Move up', run: () => onMove(id, -1) },
          { name: 'down', label: 'Move down', run: () => onMove(id, 1) },
          { name: 'duplicate', label: 'Duplicate', run: () => onDuplicate(id) },
          { name: 'remove', label: 'Remove', run: () => onRemove(id) },
        ]} />
      </legend>
      <div class="grid three">
        {field('year', 'Year', <input id={`f-${name('year')}`} type="number" inputmode="numeric" {...register(name('year'))} />)}
        {field('make', 'Make', (
          <select id={`f-${name('make')}`} {...register(name('make'))}>
            <option value="">Choose…</option>
            {MAKES.map((m) => <option value={m}>{m}</option>)}
          </select>
        ))}
        {field('model', 'Model', <input id={`f-${name('model')}`} {...register(name('model'))} />)}
      </div>
      <div class="grid two">
        {field('vin', 'VIN', <input id={`f-${name('vin')}`} class="mono" maxlength="17" {...register(name('vin'))} />)}
        {field('miles', 'Miles a year', <input id={`f-${name('miles')}`} type="number" {...register(name('miles'))} />)}
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
        <span class="field-error" data-error={name('usage')} role="alert">{fieldError(form, name('usage'))}</span>
      </div>
    </fieldset>
  );
}

export function VehiclesStep() {
  const initial = draft.peek().vehicles;
  const ids = useSignal(initial.map((v) => v.id));
  const form = useStepForm('vehicles', {
    defaults: () => flatten(initial),
    collect: (values) => ids().map((id) => {
      const v = { id };
      for (const f of VEHICLE_FIELDS) v[f] = values[`vehicles.${id}.${f}`] ?? '';
      return v;
    }),
    resolver: vehiclesResolver(() => ids.peek()),
    mode: 'onChange',
  });

  const add = (from) => {
    if (ids.peek().length >= MAX_VEHICLES) return;
    const id = newId('v');
    const seed = from ? { ...collectOne(form, from), id } : emptyVehicle(id);
    for (const f of VEHICLE_FIELDS) form.setValue(`vehicles.${id}.${f}`, seed[f], { shouldDirty: false });
    const list = ids.peek();
    ids(from ? [...list.slice(0, list.indexOf(from) + 1), id, ...list.slice(list.indexOf(from) + 1)] : [...list, id]);
    focusIn(`[name="vehicles.${id}.year"]`);
  };
  const remove = (id) => {
    const list = ids.peek();
    const at = list.indexOf(id);
    ids(list.filter((x) => x !== id));
    forgetFields(form, `vehicles.${id}.`);
    const next = list[at + 1] ?? list[at - 1];
    if (next) focusIn(`[data-vehicle="${next}"] [data-menu-toggle]`);
    else focusIn('[data-add-vehicle]');
  };
  const move = (id, by) => keepFocus(() => ids(moveIn(ids.peek(), id, by)));

  return (
    <form data-step-form="vehicles" onSubmit={form.next} novalidate>
      <h2>Your vehicles</h2>
      <p class="muted">Up to {MAX_VEHICLES}. Alt+↑ and Alt+↓ move the vehicle you are editing.</p>
      <div class="items" data-vehicles>
        {ids().map((id) => <VehicleRow key={id} id={id} ids={ids} form={form} onMove={move} onRemove={remove} onDuplicate={(v) => add(v)} />)}
      </div>
      <span class="field-error" data-error="vehicles" role="alert">{fieldError(form, 'vehicles')}</span>
      <p class="field-error" data-step-problems>{problemCount(form)}</p>
      <button type="button" data-add-vehicle onClick={() => add()} disabled={ids().length >= MAX_VEHICLES}>Add a vehicle</button>
      <footer class="actions">
        <Link href={previousStepPath('vehicles')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}

function collectOne(form, id) {
  const v = { id };
  for (const f of VEHICLE_FIELDS) v[f] = form.getValue(`vehicles.${id}.${f}`);
  return v;
}
