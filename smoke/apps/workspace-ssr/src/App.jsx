// Atlas, server-rendered. The same routes as the client-only workspace app:
// a guarded project list and detail page, and a three-step wizard under one
// layout. The guards run on the server too, where a redirect is a real 3xx.

import { useLoaderData } from 'what-framework';
import { Router, nestedRoutes } from 'what-router';

import { Shell } from './Shell.jsx';
import SignIn from './pages/SignIn.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import { DetailsStep, ReviewStep, TeamStep, WizardLayout } from './pages/Wizard.jsx';
import { Workspace, createWorkspace, detailsDone, teamDone } from './workspace.js';

function NotFound() {
  return <p data-not-found>Nothing here.</p>;
}

export default function App() {
  const ws = createWorkspace(useLoaderData());
  const signedIn = ({ path }) => (ws.session() ? undefined : `/signin?next=${encodeURIComponent(path)}`);
  const after = (done, back) => () => (done(ws.draft()) ? undefined : back);

  const routes = [
    { path: '/signin', component: SignIn },
    { path: '/', component: () => null, middleware: [() => (ws.session() ? '/projects' : '/signin')] },
    { path: '/projects', component: Projects, middleware: [signedIn] },
    { path: '/projects/:id', component: ProjectDetail, middleware: [signedIn] },
    ...nestedRoutes('/new', [
      { path: '/details', component: DetailsStep, middleware: [signedIn] },
      { path: '/team', component: TeamStep, middleware: [signedIn, after(detailsDone, '/new/details')] },
      { path: '/review', component: ReviewStep, middleware: [signedIn, after(detailsDone, '/new/details'), after(teamDone, '/new/team')] },
    ], { layout: WizardLayout }),
  ];

  return (
    <Workspace.Provider value={ws}>
      <Router routes={routes} fallback={NotFound} globalLayout={Shell} />
    </Workspace.Provider>
  );
}
