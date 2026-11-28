// The org's projects, before one is picked.

import { Link } from 'what-router';
import { keys, useProjects } from '../../../../queries.js';
import { loadPage } from '../../../../loaders.js';

export const loader = (ctx) => loadPage(ctx, (db) => [
  [keys.org(ctx.params.orgId), db.org(ctx.params.orgId)],
  [keys.projects(ctx.params.orgId), db.projects(ctx.params.orgId)],
]);

export default function ProjectIndex({ params }) {
  const projects = useProjects(() => params.orgId);
  return (
    <main class="page" data-page="projects">
      <h1>Projects</h1>
      <table class="table">
        <thead><tr><th>Key</th><th>Name</th><th>Lead</th><th>Open</th></tr></thead>
        <tbody>
          {(projects.data() ?? []).map((p) => (
            <tr key={p.id} data-project-row={p.id}>
              <td>{p.key}</td>
              <td><Link href={`/org/${params.orgId}/projects/${p.id}/issues`}>{p.name}</Link></td>
              <td>{p.lead}</td>
              <td>{p.open}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
