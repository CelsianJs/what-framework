import { Link } from 'what-router';
import { useQuery } from 'what-framework/data';

import { listProjects } from '../api.js';

export default function Projects() {
  const projects = useQuery({ queryKey: ['projects'], queryFn: listProjects });
  return (
    <section>
      <div class="page-head">
        <h1>Projects</h1>
        <Link href="/new/details" class="button primary" data-new-project>New project</Link>
      </div>
      {projects.isLoading() ? (
        <p class="muted" data-loading>Loading projects…</p>
      ) : (
        <ul class="project-list" data-projects>
          {(projects.data() ?? []).map((p) => (
            <li key={p.id} data-project={p.id}>
              <Link href={`/projects/${p.id}`}>{p.name}</Link>
              <span class="muted">{p.kind} · {p.owner}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
