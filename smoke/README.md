# App smoke suite

Real applications, built the way a user would build them, driven in a real
browser, run against a chosen build of the framework.

```bash
npm run smoke:apps                              # workspace source (pre-release)
npm run smoke:apps:npm                          # published `latest`
node smoke/run.mjs --source=npm --version=0.12.2 # a specific release
node smoke/run.mjs --apps=storefront --keep      # one app, keep the workdir

npm run smoke:ports                             # what is still holding a smoke port
npm run smoke:clean                             # stop the ones that are ours
```

App servers are started detached, because a dev server spawns children that
outlive a bare `child.kill()` and keep holding the port. The harness kills the
whole group on exit, SIGINT and SIGTERM, which covers a normal run and a Ctrl-C.
It cannot cover the runner being SIGKILLed, the machine sleeping mid-run, or
someone running `npm run dev` in an app directory by hand. Those leak, and a
leaked server is not harmless: `assertPortFree` refuses to start against a busy
port, so the next run reports a stale process instead of a result. `smoke:clean`
is the reaper, and it only stops processes working inside this repo or a runner
temp directory, because this machine runs dev servers for other projects too.

## Why this exists

0.12.0 and 0.12.1 shipped a `what-server` packaging defect that every unit test,
both type gates and the scaffold smoke passed. It was only visible to something
that INSTALLED the published artifact and used it. `--source=npm` is that
something.

Then the suite's first app found five more defects that the 1,900-test unit suite
could not see, because each needed two features combined: SSR **and** hydration
**and** a toggle; a query key **and** a signal **and** an invalidation. See
`FINDINGS.md`.

## The two modes

| mode | what it installs | what it catches |
|---|---|---|
| `--source=workspace` (default) | `npm pack` of each workspace package | source regressions, before a release exists |
| `--source=npm` | `name@version` from the registry | packaging defects: a types path declared but not published, an export condition shadowed by another, a dependency that only resolves inside the monorepo |

Workspace mode is blind to every packaging defect by construction, which is
exactly how 0.12.0 shipped. Both modes assert afterwards that the installed tree
really came from the source that was asked for, so a resolution fallback cannot
turn a green run into a lie about which bytes were tested.

## The capability contract

`harness/capabilities.mjs` lists the framework capabilities this suite is
responsible for. Each app declares `covers: [...]`, and the runner fails when:

- a capability has no app covering it, or
- an app declares a capability that no passing check ever reported.

Adding a capability without covering it turns the suite red. That is the point:
a gap becomes visible the day it appears rather than in the next audit.

A filtered run (`--apps=...`) skips both contract checks, since covering a subset
is the whole reason to filter.

## The apps

Each app is a genuine, demoable application. It is checked in whole, so
`cd smoke/apps/<name> && npm install && npm run dev` works and gives you
something to look at, and the runner copies it to a temp workdir so a run never
dirties the demo.

| app | shape | proves |
|---|---|---|
| `storefront` | buildless full-stack ecommerce | static/hybrid/server render modes, ISR MISS/HIT and tag revalidation, a global cart store with localStorage persistence, cookie auth read in a loader, server actions with and without JavaScript, CSRF rejection, `useQuery` + prefix invalidation, `Show`/`For`, batching |
| `admin-dashboard` | compiled JSX single-page app | a persistent shell, nested layouts, a sign-in guard, loading and error routes, context, a Portal dialog, a keyed table |
| `ops-console` | server-rendered console that hydrates | Suspense and lazy panes, ErrorBoundary, infinite and optimistic queries, validated forms, a focus-trapped dialog, `useId` across hydration |
| `scrollytelling` | server-rendered essay with islands | all five island hydration modes, scroll progress, intersect reveals, spring and tween, an enter/leave transition |
| `data-grid` | compiled SPA over 10,000 rows | virtual scrolling with a bounded DOM, sort, filter, select-all, inline cell editing, a summary derived over every row, a 1,000-row bulk update, each with a time budget |
| `live-feed` | compiled SPA fed 200 updates a second | a keyed tape with no dropped or repeated rows, SVG sparklines, store counters, pause/resume, panels mounting and unmounting under load with nothing left behind, a level heap, no long tasks |
| `workspace` | compiled SPA chaining a product's workflows | a guarded deep link, nested layouts, a queried list, an optimistic edit and its rollback, a three-step wizard across back/forward and a reload, a focus-trapped portal dialog, a toast live region |
| `newsroom` | buildless server-rendered news site under load | a streamed front page whose first byte beats its slow query, out-of-order Suspense boundaries, query-string pagination, 3,000-word ISR articles that hydrate without creating a node, all five island modes on one page, text typed before hydration surviving it, comments as server actions with and without JavaScript and their tag revalidation, 100 concurrent renders each with only its own content, a level server heap over 2,000 requests |
| `workspace-ssr` | the workspace's routes, server-rendered (Vite client and `--ssr` builds) and hydrated | middleware redirects that are real 3xx responses, a deep link to a nested route rendered on the server, a layout chain that hydrates onto the server's nodes and stays through client navigation, a wizard reload rendered from the visitor's cookies, 40 concurrent visitors each with their own state |

## Writing a new app

1. Build the app under `smoke/apps/<name>/`. Make it something you would show
   someone, not a test fixture.
2. Add `smoke.config.mjs`:

```js
export default {
  description: 'one line',
  covers: ['render:static', 'state:signal'],       // capability ids
  async check({ workDir, appPort, browser, check, reporter, log, run }) {
    // check(capability, condition, name, detail) -> tags a capability
    // reporter.assert(condition, name, detail)   -> untagged supporting check
  },
};
```

3. Run `node smoke/run.mjs --apps=<name> --keep` until green.

Ports start at 4700 (`WHAT_SMOKE_APP_PORT_BASE` moves them) and increment per app. The runner refuses to start if the
port is already answering, because a stale process serving a DIFFERENT app makes
every downstream assertion lie.

## Reading a failure

The run writes `artifacts/smoke-apps.json` with every check, its capability, and
its detail string. Failures print the detail, which is written to carry the
observed value (`badge=0`, `MISS then MISS`) rather than just "expected true".

If a check fails only under `--source=npm`, it is a packaging or release defect,
not a source defect: the same code passed in workspace mode.
