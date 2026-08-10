// The Router's `fallback`, rendered for any path the table does not match.
// The sidebar keeps a deliberately dead "Warehouse" link so this is reachable
// by clicking rather than only by typing a URL.

import { Link } from 'what-router';

export function NotFound() {
  return (
    <div class="empty" data-notfound>
      <h1>404</h1>
      <p class="muted">That page is not part of this workspace.</p>
      <p class="mono muted" data-notfound-path>{() => location.pathname}</p>
      <Link href="/" class="nav-link">Back to overview</Link>
    </div>
  );
}
