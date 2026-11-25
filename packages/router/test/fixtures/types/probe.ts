// Type probe for what-router's declarations (packages/router/index.d.ts),
// compiled by ../../types.test.js. Must type-check clean under strict mode.
import { route, parseQuery, useSearch, type RouteConfig, type RouteMiddleware, type RouteQuery } from 'what-router';

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
