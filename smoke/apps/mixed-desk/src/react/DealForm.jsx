// A new-deal form on react-hook-form. A valid submit hands the values to the
// native page, which adds the deal to the store.
import { useForm } from 'react-hook-form';
import { useProbe } from './probe.js';

export function DealForm({ onCreate }) {
  useProbe('deal-form');
  const { register, handleSubmit, reset, formState: { errors, submitCount } } = useForm({
    defaultValues: { name: '', desk: 'Rates', notional: '' },
  });
  const submit = handleSubmit((values) => {
    onCreate({ name: values.name, desk: values.desk, notional: Number(values.notional) });
    reset();
  });
  return (
    <form className="deal-form" data-deal-form onSubmit={submit} noValidate>
      <label>Name <input data-df-name {...register('name', { required: 'A deal needs a name' })} /></label>
      {errors.name && <span role="alert" data-df-error="name">{errors.name.message}</span>}
      <label>Desk
        <select data-df-desk {...register('desk')}>
          <option>Rates</option><option>Credit</option><option>FX</option><option>Equities</option>
        </select>
      </label>
      <label>Notional <input data-df-notional inputMode="decimal" {...register('notional', { required: 'Notional is required', validate: (v) => Number(v) > 0 || 'Notional must be positive' })} /></label>
      {errors.notional && <span role="alert" data-df-error="notional">{errors.notional.message}</span>}
      <button type="submit" data-df-submit>Book deal</button>
      <span data-df-submits>{submitCount}</span>
    </form>
  );
}
