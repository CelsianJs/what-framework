// useForm takes the form's values type, as react-hook-form's does: the submit
// handler, formState.values and reset() are typed by it, given as
// useForm<LoginValues>() or inferred from defaultValues. Without either, the
// values stay Record<string, any>.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { tscDiagnose } from '../../../scripts/lib/tsc-diagnose.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('useForm types the values it hands the submit handler', () => {
  const diags = tscDiagnose({
    writeRoot: HERE,
    compilerOptions: { lib: ['ES2022', 'DOM'], jsx: 'react-jsx', jsxImportSource: 'what-framework' },
    files: {
      'use-form-usage.tsx': `
        import { useForm, ErrorMessage, rules, simpleResolver } from 'what-framework/form';

        interface LoginValues { email: string; password: string }

        export function Login() {
          const { register, handleSubmit, formState, reset } = useForm<LoginValues>({
            defaultValues: { email: '' },
            resolver: simpleResolver({ email: [rules.required(), rules.email()] }),
          });
          const onSubmit = async (values: LoginValues) => { console.log(values.email.trim()); reset(); };
          const email: string = formState.values.email;
          // @ts-expect-error not a field of LoginValues
          formState.values.username;
          // @ts-expect-error reset takes the form's values
          reset({ email: 1 });
          return (
            <form onSubmit={handleSubmit(onSubmit)} data-email={email}>
              <input {...register('email')} />
              <ErrorMessage name="email" formState={formState} />
            </form>
          );
        }

        export function Inferred() {
          const { handleSubmit } = useForm({ defaultValues: { title: '', count: 0 } });
          return <form onSubmit={handleSubmit((values) => { const n: number = values.count; console.log(n, values.title.length); })} />;
        }

        export function Untyped() {
          const { handleSubmit, formState } = useForm();
          const anything: number = formState.values.whatever;
          return <form data-x={anything} onSubmit={handleSubmit((values) => console.log(values.whatever))} />;
        }
      `,
    },
  });
  assert.deepEqual(diags.map((d) => `${d.line}: TS${d.code}: ${d.message}`), []);
});
