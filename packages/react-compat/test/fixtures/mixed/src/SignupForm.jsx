// No react import, but it calls a React hook: a React file.
import { useForm } from 'react-hook-form';

export function SignupForm() {
  const { register, watch } = useForm({ defaultValues: { name: 'ada' } });
  const name = watch('name');
  return (
    <div>
      <input id="rhf" {...register('name')} />
      <span id="rhf-out">{name}</span>
    </div>
  );
}
