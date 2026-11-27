// Step 4: the drivers, a field array whose items each hold a field array of
// their own (incidents). A driver's incidents are a useFieldArray of the
// driver's row, named by the driver's place when the row is built; it stays
// that driver's when the drivers move. An incident's date must fall after
// the driver was licensed, so changing that date judges the driver's
// incidents again. Errors show when a field is left (onBlur).

import { onCleanup } from 'what-framework';
import { useFieldArray } from 'what-framework/form';
import { Link } from 'what-router';

import { INCIDENT_KINDS, emptyDriver, emptyIncident, newId } from '../data.js';
import { driversResolver } from '../validation.js';
import { fieldError, previousStepPath, problemCount, useStepForm } from '../step-form.js';
import { countBinding, probes } from '../probes.js';
import { RowMenu, focusIn, moveBy, placeOf } from './Vehicles.jsx';

// Built when the incident is added, perhaps after its driver moved: its
// fields are named by the driver's place now, not the one it was built at.
function IncidentRow({ field, index, driverId, driverPlace, incidents, form }) {
  const prefix = `drivers.${driverPlace()}`;
  const id = form.getValue(`${prefix}.incidents.${index}.id`);
  probes.created.incident++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.incident++; probes.effectsLive--; });
  const { register } = form;
  const place = placeOf(incidents.fields, field);
  const name = (f) => `${prefix}.incidents.${index}.${f}`;
  const cell = (f, label, input) => (
    <div class="field">
      <label for={`f-${id}-${f}`}>{label}</label>
      {input}
      <span class="field-error" data-error={`drivers.${driverId}.incidents.${id}.${f}`} role="alert">
        {fieldError(form, () => `drivers.${driverPlace()}.incidents.${place()}.${f}`, () => countBinding(id))}
      </span>
    </div>
  );
  const remove = () => {
    incidents.remove(place());
    focusIn(`[data-incident="${id}"]`);
  };
  return (
    <div class="sub-item" data-incident={id}>
      <span class="muted" data-incident-number>{() => `Incident ${place() + 1}`}</span>
      <div class="grid three">
        {cell('date', 'Date', <input id={`f-${id}-date`} type="date" {...register(name('date'))} />)}
        {cell('kind', 'Kind', (
          <select id={`f-${id}-kind`} {...register(name('kind'))}>
            {INCIDENT_KINDS.map((k) => <option value={k}>{k}</option>)}
          </select>
        ))}
        <button type="button" class="link danger" data-remove-incident onClick={remove}>Remove</button>
      </div>
      {cell('detail', 'What happened', <textarea id={`f-${id}-detail`} rows="2" {...register(name('detail'))} />)}
    </div>
  );
}

function DriverRow({ field, index, array, form, onRemove }) {
  const prefix = `drivers.${index}`;
  const id = form.getValue(`${prefix}.id`);
  probes.created.driver++;
  probes.effectsLive++;
  onCleanup(() => { probes.disposed.driver++; probes.effectsLive--; });
  const { register } = form;
  const place = placeOf(array.fields, field);
  const incidents = useFieldArray({ control: form.control, name: `${prefix}.incidents` });

  const addIncident = () => {
    const i = newId('i');
    incidents.append(emptyIncident(i));
    focusIn(`[data-incident="${i}"] [name$=".date"]`);
  };
  // The incidents' dates are judged against this date: a change to it
  // judges again the ones the visitor has already seen judged.
  const since = register(`${prefix}.since`);
  const onSince = (e) => {
    since.onchange(e);
    incidents.fields.peek().forEach((_, j) => {
      const date = `drivers.${place()}.incidents.${j}.date`;
      if (form.formState.error(date) || form.formState.touched[date]) form.validate(date);
    });
  };
  const onKeyDown = (e) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    if (e.target.closest('[data-incident]')) return;
    e.preventDefault();
    moveBy(array, place(), e.key === 'ArrowUp' ? -1 : 1);
  };
  const cell = (f, label, input) => (
    <div class="field">
      <label for={`f-${id}-${f}`}>{label}</label>
      {input}
      <span class="field-error" data-error={`drivers.${id}.${f}`} role="alert">{fieldError(form, () => `drivers.${place()}.${f}`, () => countBinding(id))}</span>
    </div>
  );
  return (
    <fieldset class="item" data-driver={id} onKeyDown={onKeyDown}>
      <legend>
        <span data-driver-number>{() => `Driver ${place() + 1}`}</span>
        <RowMenu label="Driver" actions={[
          { name: 'up', label: 'Move up', run: () => moveBy(array, place(), -1) },
          { name: 'down', label: 'Move down', run: () => moveBy(array, place(), 1) },
          { name: 'remove', label: 'Remove', run: () => onRemove(place()) },
        ]} />
      </legend>
      <div class="grid three">
        {cell('name', 'Full name', <input id={`f-${id}-name`} {...register(`${prefix}.name`)} />)}
        {cell('license', 'License number', <input id={`f-${id}-license`} class="mono" {...register(`${prefix}.license`)} />)}
        {cell('since', 'Licensed since', <input id={`f-${id}-since`} type="date" {...since} onchange={onSince} />)}
      </div>
      <div class="sub-items" data-incidents>
        {incidents.fields().map((incident, i) => <IncidentRow key={incident.id} field={incident} index={i} driverId={id} driverPlace={place} incidents={incidents} form={form} />)}
      </div>
      <button type="button" class="link" data-add-incident onClick={addIncident}>Add an incident</button>
    </fieldset>
  );
}

export function DriversStep() {
  const form = useStepForm('drivers', {
    defaults: (d) => ({ drivers: d.drivers }),
    collect: (values) => values.drivers,
    resolver: driversResolver,
    mode: 'onBlur',
  });
  const array = useFieldArray({ control: form.control, name: 'drivers' });

  const add = () => {
    const id = newId('d');
    array.append(emptyDriver(id));
    focusIn(`[data-driver="${id}"] [name$=".name"]`);
  };
  const remove = (at) => {
    const ids = form.getValue('drivers').map((d) => d.id);
    array.remove(at);
    const next = ids[at + 1] ?? ids[at - 1];
    focusIn(next ? `[data-driver="${next}"] [data-menu-toggle]` : '[data-add-driver]');
  };

  return (
    <form data-step-form="drivers" onSubmit={form.next} novalidate>
      <h2>Who drives</h2>
      <div class="items" data-drivers>
        {array.fields().map((field, index) => <DriverRow key={field.id} field={field} index={index} array={array} form={form} onRemove={remove} />)}
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
