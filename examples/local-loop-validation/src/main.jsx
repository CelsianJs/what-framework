import { mount, useSignal, useForm, simpleResolver, rules, ErrorMessage } from 'what-framework';

function App() {
  const count = useSignal(0);
  const checked = useSignal(false);
  const html = useSignal('<strong>safe html</strong>');

  const form = useForm({
    mode: 'onChange',
    defaultValues: { name: '' },
    resolver: simpleResolver({
      name: [rules.required('Name required')],
    }),
  });

  return (
    <main>
      <h1>Loop Validation</h1>

      <label>
        Step: <input value={count()} onInput={(e) => count(Number(e.target.value) || 0)} />
      </label>

      <label>
        <input type="checkbox" checked={checked()} onInput={(e) => checked(e.target.checked)} />
        Checked now: {checked() ? 'yes' : 'no'}
      </label>

      <section innerHTML={html()} />
      <section dangerouslySetInnerHTML={{ __html: html() }} />

      <form onSubmit={form.handleSubmit(() => {})}>
        <input {...form.register('name')} placeholder="name" />
        <ErrorMessage name="name" formState={form.formState} />
        <button type="submit">Submit</button>
      </form>
    </main>
  );
}

mount(<App />, '#app');
