import {
  ErrorMessage,
  Input,
  useForm,
  rules,
  simpleResolver,
  useSignal,
} from 'what-framework';

export const page = {
  mode: 'client',
};

export default function FormsPage() {
  const submission = useSignal(null);

  const { register, handleSubmit, formState, watch, reset } = useForm({
    defaultValues: {
      name: '',
      email: '',
      role: '',
    },
    mode: 'onBlur',
    resolver: simpleResolver({
      name: [rules.required('Name is required')],
      email: [rules.required('Email is required'), rules.email('Use a valid email')],
      role: [rules.required('Role is required')],
    }),
  });

  const watchedName = watch('name');

  const onSubmit = handleSubmit((values) => {
    submission(values);
    reset();
  });

  return (
    <section>
      <h1 class="page-title">Form validation</h1>
      <p class="lead">Uses <code>useForm</code>, <code>rules</code>, and <code>ErrorMessage</code>.</p>

      <div class="card split-grid">
        <form class="stack-form" onSubmit={onSubmit} noValidate>
          <label class="field">
            <span>Name</span>
            <Input class="text-input" name="name" register={register} placeholder="Ada Lovelace" />
            <ErrorMessage name="name" formState={formState} />
          </label>

          <label class="field">
            <span>Email</span>
            <Input class="text-input" name="email" register={register} type="email" placeholder="ada@example.dev" />
            <ErrorMessage name="email" formState={formState} />
          </label>

          <label class="field">
            <span>Role</span>
            <Input class="text-input" name="role" register={register} placeholder="Staff Engineer" />
            <ErrorMessage name="role" formState={formState} />
          </label>

          <div class="button-row">
            <button class="btn btn-primary" type="submit">Submit</button>
            <button class="btn" type="button" onClick={() => reset()}>Reset</button>
          </div>
        </form>

        <aside class="panel">
          <h2>Live form state</h2>
          <p><strong>watch('name')</strong>: {watchedName() || '—'}</p>
          <p><strong>isDirty()</strong>: {String(formState.isDirty())}</p>
          <p><strong>isSubmitting()</strong>: {String(formState.isSubmitting())}</p>
          <p><strong>submitCount()</strong>: {formState.submitCount()}</p>

          <pre>{JSON.stringify(formState.errors, null, 2)}</pre>
        </aside>
      </div>

      {submission() && (
        <div class="card">
          <h2>Latest successful submit</h2>
          <pre>{JSON.stringify(submission(), null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
