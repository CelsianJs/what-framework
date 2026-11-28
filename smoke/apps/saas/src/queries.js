// The app's data, read through useQuery from one cache that every section
// shares: the org shell's open-issue count, the overview's cards and the
// billing page all read the org's entry, and the projects layout, the project
// list and the overview read the projects'. Each page's server loader fills
// the entries it reads (loaders.js), and the browser adopts them when it
// hydrates.

import { useQuery } from 'what-framework/data';

const API = `${import.meta.env.BASE_URL}api/`;

export const calls = { count: 0, urls: [] };
if (typeof window !== 'undefined') window.__nsApi = calls;

async function getJson(path, signal) {
  calls.count++;
  calls.urls.push(path);
  const response = await fetch(API + path, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${response.status} ${path}`);
  return response.json();
}

export const keys = {
  org: (orgId) => ['org', orgId],
  projects: (orgId) => ['projects', orgId],
  project: (orgId, projectId) => ['project', orgId, projectId],
  issues: (orgId, projectId, f) => ['issues', orgId, projectId, f.status, f.sort, String(f.page)],
  members: (orgId) => ['members', orgId],
  billing: (orgId) => ['billing', orgId],
};

const FRESH = { staleTime: 30_000 };

export const useOrg = (orgId) => useQuery({ queryKey: () => keys.org(orgId()), queryFn: ({ queryKey, signal }) => getJson(`orgs/${queryKey[1]}`, signal), ...FRESH });
export const useProjects = (orgId) => useQuery({ queryKey: () => keys.projects(orgId()), queryFn: ({ queryKey, signal }) => getJson(`orgs/${queryKey[1]}/projects`, signal), ...FRESH });
export const useProject = (orgId, projectId) => useQuery({
  queryKey: () => keys.project(orgId(), projectId()),
  queryFn: ({ queryKey, signal }) => getJson(`orgs/${queryKey[1]}/projects/${queryKey[2]}`, signal),
  ...FRESH,
});
export const useIssues = (orgId, projectId, filters) => useQuery({
  queryKey: () => keys.issues(orgId(), projectId(), filters()),
  queryFn: ({ queryKey, signal }) => {
    const [, o, p, status, sort, page] = queryKey;
    return getJson(`orgs/${o}/projects/${p}/issues?${new URLSearchParams({ status, sort, page })}`, signal);
  },
  keepPreviousData: true,
  ...FRESH,
});
export const useMembers = (orgId) => useQuery({ queryKey: () => keys.members(orgId()), queryFn: ({ queryKey, signal }) => getJson(`orgs/${queryKey[1]}/members`, signal), ...FRESH });
export const useBilling = (orgId) => useQuery({ queryKey: () => keys.billing(orgId()), queryFn: ({ queryKey, signal }) => getJson(`orgs/${queryKey[1]}/billing`, signal), ...FRESH });

/** The issue list's filters in a query string, with their defaults. */
export function issueFilters(query) {
  return {
    status: ['open', 'in_progress', 'closed'].includes(query.status) ? query.status : 'all',
    sort: ['updated', 'priority', 'title'].includes(query.sort) ? query.sort : 'updated',
    page: String(Math.max(1, Number(query.page) || 1)),
  };
}
