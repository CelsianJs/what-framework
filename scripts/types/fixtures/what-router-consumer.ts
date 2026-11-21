// A strict TypeScript consumer of the router through the umbrella import the
// docs use (docs/DATA.md, "Route data and navigations"), compiled by
// hygiene:types. The umbrella's declarations once copied what-router's and
// lacked `preload`, so this, the documented example, was a TS2353.
import { h } from 'what-framework';
import { Router, navigate, type RouteConfig } from 'what-framework/router';
import { query } from 'what-framework/data';

const user = (id: string) => query(['user', id], (key, { signal }) => fetch(`/api/users/${key[1]}`, { signal }).then((r) => r.json() as Promise<{ name: string }>), { staleTime: 30_000 });

const routes: RouteConfig[] = [
  {
    path: '/users/:id',
    preload: ({ params }) => user(params.id),
    component: ({ data }) => h('h1', null, () => (data as () => { name: string })().name),
  },
];

export const app = h(Router, { routes });
export const go: Promise<void> = navigate('/users/7', { transition: false });
