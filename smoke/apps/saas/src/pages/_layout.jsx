// The frame around every page: the brand, and who is signed in.

import { Link, navigate } from 'what-router';
import { useSession } from '../session.js';

export default function Frame({ children }) {
  const session = useSession();
  const signOut = () => {
    session.signOut();
    navigate('/login');
  };
  return (
    <div class="frame" data-frame>
      <header class="topbar">
        <Link href="/" class="brand" data-brand>Northstar</Link>
        <span class="spacer" />
        {session.user() ? (
          <span class="who">
            <span data-user>{session.user().name}</span>
            <button class="link" data-signout onClick={signOut}>Sign out</button>
          </span>
        ) : (
          <Link href="/login" data-signin-link>Sign in</Link>
        )}
      </header>
      {children}
    </div>
  );
}
