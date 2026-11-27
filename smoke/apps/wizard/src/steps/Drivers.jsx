// Step 4: the drivers, a field array whose items each hold an array of their
// own (incidents). An incident's date must fall after the driver was
// licensed, so changing that date judges the driver's incidents again.
// Errors show when a field is left (onBlur).

import { onCleanup, signal, useSignal } from 'what-framework';
import { Link } from 'what-router';

import { INCIDENT_KINDS, emptyDriver, emptyIncident, newId } from '../data.js';
import { draft } from '../draft.js';
import { DRIVER_FIELDS, INCIDENT_FIELDS, driversResolver } from '../validation.js';
import { fieldError, forgetFields, previousStepPath, problemCount, useStepForm } from '../step-form.js';
import { countBinding, probes } from '../probes.js';
import { RowMenu, focusIn, keepFocus, moveIn } from './Vehicles.jsx';

const dn = (d, f) => `drivers.${d}.${f}`;
const inc = (d, i, f) => `drivers.${d}.incidents.${i}.${f}`;

function IncidentRow({ driver, id, list, form, onRemove }) {
  probes.created.incident++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.incident++; probes.effectsLive--; });
  const { register } = form;
  const field = (f, label, input) => (
    <div class="field">
      <label for={`f-${inc(driver, id, f)}`}>{label}</label>
      {input}
      <span class="field-error" data-error={inc(driver, id, f)} role="alert">{fieldError(form, inc(driver, id, f), () => countBinding(id))}</span>
    </div>
  );
  return (
    <div class="sub-item" data-incident={id}>
      <span class="muted" data-incident-number>{`Incident ${list().indexOf(id) + 1}`}</span>
      <div class="grid three">
        {field('date', 'Date', <input id={`f-${inc(driver, id, 'date')}`} type="date" {...register(inc(driver, id, 'date'))} />)}
        {field('kind', 'Kind', (
          <select id={`f-${inc(driver, id, 'kind')}`} {...register(inc(driver, id, 'kind'))}>
            {INCIDENT_KINDS.map((k) => <option value={k}>{k}</option>)}
          </select>
        ))}
        <button type="button" class="link danger" data-remove-incident onClick={() => onRemove(id)}>Remove</button>
      </div>
      {field('detail', 'What happened', <textarea id={`f-${inc(driver, id, 'detail')}`} rows="2" {...register(inc(driver, id, 'detail'))} />)}
    </div>
  );
}

function DriverRow({ id, ids, incidentsOf, form, onMove, onRemove }) {
  probes.created.driver++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.driver++; probes.effectsLive--; });
  const { register } = form;
  const list = incidentsOf(id);

  const addIncident = () => {
    const i = newId('i');
    const seed = emptyIncident(i);
    for (const f of INCIDENT_FIELDS) form.setValue(inc(id, i, f), seed[f], { shouldDirty: false });
    list([...list.peek(), i]);
    focusIn(`[name="${inc(id, i, 'date')}"]`);
  };
  const removeIncident = (i) => {
    list(list.peek().filter((x) => x !== i));
    forgetFields(form, `drivers.${id}.incidents.${i}.`);
    focusIn(`[data-driver="${id}"] [data-add-incident]`);
  };
  // The incidents' dates are judged against this date: a change to it
  // judges again the ones the visitor has already seen judged.
  const since = register(dn(id, 'since'));
  const onSince = (e) => {
    since.onchange(e);
    for (const i of list.peek()) if (form.formState.error(inc(id, i, 'date')) || form.formState.touched[inc(id, i, 'date')]) form.validate(inc(id, i, 'date'));
  };
  const onKeyDown = (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (e.target.closest('[data-incident]')) return;
    e.preventDefault();
    onMove(id, e.key === 'ArrowUp' ? -1 : 1);
  };
  const field = (f, label, input) => (
    <div class="field">
      <label for={`f-${dn(id, f)}`}>{label}</label>
      {input}
      <span class="field-error" data-error={dn(id, f)} role="alert">{fieldError(form, dn(id, f), () => countBinding(id))}</span>
    </div>
  );
  return (
    <fieldset class="item" data-driver={id} onKeyDown={onKeyDown}>
      <legend>
        <span data-driver-number>{`Driver ${ids().indexOf(id) + 1}`}</span>
        <RowMenu label="Driver" actions={[
          { name: 'up', label: 'Move up', run: () => onMove(id, -1) },
          { name: 'down', label: 'Move down', run: () => onMove(id, 1) },
          { name: 'remove', label: 'Remove', run: () => onRemove(id) },
        ]} />
      </legend>
      <div class="grid three">
        {field('name', 'Full name', <input id={`f-${dn(id, 'name')}`} {...register(dn(id, 'name'))} />)}
        {field('license', 'License number', <input id={`f-${dn(id, 'license')}`} class="mono" {...register(dn(id, 'license'))} />)}
        {field('since', 'Licensed since', <input id={`f-${dn(id, 'since')}`} type="date" {...since} onchange={onSince} />)}
      </div>
      <div class="sub-items" data-incidents>
        {list().map((i) => <IncidentRow key={i} driver={id} id={i} list={list} form={form} onRemove={removeIncident} />)}
      </div>
      <button type="button" class="link" data-add-incident onClick={addIncident}>Add an incident</button>
    </fieldset>
  );
}

