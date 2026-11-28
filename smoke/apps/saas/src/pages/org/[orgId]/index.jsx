// An org's overview: its numbers (the shell's entry) and its projects (the
// projects layout's entry), read from the shared cache.

import { Link } from 'what-router';
import { keys, useOrg, useProjects } from '../../../queries.js';
import { loadPage } from '../../../loaders.js';

export const loader = (ctx) => loadPage(ctx, (db) => [
  [keys.org(ctx.params.orgId), db.org(ctx.params.orgId)],
  [keys.projects(ctx.params.orgId), db.projects(ctx.params.orgId)],
]);

export default function Overview({ params }) {
  const orgId = () => params.orgId;
  const org = useOrg(orgId);
  const projects = useProjects(orgId);
  return (
    <main class="page" data-page="overview">
      <h1>{org.data()?.name ?? 'Overview'}</h1>
      <div class="stats">
        <div class="stat"><b data-stat="open">{org.data()?.open ?? '…'}</b> open issues</div>
        <div class="stat"><b data-stat="projects">{org.data()?.projects ?? '…'}</b> projects</div>
        <div class="stat"><b data-stat="members">{org.data()?.members ?? '…'}</b> members</div>
      </div>
      <h2>Projects</h2>
      <ul class="cards">
        {(projects.data() ?? []).map((p) => (
          <li key={p.id} class="card" data-project-card={p.id}>
            <Link href={`/org/${params.orgId}/projects/${p.id}/overview`}>{p.name}</Link>
            <span class="muted">{p.open} open · led by {p.lead}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}
