// The JSON API the browser's queries read, below the base like every URL of
// the app: /console/api/orgs/acme/projects/apollo/issues?status=open. A
// signed-out request is refused. It runs in the server bundle beside the
// loaders and the action, so all three see one database.

import { db, latency } from './db.js';
import { readSession } from './session.js';

export const apiStats = { requests: 0, byPath: {} };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export async function api(request, base) {
  const url = new URL(request.url);
  const path = url.pathname.slice(`${base}/api/`.length);
  if (path === '__stats') return json(200, apiStats);
  apiStats.requests++;
  const route = path.replace(/[^/]+/g, (s, i) => (i === 0 ? s : ':'));
  apiStats.byPath[route] = (apiStats.byPath[route] ?? 0) + 1;
  if (readSession(request.headers.get('cookie')) === null) return json(401, { error: 'Sign in first' });
  const [orgs, orgId, section, projectId, sub] = path.split('/');
  if (orgs !== 'orgs' || !orgId) return json(404, { error: 'No such endpoint' });
  await latency(section === 'members' ? 120 : 70);
  let body = null;
  if (!section) body = db.org(orgId);
  else if (section === 'projects' && !projectId) body = db.projects(orgId);
  else if (section === 'projects' && !sub) body = db.project(orgId, projectId);
  else if (section === 'projects' && sub === 'issues') body = db.issues(orgId, projectId, Object.fromEntries(url.searchParams));
  else if (section === 'members') body = db.members(orgId);
  else if (section === 'billing') body = db.billing(orgId);
  return body === null ? json(404, { error: 'Not found' }) : json(200, body);
}
