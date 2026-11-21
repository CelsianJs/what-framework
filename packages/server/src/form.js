// What Framework - <Form>
//
// A real <form method="post">, so it submits with JavaScript disabled, that
// a mounted page runs as an action instead:
//
//   <Form action={createPost} redirect="/">
//     <input name="title" required />
//     <SubmitButton />            // useFormStatus().pending() inside it
//   </Form>
//
// `action` is a server action (what action() returns, or its id) or a client
// function such as the dispatch of useActionState. Without JavaScript the
// browser posts to the action endpoint (a server action) or to the
// dispatch's permalink, and the endpoint answers 303 to `redirect`. Mounted,
// the form handles its own submit: it runs the action with the form's data as
// a transition, the status useFormStatus() reads inside it shows the
// submission, and the form is reset when that transition commits, if the
// action succeeded (a useActionState dispatch included). As in React 19, the
// reset clears the uncontrolled fields and leaves a controlled one (a `value`
// or `checked` prop) showing what its prop holds.
//
// CSRF: the endpoint accepts a post the browser marks same-origin (Fetch
// Metadata, or an Origin header), which is how a form on a cached page posts.
// A token is only needed where a browser sends neither; when the page knows
// the visitor's token (an uncached route's loader gets `ctx.csrfToken`), pass
// it as `csrfToken` and the form carries it.

import { h } from 'what-core';
import { _formStatusContext, _formStatus, _resetForm } from 'what-core/internal';
import { _callAction } from './actions.js';
import { addField } from './fields.js';

export const ACTION_ENDPOINT = '/__what_action';

// Fields the endpoint reads itself; an enhanced submit does not pass them on.
const RESERVED = new Set(['_action', 'data-action', '_csrf', 'what-csrf-token', '_redirect']);

// The action id lives on the callable wrapper that action() returns. Accepting
// the function itself is the point: passing the id as a string means keeping two
// spellings in sync by hand, which is the failure this component exists to stop.
function serverActionId(action) {
  if (typeof action === 'string') return action;
  if (typeof action === 'function') return action._actionId || null;
  // ERROR_CODES.FORM_ACTION_MISSING
  throw Object.assign(
    new Error('[what] <Form> requires an `action` prop: a server action, its id, or a function.'),
    { code: 'ERR_FORM_ACTION_MISSING' },
  );
}

// On the server there is no document, so the per-request token must be handed
// in: the adapter puts it on the loader context as `ctx.csrfToken`. On the
// client it can be recovered from the page (meta tag, then cookie).
function readClientCsrfToken() {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="what-csrf-token"]');
  if (meta) return meta.getAttribute('content');
  const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// The form's fields as the endpoint hands them to a server action: one value
// per name, an array for a repeated name, reserved fields left out.
function fieldsOf(formData) {
  const data = {};
  for (const [key, value] of formData.entries()) {
    if (!RESERVED.has(key)) addField(data, key, value);
  }
  return data;
}

export function Form({
  action,
  csrfToken,
  redirect,
  method = 'post',
  enhance = true,
  children,
  ...rest
}) {
  const actionId = serverActionId(action);
  const token = csrfToken !== undefined ? csrfToken : readClientCsrfToken();
  const status = _formStatus(method, action);

  const hidden = [];
  if (actionId !== null) {
    hidden.push(h('input', { type: 'hidden', name: '_action', value: actionId }));
    if (token) hidden.push(h('input', { type: 'hidden', name: 'what-csrf-token', value: token }));
    if (redirect) hidden.push(h('input', { type: 'hidden', name: '_redirect', value: redirect }));
  }

  /** @type {Record<string, any>} */
  const props = {
    ...rest,
    method,
    action: rest.action || (actionId !== null ? ACTION_ENDPOINT : action.permalink),
  };
  if (actionId !== null) props['data-action'] = actionId;
  if (enhance) {
    // `data-enhance` is what enhanceForms() looks for on a page that does
    // not mount its forms. A mounted form runs its submit itself.
    props['data-enhance'] = '';
    props.onsubmit = (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const form = event.currentTarget;
      const formData = new FormData(form, event.submitter || undefined);
      const fail = (error) => form.dispatchEvent(new CustomEvent('form:error', { bubbles: true, detail: { error } }));
      status.submit(formData, async (data) => {
        if (actionId === null) await action(data);
        else if (typeof action === 'function') await action(fieldsOf(data));
        else await _callAction(actionId, [fieldsOf(data)]);
      }, () => {
        // Inside the transition's commit, which a throw would cut short.
        try {
          _resetForm(form);
        } catch (error) {
          fail(error);
        }
      }).catch(fail);
    };
  }

  const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
  return h(_formStatusContext(), { value: status }, h('form', props, ...hidden, ...kids));
}
