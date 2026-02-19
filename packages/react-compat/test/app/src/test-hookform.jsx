/**
 * Test: react-hook-form — the most popular React form library
 * 15.8M weekly downloads. Hooks-only API (useForm, useFieldArray).
 */
import { useForm } from 'react-hook-form';

export function HookFormTest() {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    defaultValues: { name: '', email: '', age: '' },
  });

  const nameValue = watch('name');

  const onSubmit = (data) => {
    console.log('[react-hook-form] submitted:', data);
  };

  return (
    <div>
      <form onsubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '400px' }}>
        <div>
          <input
            {...register('name', { required: 'Name is required' })}
            placeholder="Name"
            style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', width: '100%' }}
          />
          {errors.name && <span style={{ color: 'red', fontSize: '12px' }}>{errors.name.message}</span>}
        </div>
        <div>
          <input
            {...register('email', {
              required: 'Email is required',
              pattern: { value: /^\S+@\S+$/i, message: 'Invalid email' },
            })}
            placeholder="Email"
            style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', width: '100%' }}
          />
          {errors.email && <span style={{ color: 'red', fontSize: '12px' }}>{errors.email.message}</span>}
        </div>
        <div>
          <input
            {...register('age', {
              min: { value: 1, message: 'Min age is 1' },
              max: { value: 120, message: 'Max age is 120' },
            })}
            type="number"
            placeholder="Age"
            style={{ padding: '6px 10px', borderRadius: '4px', border: '1px solid #ccc', width: '100%' }}
          />
          {errors.age && <span style={{ color: 'red', fontSize: '12px' }}>{errors.age.message}</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="submit" style={{ padding: '6px 16px', borderRadius: '4px', border: 'none', background: '#3b82f6', color: 'white', cursor: 'pointer' }}>
            Submit
          </button>
          <button type="button" onclick={() => reset()} style={{ padding: '6px 16px', borderRadius: '4px', border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer' }}>
            Reset
          </button>
        </div>
        {nameValue && <p style={{ color: '#666', fontSize: '13px' }}>Watching name: "{nameValue}"</p>}
      </form>
      <p style={{ color: 'green' }} id="hookform-status">React Hook Form loaded OK</p>
    </div>
  );
}
