// A project's settings: a form kept in the page while it is open.

import { useState } from 'what-framework';
import { keys, useProject } from '../../../../../queries.js';
import { loadPage } from '../../../../../loaders.js';

export const loader = (ctx) => loadPage(ctx, (db) => {
  const { orgId, projectId } = ctx.params;
  return [
    [keys.org(orgId), db.org(orgId)],
    [keys.projects(orgId), db.projects(orgId)],
    [keys.project(orgId, projectId), db.project(orgId, projectId)],
  ];
});

export default function ProjectSettings({ params }) {
  const project = useProject(() => params.orgId, () => params.projectId);
  const [notify, setNotify] = useState(true);
  return (
    <main class="page" data-page="project-settings">
      <form class="card settings" onSubmit={(e) => e.preventDefault()}>
        <label>Name <input data-setting="name" value={project.data()?.name ?? ''} readOnly /></label>
        <label>Key <input data-setting="key" value={project.data()?.key ?? ''} readOnly /></label>
        <label>Lead <input data-setting="lead" value={project.data()?.lead ?? ''} readOnly /></label>
        <label class="check">
          <input type="checkbox" data-setting="notify" checked={notify()} onChange={(e) => setNotify(e.currentTarget.checked)} />
          Email the lead about new issues
        </label>
      </form>
    </main>
  );
}
