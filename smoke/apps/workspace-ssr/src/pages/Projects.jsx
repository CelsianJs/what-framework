import { Link } from 'what-router';
import { useWorkspace } from '../workspace.js';

export default function Projects() {
  const ws = useWorkspace();
  return (
    <section>
      <div class="page-head">
        <h1>Projects</h1>
        <Link href="/new/details" class="button primary" data-new-project>New project</Link>
      </div>
      <ul class="project-list" data-projects>
        {ws.projects().map((p) => (
          <li key={p.id} data-project={p.id}>
            <Link href={`/projects/${p.id}`}>{p.name}</Link>
            <span class="muted">{p.kind} · {p.owner}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
