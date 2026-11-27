// Step 6: coverage. A zod schema with a cross-field rule (the end date after
// the start date, within a year): a change to the start date judges the end
// date again. The comprehensive deductible is asked for only with
// comprehensive cover.

import { Link } from 'what-router';

import { ADDONS, DEDUCTIBLES, LIMITS } from '../data.js';
import { coverageResolver } from '../validation.js';
import { fieldError, previousStepPath, useStepForm } from '../step-form.js';

export function CoverageStep() {
  const form = useStepForm('coverage', {
    defaults: (d) => ({ ...d.coverage }),
    collect: (v) => ({
      start: v.start, end: v.end, limit: v.limit, deductible: v.deductible,
      roadside: !!v.roadside, rental: !!v.rental, glass: !!v.glass,
    }),
    resolver: coverageResolver,
    mode: 'onChange',
  });
  const { register, formState } = form;
  const start = register('start');
  const onStart = (e) => {
    start.onchange(e);
    if (form.getValue('end')) form.validate('end');
  };
  const field = (name, label, input) => (
    <div class="field">
      <label for={`f-${name}`}>{label}</label>
      {input}
      <span class="field-error" data-error={name} role="alert">{fieldError(form, name)}</span>
    </div>
  );
  return (
    <form data-step-form="coverage" onSubmit={form.next} novalidate>
      <h2>Coverage</h2>
      <div class="grid two">
        {field('start', 'Starts', <input id="f-start" type="date" {...start} onchange={onStart} />)}
        {field('end', 'Ends', <input id="f-end" type="date" {...register('end')} />)}
      </div>
      <div class="field" role="radiogroup" aria-label="Liability limit">
        <span class="label">Liability limit (thousands)</span>
        <div class="radios">
          {LIMITS.map((l) => (
            <label class="check"><input type="radio" data-limit={l} {...register('limit', { type: 'radio', value: l })} /> {l}</label>
          ))}
        </div>
      </div>
      {field('deductible', 'Deductible', (
        <select id="f-deductible" {...register('deductible')}>
          {DEDUCTIBLES.map((d) => <option value={d}>{`$${d}`}</option>)}
        </select>
      ))}
      <fieldset class="addons">
        <legend>Add-ons</legend>
        {ADDONS.map((a) => (
          <label class="check"><input type="checkbox" data-addon={a.name} {...register(a.name, { type: 'checkbox' })} /> {a.label}</label>
        ))}
      </fieldset>
      <p class="muted" data-addon-count>{() => {
        const n = ADDONS.filter((a) => formState.values[a.name]).length;
        return n === 0 ? 'No add-ons' : `${n} add-on${n === 1 ? '' : 's'}`;
      }}</p>
      <footer class="actions">
        <Link href={previousStepPath('coverage')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
