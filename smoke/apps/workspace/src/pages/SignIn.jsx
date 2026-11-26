import { useState } from 'what-framework';
import { navigate } from 'what-router';

import { signIn } from '../state/session.js';

export default function SignIn({ query }) {
  const [name, setName] = useState('');
  const next = query?.next || '/projects';
  const submit = (e) => {
    e.preventDefault();
    if (!name().trim()) return;
    signIn(name());
    navigate(next, { replace: true });
  };
  return (
    <form class="signin" data-signin onSubmit={submit}>
      <h1>Atlas</h1>
      <p class="muted">Sign in to your workspace.</p>
      <label>Your name <input data-signin-name value={name()} onInput={(e) => setName(e.currentTarget.value)} /></label>
      <button class="primary" type="submit" data-signin-submit>Continue</button>
    </form>
  );
}
