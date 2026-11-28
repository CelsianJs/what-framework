// The new-project wizard: three routes under one layout. Each step validates
// its own fields and writes them to the draft before moving on, so the
// browser's back and forward buttons, and a reload, find the answers again.

import { useState } from 'what-framework';
import { rules, simpleResolver, useForm } from 'what-framework/form';
import { invalidateQueries } from 'what-framework/data';
import { Link, navigate, route } from 'what-router';

import { createProject } from '../api.js';
import { useDraft } from '../state/draft.js';
import { useToasts } from '../state/toasts.js';

const STEPS = [
  { path: '/new/details', label: 'Details' },
  { path: '/new/team', label: 'Team' },
  { path: '/new/review', label: 'Review' },
];

export function WizardLayout({ query, children }) {
  // The layout's own state: whether the tips panel is open. It belongs to the
  // layout, not to a step, so it should hold while the steps change under it,
  // and while the query changes (`?help=keys` opens the shortcuts panel).
  const [tips, setTips] = useState(true);
  return (
    <section class="wizard" data-wizard>
      <div class="page-head">
        <h1>New project</h1>
        <button class="link" data-tips-toggle onClick={() => setTips((t) => !t)}>{tips() ? 'Hide tips' : 'Show tips'}</button>
      </div>
      {tips() ? <p class="tips muted" data-tips>Each step saves when you press Next. Back and forward keep your answers.</p> : null}
      <label class="muted">Scratch notes <input data-wizard-note placeholder="Only for you, not saved" /></label>
      {query.help === 'keys'
        ? <p class="tips muted" data-help>Enter moves to the next step. <button class="link" data-help-close onClick={() => navigate(route.path, { replace: true })}>Close</button></p>
        : <Link href="?help=keys" replace class="link" data-help-open>Shortcuts</Link>}
      <ol class="steps">
        {STEPS.map((s, i) => (
          <li class={route.path === s.path ? 'current' : ''} data-step={s.label.toLowerCase()} aria-current={route.path === s.path ? 'step' : undefined}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
      <div class="step-body">{children}</div>
    </section>
  );
}

function FieldError({ formState, name }) {
  return <>{() => formState.errors[name] && <span class="error" data-error={name}>{formState.errors[name].message}</span>}</>;
}

export function DetailsStep() {
  const store = useDraft();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: store.draft.name, owner: store.draft.owner, kind: store.draft.kind },
    resolver: simpleResolver({
      name: [rules.required('Give the project a name'), rules.minLength(3, 'At least 3 characters')],
      owner: [rules.required('Pick an owner')],
    }),
  });
  const next = handleSubmit((values) => {
    store.update(values);
    navigate('/new/team');
  });
  return (
    <form onSubmit={next} data-form="details" noValidate>
      <label>Name <input {...register('name')} data-field="name" /></label>
      <FieldError formState={formState} name="name" />
      <label>Owner
        <select {...register('owner')} data-field="owner">
          <option value="">Choose…</option>
          <option>Ana Ruiz</option>
          <option>Bo Lindqvist</option>
          <option>Chidi Obi</option>
        </select>
      </label>
      <FieldError formState={formState} name="owner" />
      <label>Kind
        <select {...register('kind')} data-field="kind">
          <option value="launch">Launch</option>
          <option value="research">Research</option>
          <option value="migration">Migration</option>
        </select>
      </label>
      <div class="actions"><button class="primary" type="submit" data-next>Next</button></div>
    </form>
  );
}

export function TeamStep() {
  const store = useDraft();
  const [problem, setProblem] = useState('');
  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: { email: '' },
    resolver: simpleResolver({ email: [rules.required('Enter an email'), rules.email('That is not an email address')] }),
  });
  const add = handleSubmit(({ email }) => {
    if (!store.draft.members.includes(email)) store.update({ members: [...store.draft.members, email] });
    setProblem('');
    reset({ email: '' });
  });
  const remove = (email) => store.update({ members: store.draft.members.filter((m) => m !== email) });
  const next = () => {
    if (store.draft.members.length === 0) { setProblem('Add at least one person'); return; }
    navigate('/new/review');
  };
  return (
    <div data-form="team">
      <form onSubmit={add} noValidate class="inline">
        <label>Invite <input {...register('email')} data-field="email" placeholder="name@company.com" /></label>
        <button type="submit" data-add-member>Add</button>
      </form>
      <FieldError formState={formState} name="email" />
      <ul class="members" data-members>
        {store.draft.members.map((m) => (
          <li key={m} data-member={m}>{m} <button class="link" onClick={() => remove(m)} aria-label={`Remove ${m}`}>×</button></li>
        ))}
      </ul>
      {problem() ? <p class="error" data-error="members">{problem()}</p> : null}
      <div class="actions">
        <Link href="/new/details" data-back>Back</Link>
        <button class="primary" data-next onClick={next}>Next</button>
      </div>
    </div>
  );
}

export function ReviewStep() {
  const store = useDraft();
  const toasts = useToasts();
  const [saving, setSaving] = useState(false);
  const create = async () => {
    setSaving(true);
    const project = await createProject(store.draft);
    await invalidateQueries(['projects']);
    store.reset();
    toasts.push(`Created ${project.name}`, 'success');
    navigate(`/projects/${project.id}`);
  };
  return (
    <div data-form="review">
      <dl class="review">
        <dt>Name</dt><dd data-review="name">{() => store.draft.name}</dd>
        <dt>Owner</dt><dd data-review="owner">{() => store.draft.owner}</dd>
        <dt>Kind</dt><dd data-review="kind">{() => store.draft.kind}</dd>
        <dt>Team</dt><dd data-review="members">{() => store.draft.members.join(', ')}</dd>
      </dl>
      <div class="actions">
        <Link href="/new/team" data-back>Back</Link>
        <button class="primary" data-create disabled={saving()} onClick={create}>{saving() ? 'Creating…' : 'Create project'}</button>
      </div>
    </div>
  );
}
