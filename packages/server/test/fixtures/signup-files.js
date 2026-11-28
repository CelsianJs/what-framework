// A sign-up page with an avatar (action-form-files-chromium.test.js): the
// same module renders on the server and hydrates in the browser.

import { h, useActionState, getResponse } from 'what-core';
import { Form, action } from 'what-server';

/** What the action received, on the server: one record per call. */
export const received = [];

export const signup = action(async (_previous, fields) => {
  const avatar = fields.avatar;
  const upload = typeof avatar === 'object' && avatar !== null && typeof avatar.text === 'function'
    ? { name: avatar.name, size: avatar.size, text: await avatar.text() }
    : { received: avatar ?? null };
  received.push(upload);
  if (!String(fields.email ?? '').includes('@')) return { error: 'Enter a valid email', fields: { email: fields.email }, upload };
  getResponse().redirect('/welcome');
  return { saved: true };
}, { id: 'files-chromium/signup' });

export function SignupPage() {
  const [state, save] = useActionState(signup, null);
  return h('main', null, h(Form, { action: save, enctype: 'multipart/form-data' },
    h('input', { name: 'email', defaultValue: () => state()?.fields?.email ?? '' }),
    h('input', { type: 'file', name: 'avatar' }),
    () => (state()?.error ? h('p', { role: 'alert' }, state().error) : null),
    () => (state()?.upload ? h('output', null, JSON.stringify(state().upload)) : null),
    h('button', { type: 'submit' }, 'Create account')));
}
