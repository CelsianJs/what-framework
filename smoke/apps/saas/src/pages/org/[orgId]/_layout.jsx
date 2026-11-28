// An organisation's shell: the sidebar with its sections, the org switcher,
// the open-issue count (the org's query entry, which the overview and billing
// read too) and a search box, whose text stays while the visitor moves
// around the org. A signed-out visitor is sent to sign in, and comes back
// here after.

import { useState } from 'what-framework';
import { Link, redirect, route } from 'what-router';
import { useOrg } from '../../../queries.js';
import { useSession } from '../../../session.js';

export default function OrgShell({ params, children }) {
  const session = useSession();
  if (!session.user()) redirect(`/login?next=${encodeURIComponent(route.url)}`);
  const org = useOrg(() => params.orgId);
  const [search, setSearch] = useState('');
  const at = (section) => `/org/${params.orgId}${section}`;
  return (
    <div class="org" data-org-shell>
      <aside class="sidebar">
        <div class="org-name" data-org-name>{org.data()?.name ?? params.orgId}</div>
        <div class="switch">
          <Link href="/org/acme" data-switch="acme">Acme</Link>
          <Link href="/org/globex" data-switch="globex">Globex</Link>
        </div>
        <input class="search" type="search" placeholder="Search issues and people" data-search
          value={search()} onInput={(e) => setSearch(e.currentTarget.value)} />
        {search() ? <p class="muted small" data-search-hint>Searching for “{search()}”</p> : null}
        <nav class="sections">
          <Link href={at('')} data-nav="overview">Overview</Link>
          <Link href={at('/projects')} data-nav="projects">
            Projects <span class="badge" data-open-count>{org.data()?.open ?? '…'}</span>
          </Link>
          <Link href={at('/members')} data-nav="members">Members</Link>
          <Link href={at('/billing')} data-nav="billing">Billing</Link>
        </nav>
      </aside>
      <div class="org-main" data-org-main>{children}</div>
    </div>
  );
}