function flatten(list) {
  const out = {};
  for (const d of list) {
    for (const f of DRIVER_FIELDS) out[dn(d.id, f)] = d[f];
    for (const i of d.incidents) for (const f of INCIDENT_FIELDS) out[inc(d.id, i.id, f)] = i[f];
  }
  return out;
}

export function DriversStep() {
  const initial = draft.peek().drivers;
  const ids = useSignal(initial.map((d) => d.id));
  // Each driver's incident ids, its own signal, so adding an incident runs
  // that driver's list and nothing else.
  const incidents = new Map(initial.map((d) => [d.id, signal(d.incidents.map((i) => i.id))]));
  const incidentsOf = (id) => {
    if (!incidents.has(id)) incidents.set(id, signal([]));
    return incidents.get(id);
  };
  const live = () => ids.peek().map((id) => ({ id, incidents: incidentsOf(id).peek() }));

  const form = useStepForm('drivers', {
    defaults: () => flatten(initial),
    collect: (values) => ids().map((id) => {
      const d = { id };
      for (const f of DRIVER_FIELDS) d[f] = values[dn(id, f)] ?? '';
      d.incidents = incidentsOf(id)().map((i) => {
        const x = { id: i };
        for (const f of INCIDENT_FIELDS) x[f] = values[inc(id, i, f)] ?? '';
        return x;
      });
      return d;
    }),
    resolver: driversResolver(live),
    mode: 'onBlur',
  });

  const add = () => {
    const id = newId('d');
    const seed = emptyDriver(id);
    for (const f of DRIVER_FIELDS) form.setValue(dn(id, f), seed[f], { shouldDirty: false });
    ids([...ids.peek(), id]);
    focusIn(`[name="${dn(id, 'name')}"]`);
  };
  const remove = (id) => {
    const list = ids.peek();
    const at = list.indexOf(id);
    ids(list.filter((x) => x !== id));
    forgetFields(form, `drivers.${id}.`);
    const next = list[at + 1] ?? list[at - 1];
    focusIn(next ? `[data-driver="${next}"] [data-menu-toggle]` : '[data-add-driver]');
  };
  const move = (id, by) => keepFocus(() => ids(moveIn(ids.peek(), id, by)));

  return (
    <form data-step-form="drivers" onSubmit={form.next} novalidate>
      <h2>Who drives</h2>
      <div class="items" data-drivers>
        {ids().map((id) => <DriverRow key={id} id={id} ids={ids} incidentsOf={incidentsOf} form={form} onMove={move} onRemove={remove} />)}
      </div>
      <span class="field-error" data-error="drivers" role="alert">{fieldError(form, 'drivers')}</span>
      <p class="field-error" data-step-problems>{problemCount(form)}</p>
      <button type="button" data-add-driver onClick={add}>Add a driver</button>
      <footer class="actions">
        <Link href={previousStepPath('drivers')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
