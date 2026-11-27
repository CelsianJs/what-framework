// Step 5, only when a vehicle is used for business. Errors show on Next, and
// after it as the visitor types.

import { Link } from 'what-router';

import { businessResolver } from '../validation.js';
import { fieldError, previousStepPath, useStepForm } from '../step-form.js';

export function BusinessStep() {
  const form = useStepForm('business', {
    defaults: (d) => ({ ...d.business }),
    collect: (v) => ({ company: v.company, ein: v.ein, fleet: v.fleet }),
    resolver: businessResolver,
    mode: 'onSubmit',
  });
  const { register } = form;
  const field = (name, label, input) => (
    <div class="field">
      <label for={`f-${name}`}>{label}</label>
      {input}
      <span class="field-error" data-error={name} role="alert">{fieldError(form, name)}</span>
    </div>
  );
  return (
    <form data-step-form="business" onSubmit={form.next} novalidate>
      <h2>Business use</h2>
      <p class="muted">A vehicle used for business is covered under the company.</p>
      {field('company', 'Company name', <input id="f-company" autocomplete="organization" {...register('company')} />)}
      <div class="grid two">
        {field('ein', 'EIN', <input id="f-ein" class="mono" placeholder="12-3456789" {...register('ein')} />)}
        {field('fleet', 'Fleet size', <input id="f-fleet" type="number" {...register('fleet')} />)}
      </div>
      <footer class="actions">
        <Link href={previousStepPath('business')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
