// The new-project wizard: three routes under one layout. Each step validates
// its own fields and writes them to the draft before moving on. The draft is
// in a cookie, so a reload is rendered by the server with the answers in it.

import { useState } from 'what-framework';
import { rules, simpleResolver, useForm } from 'what-framework/form';
import { Link, navigate, route } from 'what-router';

import { useWorkspace } from '../workspace.js';

const STEPS = [
  { path: '/new/details', label: 'Details' },
  { path: '/new/team', label: 'Team' },
  { path: '/new/review', label: 'Review' },
];

export function WizardLayout({ children }) {
  // The layout's own state: whether the tips panel is open. It belongs to the
  // layout, not to a step, so it should hold while the steps change under it.
  const [tips, setTips] = useState(true);
  return (
    <section class="wizard" data-wizard>
      <div class="page-head">
        <h1>New project</h1>
        <button class="link" data-tips-toggle onClick={() => setTips((t) => !t)}>{tips() ? 'Hide tips' : 'Show tips'}</button>
      </div>
      {tips() ? <p class="tips muted" data-tips>Each step saves when you press Next. Back and forward keep your answers.</p> : null}
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
  const ws = useWorkspace();
  const draft = ws.draft();
  const { register, handleSubmit, formState } = useForm({
    defaultValues: { name: draft.name, owner: draft.owner, kind: draft.kind },
    resolver: simpleResolver({
      name: [rules.required('Give the project a name'), rules.minLength(3, 'At least 3 characters')],
      owner: [rules.required('Pick an owner')],
    }),
  });
  const next = handleSubmit((values) => {
    ws.updateDraft(values);
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
  const ws = useWorkspace();
  const [problem, setProblem] = useState('');
  const { register, handleSubmit, formState, reset } = useForm({
    defaultValues: { email: '' },
    resolver: simpleResolver({ email: [rules.required('Enter an email'), rules.email('That is not an email address')] }),
  });
  const add = handleSubmit(({ email }) => {
    const { members } = ws.draft();
    if (!members.includes(email)) ws.updateDraft({ members: [...members, email] });
    setProblem('');
    reset({ email: '' });
  });
  const remove = (email) => ws.updateDraft({ members: ws.draft().members.filter((m) => m !== email) });
  const next = () => {
    if (ws.draft().members.length === 0) { setProblem('Add at least one person'); return; }
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
        {ws.draft().members.map((m) => (
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
  const ws = useWorkspace();
  const [saving, setSaving] = useState(false);
  const create = async () => {
    setSaving(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ws.draft()),
    });
    const project = await res.json();
    ws.addProject(project);
    // Leave the review step before emptying the draft: emptied while the step
    // is on screen, the draft fails its guard, and the guard's redirect to
    // step one replaces this navigation (smoke/FINDINGS.md, R1).
    await navigate(`/projects/${project.id}`);
    ws.resetDraft();
  };
  return (
    <div data-form="review">
      <dl class="review">
        <dt>Name</dt><dd data-review="name">{() => ws.draft().name}</dd>
        <dt>Owner</dt><dd data-review="owner">{() => ws.draft().owner}</dd>
        <dt>Kind</dt><dd data-review="kind">{() => ws.draft().kind}</dd>
        <dt>Team</dt><dd data-review="members">{() => ws.draft().members.join(', ')}</dd>
      </dl>
      <div class="actions">
        <Link href="/new/team" data-back>Back</Link>
        <button class="primary" data-create disabled={saving()} onClick={create}>{saving() ? 'Creating…' : 'Create project'}</button>
      </div>
    </div>
  );
}
