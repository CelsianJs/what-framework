import { Link } from 'what-router';
import { useWorkspace } from '../workspace.js';

export default function ProjectDetail({ params }) {
  const ws = useWorkspace();
  const project = () => ws.projects().find((p) => p.id === params.id);
  return (
    <section data-detail={params.id}>
      {project() ? (
        <>
          <h1 data-project-name>{project().name}</h1>
          <p class="muted" data-project-meta>{project().kind} · {project().owner}</p>
          <p data-project-members>{project().members.join(', ') || 'No members yet'}</p>
        </>
      ) : (
        <p data-not-found>No project {params.id}.</p>
      )}
      <Link href="/projects" data-back>All projects</Link>
    </section>
  );
}
