// Sign in, then go back where the guard sent you from.

import { useState } from 'what-framework';
import { navigate } from 'what-router';
import { loadPage } from '../loaders.js';
import { safeNext, useSession } from '../session.js';

export const loader = (ctx) => loadPage(ctx);

export default function Login({ query }) {
  const session = useSession();
  const [name, setName] = useState('');
  const submit = (e) => {
    e.preventDefault();
    session.signIn(name());
    navigate(safeNext(query.next) ?? '/org/acme', { replace: true });
  };
  return (
    <main class="login" data-page="login">
      <form class="card" onSubmit={submit} data-login-form>
        <h1>Sign in to Northstar</h1>
        {query.next ? <p class="muted" data-next>You'll go back to {query.next}.</p> : null}
        <label>Name <input data-login-name value={name()} onInput={(e) => setName(e.currentTarget.value)} autocomplete="name" /></label>
        <button type="submit" class="button primary" data-login-submit>Sign in</button>
      </form>
    </main>
  );
}
