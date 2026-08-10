# App smoke suite

Real applications, built the way a user would build them, driven in a real
browser, run against a chosen build of the framework.

```bash
npm run smoke:apps                              # workspace source (pre-release)
npm run smoke:apps:npm                          # published `latest`
node smoke/run.mjs --source=npm --version=0.12.2 # a specific release
node smoke/run.mjs --apps=storefront --keep      # one app, keep the workdir
```

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

Three more are planned and not yet built: an admin dashboard (client SPA router,
nested layouts, guards, loading/error routes, Portal, context), a scrollytelling
page (all five island hydration modes, scroll-driven animation), and an ops
console (Suspense/lazy, ErrorBoundary, infinite + optimistic queries, forms,
focus management). The uncovered rows in the coverage report are theirs.

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

Ports start at 4700 and increment per app. The runner refuses to start if the
port is already answering, because a stale process serving a DIFFERENT app makes
every downstream assertion lie.

## Reading a failure

The run writes `artifacts/smoke-apps.json` with every check, its capability, and
its detail string. Failures print the detail, which is written to carry the
observed value (`badge=0`, `MISS then MISS`) rather than just "expected true".

If a check fails only under `--source=npm`, it is a packaging or release defect,
not a source defect: the same code passed in workspace mode.
