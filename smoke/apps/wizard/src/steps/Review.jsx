// Step 8: review and submit. The quote is sent as a server action through
// useActionState: the draft and the license photo as one multipart form.
// The server validates it again; an error it finds is mapped back to its
// field, on its step, which the visitor is taken to.

import { useActionState } from 'what-framework';
import { Link, navigate } from 'what-router';

import { USAGES } from '../data.js';
import { draft, licenseFile, serverErrors, startOver } from '../draft.js';
import { previousStepPath, stepPath } from '../step-form.js';

export const lastQuote = { value: null };

async function submitQuote(_previous) {
  const body = new FormData();
  body.append('draft', JSON.stringify(draft.peek()));
  if (licenseFile.peek()) body.append('license', licenseFile.peek());
  const res = await fetch('/api/quote', { method: 'POST', body });
  const answer = await res.json();
  if (res.status === 422) {
    serverErrors(answer.errors);
    navigate(stepPath(answer.errors[0].step));
    return { errors: answer.errors };
  }
  lastQuote.value = answer;
  startOver();
  navigate('/done');
  return { quote: answer };
}

export function ReviewStep() {
  const [result, submit, pending] = useActionState(submitQuote, null);
  const d = draft.peek();
  const usage = (u) => USAGES.find((x) => x.value === u)?.label ?? u;
  return (
    <div data-step-form="review">
      <h2>Review your quote</h2>
      <dl class="review">
        <dt>Name</dt><dd data-review="name">{`${d.about.firstName} ${d.about.lastName}`}</dd>
        <dt>Email</dt><dd data-review="email">{d.about.email}</dd>
        <dt>Address</dt><dd data-review="address">{[d.address.city, d.address.region, d.address.postal, d.address.country].filter(Boolean).join(', ')}</dd>
        <dt>Vehicles</dt>
        <dd data-review="vehicles">{d.vehicles.map((v) => `${v.year} ${v.make} ${v.model} (${usage(v.usage)}, ${v.vin})`).join('; ')}</dd>
        <dt>Drivers</dt>
        <dd data-review="drivers">{d.drivers.map((x) => `${x.name}: ${x.incidents.length} incident${x.incidents.length === 1 ? '' : 's'}`).join('; ')}</dd>
        <dt>Coverage</dt><dd data-review="coverage">{`${d.coverage.start} to ${d.coverage.end}, ${d.coverage.limit}, $${d.coverage.deductible}`}</dd>
        <dt>License photo</dt><dd data-review="license">{licenseFile() ? licenseFile().name : 'not chosen'}</dd>
      </dl>
      {() => result()?.errors ? <p class="field-error" role="alert" data-submit-error>{result().errors[0].message}</p> : null}
      <footer class="actions">
        <Link href={previousStepPath('review')} data-back>Back</Link>
        <button type="button" class="primary" data-submit disabled={pending()} onClick={() => submit()}>{pending() ? 'Sending…' : 'Get my quote'}</button>
      </footer>
    </div>
  );
}
