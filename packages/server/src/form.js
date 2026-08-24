// What Framework - <Form>
//
// The no-JS server-action path works and is covered by the scaffold smoke test,
// but reaching it meant hand-writing four exact things per form: the endpoint,
// the `_action` id, the `what-csrf-token` field, and the `_redirect`. Getting the
// CSRF field name wrong is silent: the form posts, the double-submit check
// rejects it, and nothing on the page says why. This component is the one piece
// that was missing between the forms module and a path that already worked.
//
//   <Form action={createPost} redirect="/">
//     <input name="title" required />
//     <button>Publish</button>
//   </Form>
//
// Renders a real <form method="post">, so it submits with JavaScript disabled.
// With JS, the client enhancer intercepts it and posts without a page reload.

import { h } from 'what-core';

export const ACTION_ENDPOINT = '/__what_action';

// The action id lives on the callable wrapper that action() returns. Accepting
// the function itself is the point: passing the id as a string means keeping two
// spellings in sync by hand, which is the failure this component exists to stop.
function resolveActionId(action) {
  if (typeof action === 'string') return action;
  if (typeof action === 'function') {
    const id = action._actionId;
    if (id) return id;
    // ERROR_CODES.FORM_ACTION_NOT_REGISTERED
    throw Object.assign(
      new Error(
        '[what] <Form action={fn}>: that function is not a server action. ' +
        'Wrap it with action() from what-server, or pass the action id as a string.'
      ),
      { code: 'ERR_FORM_ACTION_NOT_REGISTERED' },
    );
  }
  // ERROR_CODES.FORM_ACTION_MISSING
  throw Object.assign(
    new Error('[what] <Form> requires an `action` prop: a server action or its id.'),
    { code: 'ERR_FORM_ACTION_MISSING' },
  );
}

// On the server there is no document, so the per-request token must be handed
// in: the adapter puts it on the loader context as `ctx.csrfToken`, and the
// page returns it in loader data. On the client it can be recovered from the
// page (meta tag, then cookie).
function readClientCsrfToken() {
  if (typeof document === 'undefined') return null;
  const meta = document.querySelector('meta[name="what-csrf-token"]');
  if (meta) return meta.getAttribute('content');
  const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
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
  const actionId = resolveActionId(action);
  const token = csrfToken !== undefined ? csrfToken : readClientCsrfToken();

  if (
    token == null
    && typeof process !== 'undefined'
    && process.env?.NODE_ENV !== 'production'
  ) {
    // Both halves of the contract, because only naming the first one sends
    // developers looking for a token on a cached page that will never have one.
    console.warn(
      `[what] <Form action="${actionId}"> has no CSRF token. Pass one: the adapter hands ` +
      'the per-request token to the route loader as `ctx.csrfToken`, so return it in ' +
      'loader data and set `csrfToken` on the form. Cached routes (page mode "static" or ' +
      '"hybrid") have no per-visitor token by design, since their HTML is shared, so a ' +
      'form that must submit without JavaScript belongs on a "server" mode route. ' +
      'Otherwise the double-submit check rejects the POST and the failure is silent.'
    );
  }

  const hidden = [
    h('input', { type: 'hidden', name: '_action', value: actionId }),
    h('input', { type: 'hidden', name: 'what-csrf-token', value: token || '' }),
  ];
  if (redirect) {
    hidden.push(h('input', { type: 'hidden', name: '_redirect', value: redirect }));
  }

  const props = {
    ...rest,
    method,
    action: rest.action || ACTION_ENDPOINT,
    'data-action': actionId,
  };
  // `data-enhance` is the selector enhanceForms() looks for. Opting out leaves a
  // plain HTML form, which still works: that is the whole point of the design.
  if (enhance) props['data-enhance'] = '';

  const kids = children == null ? [] : (Array.isArray(children) ? children : [children]);
  return h('form', props, ...hidden, ...kids);
}
