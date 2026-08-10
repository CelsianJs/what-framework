// Account: SERVER mode, behind an auth gate.
//
// The gate is enforced on the SERVER, in the loader, before any HTML is
// produced. That is the only place it can be enforced honestly: a client-side
// guard is a UI convenience, not access control, because the page's data has
// already been sent by then.

import { h, Head, useLoaderData } from 'what-framework';
import { Header, Footer } from '../components/chrome.js';

export const page = { mode: 'server' };

export const loader = async ({ request, csrfToken }) => {
  const { sessionFromRequest } = await import('../auth.js');
  const session = sessionFromRequest(request);
  return { session, csrfToken: csrfToken ?? '' };
};

export default function Account() {
  const { session, csrfToken } = useLoaderData();

  if (!session) {
    return h('div', { class: 'page' },
      h(Head, { title: 'Sign in | Smoke Supply Co.' }),
      h(Header, { current: 'account' }),
      h('main', { class: 'container' },
        h('h1', { 'data-signin': '' }, 'Sign in'),
        h('p', { class: 'muted' }, 'Use demo@smoke.test / hunter2.'),
        // A plain form POST, not a server action. Actions cannot set response
        // headers, so they cannot establish a session cookie: sign-in has to be
        // a real endpoint. Works with scripting disabled, which is the point.
        h('form', { method: 'post', action: '/api/login', class: 'auth-form' },
          h('input', { type: 'hidden', name: 'csrf', value: csrfToken }),
          h('label', { for: 'email' }, 'Email'),
          h('input', { id: 'email', name: 'email', type: 'email', required: true, autocomplete: 'username' }),
          h('label', { for: 'password' }, 'Password'),
          h('input', { id: 'password', name: 'password', type: 'password', required: true, autocomplete: 'current-password' }),
          h('button', { type: 'submit', 'data-login': '' }, 'Sign in'),
        ),
      ),
      h(Footer, {}),
    );
  }

  return h('div', { class: 'page' },
    h(Head, { title: 'Your account | Smoke Supply Co.' }),
    h(Header, { current: 'account' }),
    h('main', { class: 'container' },
      h('h1', { 'data-account': '' }, 'Your account'),
      h('p', {}, 'Signed in as ', h('strong', { 'data-email': '' }, session.email)),
      h('form', { method: 'post', action: '/api/logout' },
        h('input', { type: 'hidden', name: 'csrf', value: csrfToken }),
        h('button', { type: 'submit', 'data-logout': '' }, 'Sign out'),
      ),
    ),
    h(Footer, {}),
  );
}
