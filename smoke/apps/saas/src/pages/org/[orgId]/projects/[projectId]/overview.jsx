// A project's overview: its counts by status and its latest issues (the
// issue list's first page, the same cache entry the Issues tab opens on).

import { Link } from 'what-router';
import { keys, useIssues, useProject } from '../../../../../queries.js';
import { loadPage } from '../../../../../loaders.js';

const LATEST = { status: 'all', sort: 'updated', page: '1' };

export const loader = (ctx) => loadPage(ctx, (db) => {
  const { orgId, projectId } = ctx.params;
  return [
    [keys.org(orgId), db.org(orgId)],
    [keys.projects(orgId), db.projects(orgId)],
    [keys.project(orgId, projectId), db.project(orgId, projectId)],
    [keys.issues(orgId, projectId, LATEST), db.issues(orgId, projectId, LATEST)],
  ];
});

export default function ProjectOverview({ params }) {
  const orgId = () => params.orgId;
  const projectId = () => params.projectId;
  const project = useProject(orgId, projectId);
  const latest = useIssues(orgId, projectId, () => LATEST);
  return (
    <main class="page" data-page="project-overview">
      <p class="muted">{project.data()?.summary}</p>
      <div class="stats">
        <div class="stat"><b data-count="open">{project.data()?.byStatus.open ?? '…'}</b> open</div>
        <div class="stat"><b data-count="in_progress">{project.data()?.byStatus.in_progress ?? '…'}</b> in progress</div>
        <div class="stat"><b data-count="closed">{project.data()?.byStatus.closed ?? '…'}</b> closed</div>
      </div>
      <h2>Latest</h2>
      <ul class="latest">
        {(latest.data()?.rows ?? []).slice(0, 5).map((i) => (
          <li key={i.id} data-latest={i.id}>
            <Link href={`/org/${params.orgId}/projects/${params.projectId}/issues?edit=${i.id}`}>{i.id}</Link> {i.title}
          </li>
        ))}
      </ul>
    </main>
  );
}
