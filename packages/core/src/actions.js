// What Framework - Actions: React 19's useActionState and useFormStatus, on
// the engine's transitions (docs/DATA.md).
//
// An action is an async function run inside a transition: everything its
// writes and refetches reach on screen commits together once it has finished
// and what it made fetch again has landed, and the optimistic overlays added
// in it drop in that same flush. A server action called from one (what-server
// action()) revalidates inside it, so the screen goes from the old data to
// the new in one commit.

import { signal, getOwner, onCleanup, _startTransition, _onCommit, _handleError, HANDLED } from './reactive.js';
import { createContext, useContext } from './hooks.js';

/**
 * React 19's useActionState: `[state, dispatch, isPending]`. `dispatch(payload)`
 * runs `action(previousState, payload)` inside a transition; dispatches queue,
 * each receiving the state the previous one returned. The new state commits
 * with the transition: in the same flush as the data its action revalidated.
 * `state` and `isPending` are accessors. An action that throws reaches the
 * nearest <ErrorBoundary>, and the dispatches queued behind it are dropped.
 * `permalink` is the URL a <Form> posts to before JavaScript has loaded.
 */
export function useActionState(action, initialState, permalink) {
  const state = signal(initialState);
  const open = signal(0);
  const owner = getOwner();
  /** @type {Set<any>} */
  const calls = new Set();
  if (owner !== null) onCleanup(() => { for (const call of calls) call.abandon(); });
  let latest = initialState;
  /** @type {Promise<void> | null} the last dispatch still running, if any */
  let queue = null;
  let generation = 0;

  const dispatch = (payload) => {
    const gen = generation;
    /** @type {any} */
    let tx = null;
    const before = queue;
    /** @type {() => void} */
    let done = () => {};
    const mine = queue = new Promise((resolve) => { done = resolve; });
    _startTransition(async () => {
      try {
        // With nothing queued the action starts at once, inside the
        // transition: an addOptimistic() before its first await belongs to it.
        if (before !== null) await before;
        if (gen !== generation) return;
        const next = await action(latest, payload);
        if (gen !== generation) return;
        latest = next;
        _onCommit(tx, () => state(next));
      } catch (err) {
        generation++;
        const left = _handleError(owner, err);
        if (left !== HANDLED) throw left;
      } finally {
        if (queue === mine) queue = null;
        done();
      }
    }, (t, call) => {
      tx = t;
      open((n) => n + 1);
      calls.add(call);
      _onCommit(t, () => {
        open((n) => n - 1);
        calls.delete(call);
      });
    }).catch((err) => {
      try { console.error('[what] Uncaught error in action:', err); } catch { /* no console */ }
    });
  };
  if (permalink !== undefined) dispatch.permalink = permalink;

  return [() => state(), dispatch, () => open() > 0];
}

// What useFormStatus() answers outside a <Form>.
const NO_FORM = /* @__PURE__ */ Object.freeze({
  pending: () => false,
  data: () => null,
  method: null,
  action: null,
});

/** @type {any} */
let formContext = null;

/** @internal The context a <Form> (what-server) provides its status in. */
export function _formStatusContext() {
  return formContext || (formContext = createContext(NO_FORM));
}

/**
 * React 19's useFormStatus: the submission of the <Form> this component is
 * rendered in. `pending()` is true from the submit until its transition
 * commits; `data()` is that submission's FormData (null when none is
 * pending); `method` and `action` are the form's. Outside a <Form>,
 * `pending()` is false and the rest null.
 */
export function useFormStatus() {
  return formContext === null ? NO_FORM : useContext(formContext);
}

/**
 * @internal A <Form>'s status: what useFormStatus() inside it reads, and
 * `submit(formData, run)`, which runs `run(formData)` for one submission as a
 * transition the status shows. Returns the transition's promise.
 */
export function _formStatus(method, action) {
  const pending = signal(0);
  const data = signal(/** @type {FormData | null} */ (null));
  return {
    pending: () => pending() > 0,
    data: () => data(),
    method,
    action,
    submit(formData, run) {
      return _startTransition(() => run(formData), (t) => {
        pending((n) => n + 1);
        data(formData);
        _onCommit(t, () => {
          pending((n) => n - 1);
          if (pending.peek() === 0) data(null);
        });
      });
    },
  };
}
