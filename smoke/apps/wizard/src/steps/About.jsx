// Step 1: about you. A zod schema with the server's availability check on
// the email composed on top; errors show when a field is left (onBlur), and
// after a first Next, as the visitor types.

import { aboutResolver } from '../validation.js';
import { fieldError, useStepForm } from '../step-form.js';

export function AboutStep() {
  const form = useStepForm('about', {
    defaults: (d) => ({ ...d.about }),
    collect: (v) => ({ firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone, birthDate: v.birthDate }),
    resolver: aboutResolver,
    mode: 'onBlur',
  });
  const { register, formState } = form;
  const field = (name, label, input) => (
    <div class="field">
      <label for={`f-${name}`}>{label}</label>
      {input}
      <span class="field-error" data-error={name} role="alert">{fieldError(form, name)}</span>
    </div>
  );
  return (
    <form data-step-form="about" onSubmit={form.next} novalidate>
      <h2>About you</h2>
      <div class="grid two">
        {field('firstName', 'First name', <input id="f-firstName" autocomplete="given-name" {...register('firstName')} />)}
        {field('lastName', 'Last name', <input id="f-lastName" autocomplete="family-name" {...register('lastName')} />)}
      </div>
      {field('email', 'Email', <input id="f-email" type="email" autocomplete="email" {...register('email')} />)}
      <p class="muted" data-validating>{formState.isValidating() ? 'Checking…' : ''}</p>
      <div class="grid two">
        {field('phone', 'Phone', <input id="f-phone" type="tel" autocomplete="tel" {...register('phone')} />)}
        {field('birthDate', 'Date of birth', <input id="f-birthDate" type="date" {...register('birthDate')} />)}
      </div>
      <footer class="actions">
        <span />
        <button type="submit" class="primary" data-next disabled={formState.isSubmitting()}>Next</button>
      </footer>
    </form>
  );
}
