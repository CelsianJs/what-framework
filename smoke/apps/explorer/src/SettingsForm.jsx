// The publishing settings: 300 package fields and the scope, one useForm,
// validated as the user types, with a summary computed over every field.

import { useMemo, useState } from 'what-framework';
import { useForm } from 'what-framework/form';

import { FIELDS_PER_PACKAGE, LICENSES, PACKAGE_COUNT, defaultSettings, registry, settingsResolver } from './settings.js';

const renders = window.__form.renders;

function FieldError({ name, formState }) {
  return (
    <span class="field-error" data-error={name} role="alert">
      {() => {
        renders[name] = (renders[name] || 0) + 1;
        return formState.error(name)?.message || '';
      }}
    </span>
  );
}

function PackageRow({ i, register, formState }) {
  const cell = (field, input) => (
    <td>
      {input}
      <FieldError name={`${field}${i}`} formState={formState} />
    </td>
  );
  return (
    <tr data-package={i}>
      <th scope="row">{i + 1}</th>
      {cell('name', <input data-field={`name${i}`} aria-label={`Package ${i + 1} name`} {...register(`name${i}`)} />)}
      {cell('version', <input data-field={`version${i}`} aria-label={`Package ${i + 1} version`} {...register(`version${i}`)} />)}
      {cell('license', (
        <select data-field={`license${i}`} aria-label={`Package ${i + 1} license`} {...register(`license${i}`)}>
          {LICENSES.map((l) => <option value={l}>{l}</option>)}
        </select>
      ))}
      {cell('budget', <input type="number" data-field={`budget${i}`} aria-label={`Package ${i + 1} size budget in KB`} {...register(`budget${i}`)} />)}
      {cell('owner', <input type="email" data-field={`owner${i}`} aria-label={`Package ${i + 1} owner`} {...register(`owner${i}`)} />)}
      {cell('notes', <textarea rows="1" data-field={`notes${i}`} aria-label={`Package ${i + 1} notes`} {...register(`notes${i}`)} />)}
    </tr>
  );
}

export function SettingsForm() {
  const { register, handleSubmit, formState } = useForm({
    defaultValues: defaultSettings(),
    mode: 'onChange',
    resolver: settingsResolver,
  });
  const [saved, setSaved] = useState(null);

  const summary = useMemo(() => {
    const values = formState.values;
    let filled = 0;
    let budget = 0;
    const licenses = {};
    for (let i = 0; i < PACKAGE_COUNT; i++) {
      for (const f of FIELDS_PER_PACKAGE) if (String(values[`${f}${i}`] ?? '') !== '') filled++;
      const kb = Number(values[`budget${i}`]);
      if (Number.isFinite(kb)) budget += kb;
      licenses[values[`license${i}`]] = (licenses[values[`license${i}`]] || 0) + 1;
    }
    return { filled, budget, licenses };
  });

  const save = handleSubmit((values) => setSaved({ at: new Date().toISOString(), packages: PACKAGE_COUNT, scope: values.scope }));

  return (
    <section class="pane form-pane">
      <header class="pane-head">
        <h2>Publishing</h2>
        <span class="muted">{PACKAGE_COUNT * FIELDS_PER_PACKAGE.length} package fields</span>
      </header>
      <form onSubmit={save} novalidate>
        <div class="scope">
          <label for="scope">Scope</label>
          <span class="at">@</span>
          <input id="scope" data-field="scope" {...register('scope')} />
          <span class="checking" data-validating>{formState.isValidating() ? 'checking…' : ''}</span>
          <FieldError name="scope" formState={formState} />
        </div>
        <dl class="summary" data-summary>
          <div><dt>Filled</dt><dd data-sum-filled>{summary().filled}</dd></div>
          <div><dt>Errors</dt><dd data-sum-errors>{Object.keys(formState.errors).length}</dd></div>
          <div><dt>Total budget</dt><dd data-sum-budget>{`${summary().budget.toLocaleString('en-US')} KB`}</dd></div>
          <div><dt>Licenses</dt><dd data-sum-licenses>{LICENSES.map((l) => `${l} ${summary().licenses[l] || 0}`).join(' · ')}</dd></div>
        </dl>
        <div class="table-scroll">
          <table class="packages">
            <thead>
              <tr><th>#</th><th>Name</th><th>Version</th><th>License</th><th>Budget (KB)</th><th>Owner</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {Array.from({ length: PACKAGE_COUNT }, (_, i) => <PackageRow i={i} register={register} formState={formState} />)}
            </tbody>
          </table>
        </div>
        <footer class="form-foot">
          <button type="submit" data-save disabled={formState.isSubmitting()}>Save settings</button>
          <span class="muted" data-saved>{saved() ? `Saved ${saved().packages} packages under @${saved().scope}` : ''}</span>
          <span class="muted" data-lookups>{() => `${registry.lookups} registry lookups`}</span>
        </footer>
      </form>
    </section>
  );
}
