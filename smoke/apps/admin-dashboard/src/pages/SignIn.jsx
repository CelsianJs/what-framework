// The gate every protected route redirects to.
//
// `next` comes from the query PROP the router passes in, not from useSearch():
// route.query is a signal the router writes on every match, so reading it in a
// component body would make the router's own reactive region depend on it.

import { signal } from 'what-framework';
import { navigate } from 'what-router';

import { signIn } from '../state/session.js';

export default function SignIn(props) {
  const name = signal('Ines Okafor', 'signin:name');
  const next = props.query?.next || '/';

  function submit(e) {
    e.preventDefault();
    signIn(name());
    // Programmatic navigation: the form has no href to follow.
    navigate(next, { replace: true });
  }

  return (
    <div class="signin-wrap">
      <form class="signin" data-signin onsubmit={submit}>
        <div class="brand">
          <span class="brand-mark">NW</span>
          <span>
            <div class="brand-name">Northwind Ops</div>
            <div class="brand-sub">Operations console</div>
          </span>
        </div>
        <h1>Sign in</h1>
        <p class="hint" data-signin-next>
          {next === '/' ? 'Pick a name and continue.' : `You will be sent to ${next}.`}
        </p>
        <label class="field">
          Operator name
          <input
            data-signin-name
            autocomplete="name"
            value={() => name()}
            oninput={(e) => name(e.target.value)}
          />
        </label>
        <button class="primary" type="submit" data-signin-submit>Continue</button>
        <p class="hint">Demo only. Nothing is sent anywhere and a reload signs you out.</p>
      </form>
    </div>
  );
}
