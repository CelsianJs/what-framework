import { useEffect, useState } from 'react';
import { Controller, FormProvider, useFieldArray, useForm, useFormContext, useWatch } from 'react-hook-form';

function Stars({ value, onChange }) {
  return (
    <span>
      {[1, 2, 3].map((n) => (
        <button type="button" key={n} id={`h-star-${n}`} aria-pressed={value >= n} onClick={() => onChange(n)}>{value >= n ? '★' : '☆'}</button>
      ))}
    </span>
  );
}

function Preview() {
  const { control } = useFormContext();
  const name = useWatch({ control, name: 'name' });
  return <span id="h-watch">{name}</span>;
}

export default function Fixture() {
  const methods = useForm({ defaultValues: { name: '', email: '', rating: 0, tags: [{ value: 'one' }] }, mode: 'onSubmit' });
  const { register, handleSubmit, control, formState: { errors, isDirty, submitCount, touchedFields }, reset, setFocus, watch } = methods;
  const { fields, append, remove, swap } = useFieldArray({ control, name: 'tags' });
  const [sent, setSent] = useState('');
  const [more, setMore] = useState(false);
  const [edits, setEdits] = useState(0);
  // The documented way to react to changes: subscribe in an effect, unsubscribe in its cleanup.
  useEffect(() => {
    const subscription = watch((value, { name }) => { if (name === 'name') setEdits((n) => n + 1); });
    return () => subscription.unsubscribe();
  }, [watch]);
  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit((data) => setSent(JSON.stringify(data)))}>
        <input id="h-name" {...register('name', { required: 'name is required', minLength: { value: 3, message: 'too short' } })} />
        {errors.name && <span id="h-name-error">{errors.name.message}</span>}
        <input id="h-email" {...register('email', { pattern: { value: /^\S+@\S+$/, message: 'bad email' } })} />
        {errors.email && <span id="h-email-error">{errors.email.message}</span>}
        <Controller name="rating" control={control} rules={{ min: { value: 1, message: 'rate it' } }} render={({ field }) => <Stars value={field.value} onChange={field.onChange} />} />
        {errors.rating && <span id="h-rating-error">{errors.rating.message}</span>}
        <ul id="h-tags">
          {fields.map((field, i) => (
            <li key={field.id}>
              <input className="h-tag" {...register(`tags.${i}.value`)} />
              <button type="button" className="h-remove" onClick={() => remove(i)}>x</button>
            </li>
          ))}
        </ul>
        <button type="button" id="h-append" onClick={() => append({ value: 'new' })}>add tag</button>
        <button type="button" id="h-swap" onClick={() => swap(0, 1)}>swap the first two</button>
        <label><input type="checkbox" id="h-more" checked={more} onChange={(e) => setMore(e.target.checked)} /> more</label>
        {more ? <input id="h-nick" {...register('nick', { shouldUnregister: true })} /> : null}
        <button type="button" id="h-reset" onClick={() => reset()}>reset</button>
        <button type="button" id="h-focus" onClick={() => setFocus('email')}>focus email</button>
        <button type="submit" id="h-submit">submit</button>
        <span id="h-dirty">{String(isDirty)}</span>
        <span id="h-submits">{submitCount}</span>
        <span id="h-touched">{Object.keys(touchedFields).join(',')}</span>
        <span id="h-edits">{edits}</span>
        <Preview />
      </form>
      <pre id="h-sent">{sent}</pre>
    </FormProvider>
  );
}
