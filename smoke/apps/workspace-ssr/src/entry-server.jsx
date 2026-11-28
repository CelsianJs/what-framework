// Server entry (vite build --ssr): the route table createRequestHandler
// serves, and the project database. Every path is the one App page; its
// <Router> picks the screen, and its guards redirect on the server.

import App from './App.jsx';
import { DRAFT_COOKIE, SEED_PROJECTS, USER_COOKIE, readCookie } from './data.js';

const projects = new Map(SEED_PROJECTS.map((p) => [p.id, p]));

export const db = {
  list: () => [...projects.values()],
  create(draft) {
    const id = String(projects.size + 1);
    const project = {
      id,
      name: String(draft.name ?? '').trim() || `Project ${id}`,
      kind: String(draft.kind ?? 'launch'),
      owner: String(draft.owner ?? ''),
      members: Array.isArray(draft.members) ? draft.members.map(String) : [],
    };
    projects.set(id, project);
    return project;
  },
};

// The visitor's state comes from their cookies; the projects from the database.
export function loader({ request }) {
  const cookie = request.headers.get('cookie');
  return {
    user: readCookie(cookie, USER_COOKIE),
    draft: readCookie(cookie, DRAFT_COOKIE),
    projects: db.list(),
  };
}

const page = { mode: 'server' };
export const routes = [
  { path: '/', component: App, loader, page, mode: 'server' },
  { path: '/*', component: App, loader, page, mode: 'server' },
];
