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
  /** @type {Set<any>} the transition calls of the dispatches still running */
  const calls = new Set();
  /** @type {Set<() => void>} how to stop waiting for each action still running */
  const waits = new Set();
  let latest = initialState;
  /** @type {Promise<void> | null} the last dispatch still running, if any */
  let queue = null;
  let generation = 0;
  // Once the owner is gone, every dispatch stops waiting: none of them
  // commits, the queued ones never run, and an action's promise that stays
  // pending holds nothing of the hook.
  if (owner !== null) {
    onCleanup(() => {
      generation++;
      for (const call of calls) call.abandon();
      for (const leave of waits) leave();
    });
  }

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
        if (gen !== generation) {
          failedIn.add(tx);
          return;
        }
        const [settled, leave] = untilLeft(action(latest, payload));
        waits.add(leave);
        const next = await settled;
        waits.delete(leave);
        if (gen !== generation) {
          failedIn.add(tx);
          return;
        }
        latest = next;
        _onCommit(tx, () => state(next));
      } catch (err) {
        generation++;
        failedIn.add(tx);
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

// What `value` settles to, and how to stop waiting for it: `leave()` settles
// the wait at once, and from then on the callbacks `value` holds reach
// nothing (they hold `wait`, which leave empties), so a promise that never
// settles keeps nothing of the dispatch waiting for it.
/** @returns {[Promise<any>, () => void]} */
function untilLeft(value) {
  const wait = { resolve: (_v) => {}, reject: (_e) => {} };
  const settled = new Promise((resolve, reject) => {
    wait.resolve = resolve;
    wait.reject = reject;
  });
  Promise.resolve(value).then((v) => wait.resolve(v), (err) => wait.reject(err));
  const leave = () => {
    const resolve = wait.resolve;
    wait.resolve = wait.reject = () => {};
    resolve(undefined);
  };
  return [settled, leave];
}

// The transitions a dispatch did not succeed in: its action threw, or was
// dropped behind one that did. A <Form> it ran in is not reset at the commit.
const failedIn = new WeakSet();

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
 * rendered in. `pending()` is true from a submit until its transition
 * commits; `data()` is the FormData of the latest submission still pending
 * (null when none is); `method` and `action` are the form's. Outside a
 * <Form>, `pending()` is false and the rest null.
 */
export function useFormStatus() {
  return formContext === null ? NO_FORM : useContext(formContext);
}

/**
 * @internal A <Form>'s status: what useFormStatus() inside it reads (`action`
 * is the form's action function, or null for a URL or an action id, as in
 * React), and `submit(formData, run, reset)`, which runs `run(formData)` for
 * one submission as a transition the status shows. As React 19 does for an
 * uncontrolled form, `reset()` runs when that transition commits, if what ran
 * in it succeeded: `run` did not reject and no useActionState dispatch in it
 * failed. Returns the transition's promise.
 */
export function _formStatus(method, action) {
  // The FormData of each submission still pending, oldest first.
  const pending = signal(/** @type {FormData[]} */ ([]));
  return {
    pending: () => pending().length > 0,
    data: () => pending().at(-1) ?? null,
    method,
    action: typeof action === 'function' ? action : null,
    submit(formData, run, reset) {
      return _startTransition(() => run(formData), (t, call) => {
        pending((list) => [...list, formData]);
        _onCommit(t, () => {
          pending((list) => list.filter((entry) => entry !== formData));
          if (!call.failed && !failedIn.has(t)) reset();
        });
      });
    },
  };
}
