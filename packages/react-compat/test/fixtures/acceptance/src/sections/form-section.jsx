import { useState } from 'react';
import { useForm } from 'react-hook-form';

export function FormSection() {
  const { register, handleSubmit, formState: { errors } } = useForm();
  const [submitted, setSubmitted] = useState(null);

  return (
    <section id="form-section">
      <h2>4. react-hook-form</h2>
      <form onSubmit={handleSubmit((data) => setSubmitted(data.email))}>
        <input
          id="f-email"
          placeholder="email"
          {...register('email', {
            required: 'Email is required',
            pattern: { value: /@/, message: 'Must contain @' },
          })}
        />
        <button id="f-submit" type="submit">submit</button>
      </form>
      {errors.email && <p id="f-error" role="alert" className="error">{errors.email.message}</p>}
      {submitted && <p id="f-success" data-status="pass">submitted: {submitted}</p>}
    </section>
  );
}
