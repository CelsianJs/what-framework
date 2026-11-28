// The projects section: the org's projects down the side and, once one is
// picked, its name and its tabs (overview, issues, settings), each a route.

import { Link } from 'what-router';
import { useProjects } from '../../../../queries.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'issues', label: 'Issues' },
  { id: 'settings', label: 'Settings' },
];

export default function ProjectsLayout({ params, children }) {
  const projects = useProjects(() => params.orgId);
  const current = () => (projects.data() ?? []).find((p) => p.id === params.projectId);
  return (
    <div class="projects" data-projects-layout>
      <nav class="project-list" aria-label="Projects">
        {(projects.data() ?? []).map((p) => (
          <Link key={p.id} href={`/org/${params.orgId}/projects/${p.id}/overview`} data-project-link={p.id}>
            <span class="key">{p.key}</span> {p.name} <span class="badge">{p.open}</span>
          </Link>
        ))}
      </nav>
      <section class="project-main">
        {params.projectId ? (
          <header class="project-head" data-project-head>
            <h1 data-project-title>{current()?.name ?? params.projectId}</h1>
            <nav class="tabs" role="tablist">
              {TABS.map((t) => (
                <Link key={t.id} role="tab" href={`/org/${params.orgId}/projects/${params.projectId}/${t.id}`} data-tab={t.id}>{t.label}</Link>
              ))}
            </nav>
          </header>
        ) : null}
        {children}
      </section>
    </div>
  );
}
