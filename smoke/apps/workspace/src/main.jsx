// Atlas: a project workspace. Client-only; index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';
import { Router, nestedRoutes } from 'what-router';

import { Shell } from './Shell.jsx';
import SignIn from './pages/SignIn.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import { DetailsStep, ReviewStep, TeamStep, WizardLayout } from './pages/Wizard.jsx';
import { session } from './state/session.js';
import { detailsDone, teamDone, useDraft } from './state/draft.js';

const signedIn = ({ path }) => (session() ? undefined : `/signin?next=${encodeURIComponent(path)}`);
const after = (done, back) => () => (done(useDraft().draft) ? undefined : back);

const routes = [
  { path: '/signin', component: SignIn },
  { path: '/', component: () => null, middleware: [() => (session() ? '/projects' : '/signin')] },
  { path: '/projects', component: Projects, middleware: [signedIn] },
  { path: '/projects/:id', component: ProjectDetail, middleware: [signedIn] },
  ...nestedRoutes('/new', [
    { path: '/details', component: DetailsStep, middleware: [signedIn] },
    { path: '/team', component: TeamStep, middleware: [signedIn, after(detailsDone, '/new/details')] },
    { path: '/review', component: ReviewStep, middleware: [signedIn, after(detailsDone, '/new/details'), after(teamDone, '/new/team')] },
  ], { layout: WizardLayout }),
];

function NotFound() {
  return <p data-not-found>Nothing here.</p>;
}

mount(<Router routes={routes} fallback={NotFound} globalLayout={Shell} />, '#app');
