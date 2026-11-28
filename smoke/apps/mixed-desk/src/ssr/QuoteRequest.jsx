// A React form, rendered on the server inside a native page and hydrated in
// the browser: react-hook-form for the fields, useId for the label pairing,
// React state for the side toggle.
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';

export function QuoteRequest({ symbol, onRequest }) {
  const id = useId();
  const [side, setSide] = useState('buy');
  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { size: '' } });
  return (
    <form className="quote-request" data-qr onSubmit={handleSubmit((v) => onRequest({ symbol, side, size: Number(v.size) }))} noValidate>
      <label htmlFor={id} data-qr-label>Size</label>
      <input id={id} data-qr-size {...register('size', { required: 'Size is required' })} />
      {errors.size && <span role="alert" data-qr-error>{errors.size.message}</span>}
      <button type="button" data-qr-side onClick={() => setSide(side === 'buy' ? 'sell' : 'buy')}>{side}</button>
      <button type="submit" data-qr-submit>Request</button>
    </form>
  );
}
