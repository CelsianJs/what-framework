import {
  mount,
  useSignal,
  useForm,
  simpleResolver,
  rules,
  ErrorMessage,
} from 'what-framework';

function App() {
  const submitted = useSignal(null);
  const form = useForm({
    mode: 'onChange',
    defaultValues: {
      name: '',
      email: '',
      message: '',
    },
    resolver: simpleResolver({
      name: [rules.required('Name is required'), rules.minLength(2, 'Name is too short')],
      email: [rules.required('Email is required'), rules.email('Email is invalid')],
      message: [rules.required('Message is required'), rules.minLength(10, 'At least 10 chars')],
    }),
  });

  const submit = form.handleSubmit(
    (values) => submitted(values),
    () => submitted(null)
  );

  return (
    <main className="app-shell">
      <h1>App 04: Forms</h1>
      <p>`formState.errors` is a getter object; `ErrorMessage` reads from it directly.</p>

      <form onSubmit={submit} className="grid">
        <label>
          Name
          <input {...form.register('name')} />
          <ErrorMessage name="name" formState={form.formState} />
        </label>

        <label>
          Email
          <input type="email" {...form.register('email')} />
          <ErrorMessage name="email" formState={form.formState} />
        </label>

        <label>
          Message
          <textarea rows="4" {...form.register('message')} />
          <ErrorMessage name="message" formState={form.formState} />
        </label>

        <div className="row">
          <button type="submit" disabled={!form.formState.isValid() || form.formState.isSubmitting()}>
            Submit
          </button>
          <button type="button" onClick={() => form.reset()}>
            Reset
          </button>
        </div>
      </form>

      <section className="state-grid">
        <article>
          <h2>Errors</h2>
          <pre>{JSON.stringify(form.formState.errors, null, 2)}</pre>
        </article>
        <article>
          <h2>Submitted</h2>
          <pre>{JSON.stringify(submitted(), null, 2)}</pre>
        </article>
      </section>
    </main>
  );
}

mount(<App />, '#app');
