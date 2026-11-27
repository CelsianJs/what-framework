// Step 2: the address. The state list is loaded from the server for the
// country chosen (the United Kingdom has none, so its state field goes
// away), the postal code's format depends on the country, and the mailing
// street is asked for only when the mailing address differs. Errors show as
// the visitor types.

import { useQuery } from 'what-framework/data';

import { COUNTRIES, REGIONS } from '../data.js';
import { addressResolver } from '../validation.js';
import { fieldError, previousStepPath, useStepForm } from '../step-form.js';
import { Link } from 'what-router';

async function fetchRegions({ queryKey, signal }) {
  const res = await fetch(`/api/regions?country=${queryKey[1]}`, { signal });
  return (await res.json()).regions;
}

export function AddressStep() {
  const form = useStepForm('address', {
    defaults: (d) => ({ ...d.address }),
    collect: (v) => ({
      country: v.country, region: v.region, city: v.city, postal: v.postal,
      mailingDiffers: !!v.mailingDiffers, mailingStreet: v.mailingStreet,
    }),
    resolver: addressResolver,
    mode: 'onChange',
  });
  const { register, formState } = form;
  const country = form.watch('country');
  const differs = form.watch('mailingDiffers');
  const regions = useQuery({ queryKey: () => ['regions', country()], queryFn: fetchRegions, staleTime: 60_000 });

  // A new country takes a new state and a new postal format: the state is
  // cleared, and the fields that depend on the country are judged again
  // once the visitor has seen their errors.
  const countryField = register('country');
  const onCountry = (e) => {
    countryField.onchange(e);
    form.setValue('region', '');
    if (formState.error('postal') || form.getValue('postal')) form.validate('postal');
    if (formState.error('region')) form.validate('region');
  };

  const field = (name, label, input) => (
    <div class="field" data-field-wrap={name}>
      <label for={`f-${name}`}>{label}</label>
      {input}
      <span class="field-error" data-error={name} role="alert">{fieldError(form, name)}</span>
    </div>
  );

  return (
    <form data-step-form="address" onSubmit={form.next} novalidate>
      <h2>Where you live</h2>
      <div class="grid two">
        {field('country', 'Country', (
          <select id="f-country" {...countryField} onchange={onCountry}>
            {COUNTRIES.map((c) => <option value={c.code}>{c.name}</option>)}
          </select>
        ))}
        {REGIONS[country()]
          ? field('region', 'State or province', (
            <select id="f-region" {...register('region')} disabled={regions.isLoading()} data-regions-for={regions.data() ? country() : ''}>
              <option value="">{regions.isLoading() ? 'Loading…' : 'Choose…'}</option>
              {(regions.data() || []).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          ))
          : <div class="field muted" data-no-region>No state needed</div>}
      </div>
      <div class="grid two">
        {field('city', 'City', <input id="f-city" autocomplete="address-level2" {...register('city')} />)}
        {field('postal', 'Postal code', <input id="f-postal" autocomplete="postal-code" {...register('postal')} />)}
      </div>
      <label class="check">
        <input type="checkbox" data-field="mailingDiffers" {...register('mailingDiffers', { type: 'checkbox' })} />
        My mailing address is different
      </label>
      {differs()
        ? field('mailingStreet', 'Mailing street', <input id="f-mailingStreet" autocomplete="street-address" {...register('mailingStreet')} />)
        : null}
      <footer class="actions">
        <Link href={previousStepPath('address')} data-back>Back</Link>
        <button type="submit" class="primary" data-next>Next</button>
      </footer>
    </form>
  );
}
