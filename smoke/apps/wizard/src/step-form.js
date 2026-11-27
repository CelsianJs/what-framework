// One step's form. Each step is its own route and its own useForm, built
// from the draft when the step mounts: the draft is what carries the answers
// across back, forward and a reload. As the visitor types, the step writes
// its answers back to the draft (draft.js saves them once typing pauses).
// Next validates the whole step and moves on only when it is valid.

import { onCleanup, onMount, useEffect } from 'what-framework';
import { useForm } from 'what-framework/form';
import { navigate } from 'what-router';

import { draft, flush, markDone, patch, serverErrors, steps } from './draft.js';
import { probes } from './probes.js';

export const stepPath = (id) => `/quote/${id}`;

export function nextStepPath(id) {
  const list = steps.peek();
  const at = list.findIndex((s) => s.id === id);
  return stepPath(list[at + 1]?.id ?? 'review');
}

export function previousStepPath(id) {
  const list = steps.peek();
  const at = list.findIndex((s) => s.id === id);
  return at > 0 ? stepPath(list[at - 1].id) : null;
}

function focusField(name) {
  const el = document.querySelector(`[data-step-form] [name="${CSS.escape(name)}"]`);
  if (el) el.focus();
}

export function useStepForm(id, { defaults, collect, resolver, mode = 'onChange', beforeNext }) {
  probes.created.step++;
  onCleanup(() => { probes.disposed.step++; });

  const form = useForm({ defaultValues: defaults(draft.peek()), mode, reValidateMode: 'onChange', resolver });
  const values = form.watch();
  useEffect(() => { patch(id, collect(values())); });

  // An error the server found in this step: shown on its field, which gets
  // the focus, until the visitor edits it.
  onMount(() => {
    const mine = serverErrors.peek().filter((e) => e.step === id);
    if (mine.length === 0) return;
    for (const e of mine) form.setError(e.name, { type: 'server', message: e.message });
    serverErrors(serverErrors.peek().filter((e) => e.step !== id));
    focusField(mine[0].name);
  });

  const next = form.handleSubmit(async (all) => {
    if (beforeNext) await beforeNext(all);
    patch(id, collect(all));
    markDone(id);
    flush();
    navigate(nextStepPath(id));
  }, (errors) => {
    const first = Object.keys(errors)[0];
    if (first) focusField(first);
  });

  return { ...form, next };
}

// useForm keeps every field it was ever told about, and has no way to forget
// one (React Hook Form's unregister): a removed array item's errors would
// stay in formState.errors and count against the step. Removing an item
// clears them; the item's values stay in the form, and collect() reads only
// the live items, so they never reach the draft.
export function forgetFields(form, prefix) {
  for (const name of Object.keys(form.formState.errors)) if (name.startsWith(prefix)) form.clearError(name);
}

// How many problems the step shows, for its summary.
export function problemCount(form) {
  return () => {
    const n = Object.keys(form.formState.errors).length;
    return n === 0 ? '' : `${n} ${n === 1 ? 'thing' : 'things'} to fix in this step`;
  };
}

// Field errors, read in JSX so each one follows its own field only.
export function fieldError(form, name, onRun) {
  return () => {
    if (onRun) onRun();
    return form.formState.error(name)?.message || '';
  };
}
