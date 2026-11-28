// Type probe for what-router's declarations (packages/router/index.d.ts),
// compiled by ../../types.test.js. Must type-check clean under strict mode.
import { route, parseQuery, useSearch, nestedRoutes, routeGroup, type LayoutProps, type RouteComponentProps, type RouteConfig, type RouteMiddleware, type RouteQuery } from 'what-router';

// Exact type equality: fails to compile when the two differ either way.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const expect = <T extends true>(_: T) => {};

// A repeated query key (?tag=a&tag=b) is an array of its values.
expect<Equals<RouteQuery[string], string | string[]>>(true);
expect<Equals<typeof route.query, RouteQuery>>(true);
expect<Equals<ReturnType<typeof parseQuery>, RouteQuery>>(true);
const search = useSearch();
expect<Equals<typeof search, RouteQuery>>(true);

const tags = (q: RouteQuery): string[] => {
  const v = q.tag;
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
};

// Middleware is told the full destination URL (path + search + hash).
const remember: RouteMiddleware = (context) => {
  const url: string = context.url;
  const path: string = context.path;
  expect<Equals<typeof context.query, RouteQuery>>(true);
  return url.startsWith(path) && tags(context.query).length >= 0 ? true : `/login?next=${encodeURIComponent(url)}`;
};

export const routes: RouteConfig[] = [
  {
    path: '/private',
    component: ({ query }) => null as any,
    middleware: [remember],
    preload: ({ query, url }) => [tags(query), url],
  },
];

// A page types what its route's preload returned with RouteComponentProps<T>;
// without the argument `data` stays `any`, as before.
interface User { id: number; name: string }
const loadUser = (id: string) => () => ({ id: Number(id), name: 'Ada' } as User);
function UserPage({ data, params }: RouteComponentProps<ReturnType<typeof loadUser>>) {
  expect<Equals<typeof data, (() => User) | undefined>>(true);
  const name: string | undefined = data?.().name;
  // @ts-expect-error data is optional: a route without preload has none.
  data().name;
  return (name ?? params.id) as any;
}
const untyped = (props: RouteComponentProps) => {
  expect<Equals<typeof props.data, any>>(true);
  return props.data.anything as any;
};
const Layout = ({ params, query, children }: LayoutProps) => [params.id, query.tab, children] as any;

export const typedRoutes: RouteConfig[] = [
  { path: '/users/:id', preload: ({ params }) => loadUser(params.id), component: UserPage, layout: Layout },
  { path: '/plain', component: untyped },
];

// A route's layout may be a list, outermost first, and nestedRoutes and
// routeGroup take one too: their layout goes around the route's own.
const Inner = ({ children }: LayoutProps) => children as any;
export const nestedLayouts: RouteConfig[] = [
  { path: '/a', component: untyped, layout: [Layout, Inner] },
  ...nestedRoutes('/org', [...nestedRoutes('/team', [{ path: '/', component: untyped, layout: Inner }], { layout: Inner })], {
    layout: [Layout],
    error: ({ error, reset }) => [error.message, reset] as any,
  }),
  ...routeGroup('admin', [{ path: '/admin', component: untyped }], { layout: Layout }),
];
