# What Framework Remediation, Phase 2: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 72 verified-but-uncommitted remediation files, pay off the correctness and performance debts our own fixes created, restore the router API surface we wrongly deleted, and install the gates that make "clean DX at vanilla speeds" enforceable rather than aspirational.

**Architecture:** Work proceeds in four phases, each ending in a green tree. Phase 0 lands existing verified work in reviewable commits so nothing is lost. Phase 1 pays off debts introduced by Phases 1-2 of the previous session (children opacity, two measured perf regressions) and installs a DOM-level performance gate, because the existing gate is Node microbenchmarks only and demonstrably missed a 15.2% regression. Phase 2 restores deleted APIs. Phase 3 closes the DX integrity gaps from the product review. Every behavioral change is TDD: failing test first, then implementation.

**Tech Stack:** Node 20+, `node:test` (no Jest/Vitest), esbuild, Babel (`packages/compiler/src/babel-plugin.js`), Playwright Chromium, jsdom. Zero third-party runtime dependencies.

## Global Constraints

These apply to **every** task. A task that violates one is not done.

- **Zero third-party runtime dependencies.** `what-core`, `what-router`, `what-server`, `what-compiler`, `what-isr`, `what-react`, `what-devtools`, `eslint-plugin-what` and `create-what` must keep `"dependencies": {}`. Peer deps only.
- **Vanilla-JS speed is a gate, not a goal.** No task may regress any guarded benchmark op. From Task 5 onward, `npm run bench:gate` covers real DOM operations, not just Node microbenchmarks, and the tolerance is 10%/15%, not 30%/35%. Tasks 2 through 4 run before that gate exists, by design: they are the tasks that restore the performance the gate will then lock in. If a change costs measurable time, it must be justified in the commit body with the number.
- **Clean DX is a gate, not a goal.** Every public runtime export has a type declaration (enforced by `scripts/check-type-parity.mjs`), every documented idiom typechecks, and every error a user can hit carries a code, a fix, and an example.
- **Size budgets in `.size-budgets.json` are hard ceilings.** Raise only deliberately, in the same commit as the growth, with the reason in the `$comment`.
- **No em-dash characters** anywhere: code, comments, commit messages, docs.
- **Match surrounding style.** This codebase has very low comment density and 2 TODOs in 35 kLOC. Do not add narrating comments. Do not reformat untouched lines. Do not refactor beyond the task.
- **Test discovery is literal.** `scripts/run-all-tests.mjs` globs exactly `{packages,examples,scripts}/*/test/*.test.{js,mjs}`, one directory level. A test in `tests/` (plural) or named `*.spec.js` will never run. Put tests where the runner looks.
- **Full suite must be green before every commit:** `npm test` (baseline 1626 pass / 0 fail, plus 40 stress). Zero `skipped`, zero `todo`. Never disable a test to go green.

---

## File Structure

**Modified:**
- `packages/core/src/render.js`: `_$createComponent` children factory; memoization (Task 4)
- `packages/core/src/dom.js`: `_lazyChildren` realization; append/insert hot path (Tasks 4, 5)
- `packages/core/src/reactive.js`: `batch()` flush path (Task 5); `{stable:true}` (Task 11)
- `packages/core/src/components.js`: `Switch`/`Match` (Task 4)
- `packages/compiler/src/babel-plugin.js`: `Switch`/`Match` lowering (Task 4)
- `packages/router/src/index.js`: 7 restored navigation APIs (Task 6)
- `packages/what/router.d.ts`, `packages/router/index.d.ts`: restore declarations (Task 6)
- `benchmark/check-regressions.js`: tolerances, guarded op set (Task 5)
- `.size-budgets.json`: revert 6656 to 6200 (Task 7)
- `.depot/workflows/ci.yml`: typecheck, lint, coverage, stress jobs (Task 11)

**Created:**
- `benchmark/dom-gate.mjs`: headless-Chromium DOM benchmark producing gate-comparable JSON (Task 2)
- `benchmark/baseline/dom.json`: committed DOM baseline (Task 5)
- `packages/core/test/children-factory.test.js` (Task 4)
- `packages/compiler/test/switch-match.test.js` (Task 4)
- `packages/router/test/navigation-api.test.js` (Task 6)
- `tsconfig.json` (root, typecheck only, `noEmit`) (Task 11)
- `docs/reference/ERRORS.md` + docs-site error reference page (Task 8)

---

## Phase 0: Land what is already verified

> 72 changed paths currently sit uncommitted, representing two full verified remediation rounds. This is the single largest risk in the repo right now. Land it first, in reviewable slices.

### Task 1: Commit the verified remediation work in reviewable slices

**Files:** all 72 changed paths, committed in 7 commits.

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree at a known-green commit, which every later task branches from.

- [ ] **Step 1: Confirm the tree is green before touching anything**

```bash
cd /Users/macbookpro-kirby/Desktop/Coding/ZVN/WhatStack/what-fw
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail|skipped|todo)"
```
Expected: `tests 1626 / pass 1626 / fail 0 / skipped 0 / todo 0`, then `tests 40 / pass 40 / fail 0`.
If this is not green, STOP and report. Do not commit a red tree.

- [ ] **Step 2: Verify git identity (do not set it)**

```bash
git config user.name && git config user.email
```
Expected: `ZVN DEV` and `78920650+zvndev@users.noreply.github.com`. The `includeIf` rules in `~/.gitconfig` handle this. If it shows anything else, STOP and report. Never override with `git config` or `--author`.

- [ ] **Step 3: Branch off main**

```bash
git checkout -b fix/remediation-phase-1
```

- [ ] **Step 4: Commit slice 1, the release-pipeline security fix**

This is first because it is the CRITICAL finding and is independently reviewable.

```bash
git add .github/workflows/release-and-deploy.yml .depot/workflows/release-and-deploy.yml \
        scripts/publish-packages.mjs scripts/release/
git commit -m "$(cat <<'EOF'
fix(release): stop interpolating npm_tag into the step holding NPM_TOKEN

The npm_tag workflow input was type: string with no pattern and was
substituted textually into a run: block whose env carried NODE_AUTH_TOKEN,
so anyone with repo write could dispatch a release with a shell-metacharacter
tag and exfiltrate the publish token for all 14 packages.

Moves it to env: NPM_TAG referenced as "$NPM_TAG", adds a dist-tag validation
step ahead of any token-bearing step, in both the .github and .depot copies.

Also makes publish-packages.mjs fail fast instead of continuing past a failed
publish (which previously shipped dependents against a version that did not
exist on the registry), and passes --provenance, which id-token: write was
already granted for but never requested.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Commit slice 2, the XSS cluster**

```bash
git add packages/core/src/dom.js packages/core/src/render.js packages/core/src/head.js \
        packages/core/test/attr-sanitization.test.js \
        packages/server/src/index.js packages/server/test/ssr-security.test.js
git commit -m "$(cat <<'EOF'
fix(security): close four XSS holes across the SSR and h() render paths

- h()/html`` setProp had no URL sanitization at all while the compiled-JSX
  setProp did, so javascript: URLs executed via href/src/action/formaction on
  the API that CLAUDE.md teaches. Both paths now share one _isUnsafeAttr.
- srcdoc was in neither sanitizer's URL_ATTRS. The browser entity-decodes it
  and parses it as a document, so escaping is not a defense; it is now refused
  outright. Also adds object[data], xlink:href and ping.
- The SSR event-handler filter was case-sensitive while HTML attribute names
  are not, so ONCLICK survived a props spread.
- <Head> escaped attribute values but never attribute names, so a key of
  x" onload="alert(1) produced a live handler in the server-rendered head.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Commit slice 3, the ISR cross-user cache leak**

```bash
git add packages/cache/ packages/server/src/adapter/core.js packages/server/src/adapter/static.js \
        packages/server/test/adapter.test.js packages/server/test/adapter-static.test.js
git commit -m "$(cat <<'EOF'
fix(isr): stop caching per-user HTML publicly and serving it cross-user

vary was documented in index.d.ts and read in isr.js but never set by the
adapter, so the cache key was path + query only, with Cookie and Authorization
excluded. Passing the documented array form produced a constant key for every
user, because varyString ran Object.entries over an array. A hybrid route whose
loader read request.headers.cookie stored the first visitor's rendered page,
marked it public and fresh forever, and served it to everyone after that.

varyString now handles the array form and incorporates request header values,
and the engine fails closed: a route declaring vary with no resolvable header
source emits X-What-Cache: BYPASS and Cache-Control: private, no-store rather
than caching publicly. expiresAt no longer defaults to Infinity.

Also: validates revalidate paths before they reach a CDN adapter (raw paths
were forwarded verbatim, so a webhook could send the Fastly API token to an
arbitrary host), escapes cache-key fields (?q=hello%26x=1 collided with
?q=hello&x=1), caps the webhook body before the secret check rather than after,
sets expiry on Redis keys, and replaces KEYS with SCAN.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Commit slice 4, the three broken headline features**

```bash
git add packages/core/test/hooks-run-once.test.js packages/core/test/suspense-client.test.js \
        packages/core/test/reactive.test.js packages/core/src/reactive.js \
        packages/server/src/islands.js packages/server/islands.d.ts \
        packages/server/test/island-hydration.test.js
git commit -m "$(cat <<'EOF'
fix(core,server): Context, client Suspense and island hydration were broken

Context: createComponent popped componentStack before realizing children, so a
child computing its parent context found the Provider already gone and
useContext always returned the default. The pop now happens in a finally after
children are realized. The existing test encoded the bug as correct: it was
titled "should read value from Provider" but rendered no Provider and asserted
the default. Rewritten into five real tests.

Suspense: lazy() threw its promise and Suspense exposed onSuspend, but
onSuspend had zero callers, and the component catch had no thenable check, so
mount() threw a raw Promise and crashed the process. The catch now routes
thenables to the nearest boundary.

Islands: a local `const hydrate` shadowed the what-core import, so hydrate()
called itself and hit its own hydratedIslands guard. Server-rendered islands
therefore never hydrated, and only the empty-node mount() branch worked, which
is the inverse of the point. Also fixes island store hydration reading a
script[data-island-stores] element that nothing emits.

Signals: _sigWrite used === with a comment claiming it handled all primitives
except NaN, which is false for -0/+0, so signals and memos disagreed. Now
Object.is, matching memo().

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 8: Commit slice 5, router and CLI**

```bash
git add packages/router/src/ packages/router/test/ \
        packages/cli/src/cli.js packages/cli/test/ packages/cli/README.md
git commit -m "$(cat <<'EOF'
fix(router,cli): path traversal, open redirect, and an unrunnable what build

Router matched routes against the still-encoded path and decoded after, so
/u/%2e%2e%2f%2e%2e%2fetc%2fpasswd yielded {id: "../../etc/passwd"} straight
into a loader, and app-side validation could not catch it because the value
only became multi-segment after the router decoded it. isSafeUrl was a protocol
blocklist, so //evil.com passed and ctrl/middle-click followed the anchor.
parseQuery used `in`, corrupting values via the prototype chain.

what build emitted an unrunnable dist and exited 0: the import transform
rewrote the old package name 'what' rather than the published
'what-framework', and the runtime was resolved via ../../what/src, which does
not exist outside the monorepo. Both now fail loudly instead of exiting 0.
what generate printed per-route progress and "complete" without writing a
file; it now pre-renders for real. safePath was dead (path.resolve discards
the base when the second argument is absolute, which is what every caller
passes), fixed together with the symlink escape it was masking.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: Commit slice 6, types and the parity gate**

```bash
git add packages/core/index.d.ts packages/router/index.d.ts packages/server/index.d.ts \
        packages/what/router.d.ts packages/what/server.d.ts packages/cache/index.d.ts \
        packages/core/test/api-types.test.js packages/core/test/fixtures/api/ \
        scripts/check-type-parity.mjs scripts/types/ package.json
git commit -m "$(cat <<'EOF'
fix(types): correct signal(), Show/For/Switch, and add a parity gate

signal(0, 'count') is the idiom taught in CLAUDE.md, README, QUICKSTART and
llms-full.txt, and it did not typecheck: the declaration took one argument.
Show/For/Switch were typed to return VNodeChild, which includes undefined, so
every documented control-flow idiom failed with TS2786 while ErrorBoundary and
Match returned VNode and worked.

Adds scripts/check-type-parity.mjs, which enumerates each package's real
runtime exports and fails on any declared-but-missing name. All .d.ts here are
hand-written with no generation step and had drifted: 44 core runtime exports
were undeclared, including hydrate and useLoaderData, and the router and server
declarations promised exports that crashed at module load while tsc passed
clean. Island declarations moved to their own islands.d.ts to match the real
subpath export.

Note: seven router navigation APIs were removed from the declarations rather
than implemented. That is corrected in a follow-up commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 10: Commit slice 7, compiler Context, scaffold and false claims**

```bash
git add packages/compiler/ packages/core/src/render.js packages/core/src/dom.js \
        packages/create-what/ packages/mcp-server/ \
        scripts/update-benchmarks.mjs sites/benchmarks/index.html README.md \
        .size-budgets.json .depot/workflows/ci.yml .github/workflows/ci.yml
git commit -m "$(cat <<'EOF'
fix(compiler): deliver Context through compiled JSX, and fix dotted components

The plugin lowered <Provider><Child/></Provider> so the child was evaluated to
real DOM before the Provider call was entered, which no ordering fix inside
createComponent could rescue. Children of component parents are now emitted as
a single factory, () => [...], deferring the whole subtree. Host-element
codegen is byte-identical: 24 controlled outputs hash-identical, and across 205
real compilation units every changed _$template literal contained <undefined.

That <undefined is the second bug: <Ctx.Provider> was treated as a host element
with an undefined tag name and compiled to _$template("<undefined value=...>").
Any dotted tag is now a component.

Also: create-what never added what-devtools, which the vite plugin hard
requires, so the MCP devtools this framework is built around were dead in every
scaffolded project while the same scaffold wrote .mcp.json and a CLAUDE.md
promising 20+ working tools. And the ~4kB gzip claim on benchmarks.whatfw.com
was a hardcoded string contradicted by check:size and by the README's own
5.5KB; corrected in all three places.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Verify the tree is clean and still green**

```bash
git status --porcelain          # expect empty
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run build && npm run check:size
```
Expected: empty status, 1626 pass / 0 fail, build exit 0, budgets green.

---

## Phase 1: Pay off the debts our fixes created

### Task 2: Establish the DOM performance baseline before changing anything else

> This comes before the perf fixes so the fixes can be measured. The existing
> `bench:gate` guards six Node microbenchmark ops and zero DOM operations,
> which is why an 11.9% `append1k` regression shipped unnoticed.

**Files:**
- Create: `benchmark/dom-gate.mjs`
- Create: `benchmark/baseline/dom.json`
- Read for reference: `benchmark/krausest/bench.mjs`, `benchmark/check-regressions.js:1-40`

**Interfaces:**
- Consumes: the existing krausest harness in `benchmark/krausest/`.
- Produces: `benchmark/dom-gate.mjs` writing `{ [opName]: { opsPerSec?: number, ms: number } }` JSON, shape-compatible with what `check-regressions.js` already reads from `benchmark/baseline/core.json`. Op names, used verbatim in Task 6: `create1k`, `replace1k`, `partialUpdate`, `selectRow`, `swapRows`, `removeRow`, `create10k`, `append1k`, `clear1k`.

- [ ] **Step 1: Read the existing harness before writing anything**

```bash
sed -n '1,120p' benchmark/krausest/bench.mjs
cat benchmark/krausest/RESULTS.md
```
Note its disclosed caveats: no CPU throttling, a double-rAF timing floor of 8-10 ms, and its own instruction to treat differences under ~2 ms as noise. `dom-gate.mjs` must respect these, so it reports medians over multiple rounds and never flags a delta below the floor.

- [ ] **Step 2: Write `benchmark/dom-gate.mjs`**

It must: run only the `what` implementation (not the competitors, which are for the published comparison, not the gate); run 3 rounds of 10 samples; report the **median** per op; write JSON to a path given by `--out`; and exit 0 regardless of results (comparison is `check-regressions.js`'s job, not this script's).

```js
#!/usr/bin/env node

// What Framework - DOM benchmark, gate-comparable output.
// Wraps the krausest harness and emits median-of-rounds timings so
// check-regressions.js can guard real DOM operations, not just Node micro-ops.

import { writeFileSync } from 'node:fs';
import { runWhat } from './krausest/bench.mjs';

const ROUNDS = 3;
const SAMPLES = 10;

const outIndex = process.argv.indexOf('--out');
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];
if (!outPath) {
  console.error('Usage: node benchmark/dom-gate.mjs --out <file.json>');
  process.exit(1);
}

const rounds = [];
for (let i = 0; i < ROUNDS; i++) {
  rounds.push(await runWhat({ samples: SAMPLES }));
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const results = {};
for (const op of Object.keys(rounds[0])) {
  results[op] = { ms: median(rounds.map((r) => r[op])) };
}

writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
console.log(`  DOM benchmark written to ${outPath}`);
```

If `benchmark/krausest/bench.mjs` does not export a reusable `runWhat`, extract one from its existing main path rather than duplicating the measurement logic. Do not change what it measures.

- [ ] **Step 3: Run it and confirm it produces sane numbers**

```bash
node benchmark/dom-gate.mjs --out /tmp/dom-probe.json && cat /tmp/dom-probe.json
```
Expected: nine ops with `ms` values in the range the krausest RESULTS.md documents (roughly: `create1k` ~24, `append1k` ~21-24, `create10k` ~180, the small ops ~9-10). If any op is missing or wildly off, fix the harness wiring before continuing.

- [ ] **Step 4: Commit the harness (baseline comes after the perf fixes)**

```bash
git add benchmark/dom-gate.mjs
git commit -m "$(cat <<'EOF'
test(bench): add a DOM benchmark harness with gate-comparable output

bench:gate guards six Node microbenchmark ops and zero DOM operations, which
is how an 11.9% append1k regression and a 15.2% batch() regression both shipped
without the gate noticing. This emits median-of-3-rounds timings for the nine
krausest operations in the shape check-regressions.js already reads.

Baseline is committed after the pending perf fixes land, so it records the
intended performance rather than the regressed one.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 3: Find and fix the `append1k` and `batch()` regressions

**Files:**
- Modify: `packages/core/src/dom.js` and/or `packages/core/src/render.js` (append/insert path)
- Modify: `packages/core/src/reactive.js` (batch flush path)
- Test: `packages/core/test/reactive.test.js`

**Interfaces:**
- Consumes: `benchmark/dom-gate.mjs` from Task 2.
- Produces: no API change. Restores `append1k` to within 2 ms of 21.1 ms and `batch() 100 writes, 1 effect` to within 5% of 878,604 ops/s.

**Known measurements** (from the Phase 1 verification, medians of 3):

| op | before remediation | after | delta |
|---|---:|---:|---|
| `append1k` | 21.1 ms | 23.6 ms | **+11.9%**, ranges non-overlapping |
| `batch() 100 writes, 1 effect` | 878,604 ops/s | 745,265 ops/s | **-15.2%** |
| `renderToString() list of 100` | n/a | n/a | -6.3% |

Neither op touches thunked children (the krausest app compiles to zero `_$createComponent` calls), so the cause is in the Phase 1 core changes: the shared `_isUnsafeAttr` sanitizer now on the `h()` path, the Suspense generation counter and thenable check in the component catch, or the `Object.is` change in `_sigWrite`.

- [ ] **Step 1: Bisect the cause, do not guess**

```bash
git log --oneline -8
# For each candidate commit from Phase 0, build a tree with just that change
# reverted and measure. Work in /private/tmp, never in the repo.
node benchmark/dom-gate.mjs --out /tmp/dom-current.json
node benchmark/run.js > /tmp/core-current.txt
```
Record which single change accounts for each regression before writing a fix. Report the finding.

- [ ] **Step 2: Write a failing benchmark assertion**

Add a real test, not just a benchmark, that pins the hot-path shape. For `batch()`, the likely cause is work added per-write inside the flush loop:

```js
test('batch() does not re-sort the pending queue per write', () => {
  const sigs = Array.from({ length: 100 }, (_, i) => signal(i));
  let sorts = 0;
  const orig = Array.prototype.sort;
  Array.prototype.sort = function (...args) { sorts++; return orig.apply(this, args); };
  try {
    effect(() => sigs.forEach((s) => s()));
    sorts = 0;
    batch(() => sigs.forEach((s, i) => s(i + 1)));
  } finally {
    Array.prototype.sort = orig;
  }
  assert.ok(sorts <= 1, `expected at most one sort per flush, got ${sorts}`);
});
```
Adjust the assertion to whatever the bisect actually shows. The point is a durable, cheap invariant, not a timing assertion (timing assertions are flaky in CI).

- [ ] **Step 3: Run it and confirm it fails**

```bash
node --test packages/core/test/reactive.test.js
```
Expected: FAIL on the new test.

- [ ] **Step 4: Fix the hot path**

Constraints: do not weaken the security fix. `_isUnsafeAttr` must still run on every URL-bearing attribute on both paths. If the cost is the lookup, hoist the `Set` membership checks so non-URL attributes pay nothing, rather than removing the check. If the cost is the Suspense thenable check, move it off the non-throwing path entirely (a `try/catch` costs nothing until it throws; a check inside the hot loop does).

- [ ] **Step 5: Verify the test passes and the benchmarks recovered**

```bash
node --test packages/core/test/reactive.test.js
node benchmark/dom-gate.mjs --out /tmp/dom-after.json
node benchmark/run.js | grep -E "batch\(\) 100|renderToString\(\) list"
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
```
Expected: new test PASS; `append1k` within 2 ms of 21.1; `batch() 100 writes` within 5% of 878,604 ops/s; full suite still 1626+ pass / 0 fail.
If a regression genuinely cannot be recovered without weakening security, STOP and report the tradeoff with numbers. Do not silently accept it.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src packages/core/test/reactive.test.js
git commit -m "$(cat <<'EOF'
perf(core): recover the append1k and batch() regressions from the security pass

The shared URL sanitizer and the Suspense thenable check landed on hot paths.
append1k had gone 21.1 -> 23.6 ms (+11.9%, non-overlapping ranges across three
rounds) and batch() 100 writes, 1 effect had gone 878,604 -> 745,265 ops/s
(-15.2%), consuming half the gate's budget while still passing it because the
tolerance is 30%.

Both are back within noise. The sanitizer still runs on every URL-bearing
attribute on both render paths; only the dispatch shape changed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 4: Give compiled `props.children` array-like semantics and fix `Switch`/`Match`

> Thunking made `props.children` a function on the compiled path. Components
> that inspect children structurally now get wrong answers, and the unmemoized
> factory re-runs on every render. The concrete casualty is `Switch`/`Match`,
> which was already broken (a crash) and is now a silent blank, which is worse.

**Files:**
- Modify: `packages/core/src/render.js:29-44` (the `_lazyChildren` wrapper)
- Modify: `packages/core/src/components.js:220-240` (`Switch`/`Match`)
- Modify: `packages/compiler/src/babel-plugin.js` (`Switch`/`Match` lowering)
- Create: `packages/core/test/children-factory.test.js`
- Create: `packages/compiler/test/switch-match.test.js`

**Interfaces:**
- Consumes: `_$createComponent(Component, props, childrenFactory)` from the compiler, and `props.children` marked `_lazyChildren`.
- Produces: `props.children` that is `Array.isArray`-true, has a correct `.length`, and realizes exactly once per component instance regardless of how many times it is read.

**Current measured behavior:**

| probe | before thunking | after thunking | target |
|---|---|---|---|
| `Array.isArray(children)`, 2 element kids | `true` | `false` | `true` |
| `children.length` | `2` | `0` (function arity) | `2` |
| children rendered twice | 1 node, moved | 2 nodes, factory re-ran | 1 node, moved |
| children never rendered | expression evaluated | not evaluated | not evaluated (keep this win) |

- [ ] **Step 1: Write the failing test**

```js
// packages/core/test/children-factory.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { _$createComponent } from 'what-core';

test('lazy children are array-like once realized', () => {
  let calls = 0;
  const factory = () => { calls++; return ['a', 'b']; };
  let seen;
  const Probe = (props) => { seen = props.children; return null; };

  _$createComponent(Probe, {}, factory);

  assert.ok(Array.isArray(seen), 'children should be an array');
  assert.equal(seen.length, 2);
  assert.equal(calls, 1, 'factory runs once');
});

test('lazy children realize at most once across repeated reads', () => {
  let calls = 0;
  const factory = () => { calls++; return ['x']; };
  const Probe = (props) => {
    void props.children; void props.children; void props.children;
    return null;
  };

  _$createComponent(Probe, {}, factory);
  assert.equal(calls, 1, `factory ran ${calls} times, expected 1`);
});

test('children are not realized when never read', () => {
  let calls = 0;
  const Probe = () => null;
  _$createComponent(Probe, {}, () => { calls++; return ['x']; });
  assert.equal(calls, 0, 'unread children should not be realized');
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
node --test packages/core/test/children-factory.test.js
```
Expected: FAIL, `children should be an array`.

- [ ] **Step 3: Memoize the factory behind a lazy array-like accessor**

In `render.js`, replace the bare function passthrough with a memoized getter that realizes once and caches, and expose the realized array (not the function) as `props.children`. Keep the `_lazyChildren` marker for `insert()`, `createDOM()` and the hydration path, which already check for it. Use a getter on `props` so "never read" stays unrealized.

- [ ] **Step 4: Run and confirm all three pass**

```bash
node --test packages/core/test/children-factory.test.js
```
Expected: 3 PASS.

- [ ] **Step 5: Write the failing `Switch`/`Match` test**

```js
// packages/compiler/test/switch-match.test.js
// Compile real JSX through the plugin and render it, mirroring the style of
// packages/compiler/test/compiled-context.test.js.
test('compiled Switch renders the first matching Match', () => {
  const html = compileAndRender(`
    <Switch fallback={<p>none</p>}>
      <Match when={false}><p>a</p></Match>
      <Match when={true}><p>b</p></Match>
    </Switch>
  `);
  assert.match(html, /<p>b<\/p>/);
  assert.doesNotMatch(html, /<p>a<\/p>/);
  assert.doesNotMatch(html, /none/);
});

test('compiled Switch renders the fallback when nothing matches', () => {
  const html = compileAndRender(`
    <Switch fallback={<p>none</p>}>
      <Match when={false}><p>a</p></Match>
    </Switch>
  `);
  assert.match(html, /<p>none<\/p>/);
});
```

- [ ] **Step 6: Run and confirm it fails**

Expected: FAIL, blank output. The cause is documented at `packages/core/src/components.js:224`: `Switch` looks for `child.tag === Match` marker vnodes, but `_$createComponent(Match, ...)` returns a DOM container, never a marker. The source comment already admits "Switch/Match are NOT lowered by the fine-grained compiler."

- [ ] **Step 7: Lower `Switch`/`Match` in the compiler**

Treat them like `<Show>`/`<For>`, which already work: recognize `Switch` in `babel-plugin.js` and emit its `Match` children as `{ when, children }` descriptors rather than eagerly-constructed components, so `Switch` receives data it can branch on. Do not make `Switch` sniff realized DOM.

- [ ] **Step 8: Verify and commit**

```bash
node --test packages/compiler/test/switch-match.test.js
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
npm run build && npm run check:size && npm run bench:gate
git add packages/core/src/render.js packages/core/src/components.js \
        packages/compiler/src/babel-plugin.js \
        packages/core/test/children-factory.test.js packages/compiler/test/switch-match.test.js
git commit -m "$(cat <<'EOF'
fix(core,compiler): memoize lazy children and lower Switch/Match

Deferring component children to a factory made props.children a function on the
compiled path: Array.isArray was false, .length was the function arity, and a
second render re-invoked the unmemoized factory and produced duplicate nodes.
Children now realize at most once behind a getter and are exposed as a real
array, while staying unrealized if never read.

Switch/Match was already broken on compiled JSX before this work (it looked for
Match marker vnodes that _$createComponent never produces, and crashed with a
stack overflow); thunking turned the crash into a silent blank. Both are fixed
by lowering Switch/Match in the compiler the way Show and For already are.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 5: Record the DOM baseline and tighten the gate

**Files:**
- Create: `benchmark/baseline/dom.json`
- Modify: `benchmark/check-regressions.js:16-33`
- Modify: `package.json` (`bench:gate` script)

**Interfaces:**
- Consumes: `benchmark/dom-gate.mjs` (Task 2), the recovered performance from Task 3.
- Produces: `npm run bench:gate` failing on a >10% DOM regression or >15% DX regression.

- [ ] **Step 1: Record the baseline, now that performance is recovered**

```bash
node benchmark/dom-gate.mjs --out benchmark/baseline/dom.json
cat benchmark/baseline/dom.json
```
Sanity-check `append1k` is back near 21 ms before committing this file. A baseline recorded while regressed would permanently bless the regression.

- [ ] **Step 2: Tighten tolerances and add the DOM ops to the gate**

In `check-regressions.js`, change the defaults at lines 16-17 and add a DOM guard set:

```js
const coreTolerance = Number(process.env.WHAT_BENCH_TOLERANCE_CORE ?? '0.10');
const dxTolerance = Number(process.env.WHAT_BENCH_TOLERANCE_DX ?? '0.15');
const domTolerance = Number(process.env.WHAT_BENCH_TOLERANCE_DOM ?? '0.10');

const DOM_GUARD_OPS = new Set([
  'create1k', 'replace1k', 'partialUpdate', 'selectRow',
  'swapRows', 'removeRow', 'create10k', 'append1k', 'clear1k',
]);
```

DOM ops are `ms` (lower is better), the existing ops are `opsPerSec` (higher is better). Handle both directions explicitly; do not assume one.

Respect the harness's own noise floor: never fail an op whose absolute delta is under 2 ms, even if the percentage exceeds the tolerance. The small ops sit at 9-10 ms where the double-rAF floor dominates.

- [ ] **Step 3: Prove the gate actually catches a regression**

Do not trust an untested gate. Temporarily inflate one baseline number and confirm it fails:

```bash
node -e "const f='benchmark/baseline/dom.json';const j=require('fs');const d=JSON.parse(j.readFileSync(f));d.append1k.ms*=0.7;j.writeFileSync('/tmp/dom-tampered.json',JSON.stringify(d))"
WHAT_BENCH_DOM_BASELINE=/tmp/dom-tampered.json npm run bench:gate
```
Expected: FAIL naming `append1k`. If it passes, the gate is not wired up. Then restore.

- [ ] **Step 4: Commit**

```bash
git add benchmark/baseline/dom.json benchmark/check-regressions.js package.json
git commit -m "$(cat <<'EOF'
test(bench): guard real DOM operations and tighten tolerances to 10%/15%

The gate previously guarded six Node microbenchmark ops at 30%/35%, so a 15.2%
batch() regression passed it and an 11.9% append1k regression was not measured
at all. It now guards the nine krausest DOM operations against a committed
baseline, at 10% for core and DOM and 15% for DX, with an absolute 2 ms floor
so the small ops are not flagged on double-rAF noise.

Verified by tampering with a baseline value and confirming the gate fails.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 2: Restore the API surface

### Task 6: Implement the seven deleted router navigation APIs

> These were removed from the declarations rather than implemented, on my
> instruction, to keep parallel tracks from conflicting. That optimized for
> type honesty and made the product worse. `useParams` and `useNavigate` are
> table-stakes router APIs.

**Files:**
- Modify: `packages/router/src/index.js`
- Modify: `packages/what/router.d.ts`, `packages/router/index.d.ts` (restore declarations)
- Create: `packages/router/test/navigation-api.test.js`

**Interfaces:**
- Consumes: existing `useRoute()` (`packages/router/src/index.js:535`), `navigate(to, options)`, `prefetch(href)`, and `isSafeUrl`.
- Produces:
  - `useParams<T = Record<string,string>>(): T`
  - `useSearch<T = Record<string,string>>(): T`
  - `useNavigate(): typeof navigate`
  - `redirect(to: string, options?: NavigateOptions): never`
  - `prefetchRoute(href: string): void`
  - `beforeNavigate(fn: (to: string, from: string) => boolean | Promise<boolean>): () => void`
  - `afterNavigate(fn: (to: string, from: string) => void): () => void`

- [ ] **Step 1: Write the failing tests**

```js
// packages/router/test/navigation-api.test.js
import { test } from 'node:test';
import assert from 'node:assert';
import { useParams, useSearch, useNavigate, redirect,
         beforeNavigate, afterNavigate, navigate } from 'what-router';

test('useParams returns the current route params', () => {
  // Follow the setup style already used in packages/router/test/router.test.js
  // to install a route match, then:
  assert.deepEqual(useParams(), { id: '42' });
});

test('useNavigate returns a callable navigate', () => {
  assert.equal(typeof useNavigate(), 'function');
});

test('redirect throws a navigation signal rather than returning', () => {
  assert.throws(() => redirect('/login'), (e) => e && e.to === '/login');
});

test('redirect refuses an unsafe target', () => {
  assert.throws(() => redirect('//evil.com/x'), /unsafe|invalid/i);
});

test('beforeNavigate can cancel and returns an unsubscribe', async () => {
  const off = beforeNavigate(() => false);
  const before = location.pathname;
  await navigate('/blocked');
  assert.equal(location.pathname, before, 'navigation should have been cancelled');
  off();
});

test('afterNavigate fires with to and from', async () => {
  const seen = [];
  const off = afterNavigate((to, from) => seen.push([to, from]));
  await navigate('/next');
  assert.equal(seen.length, 1);
  off();
});
```

- [ ] **Step 2: Run and confirm they fail**

```bash
node --test packages/router/test/navigation-api.test.js
```
Expected: FAIL, `does not provide an export named 'useParams'`.

- [ ] **Step 3: Implement**

Most are thin wrappers over what already exists:

```js
export function useParams() { return useRoute().params; }
export function useSearch() { return useRoute().search; }
export function useNavigate() { return navigate; }
export function prefetchRoute(href) { return prefetch(href); }
```

`redirect` must reuse `isSafeUrl` (Phase 1 hardened it against protocol-relative targets) and throw a typed signal the router catches, not return. `beforeNavigate`/`afterNavigate` are subscriber lists consulted by the existing navigation path, each returning an unsubscribe. Guards must run before the URL changes; `afterNavigate` runs after. Do not add a dependency, and do not duplicate `guard()` if it already provides the hook point.

- [ ] **Step 4: Run and confirm they pass**

```bash
node --test packages/router/test/navigation-api.test.js
```
Expected: 6 PASS.

- [ ] **Step 5: Restore the declarations and prove parity**

Re-add the seven declarations to both `packages/what/router.d.ts` and `packages/router/index.d.ts` (they are two hand-maintained copies of the same surface, and neither was a superset of the other; keep them in sync).

```bash
node scripts/check-type-parity.mjs
```
Expected: exit 0, zero phantom exports.

- [ ] **Step 6: Commit**

```bash
git add packages/router/ packages/what/router.d.ts
git commit -m "$(cat <<'EOF'
feat(router): implement useParams, useNavigate, redirect and the navigate hooks

These were declared in the .d.ts but did not exist at runtime, so tsc passed
and the app died at module load. The prior pass deleted the declarations to
make the types honest, which fixed the crash by removing the feature.
useParams and useNavigate are table-stakes router APIs, so they are now
implemented rather than promised or removed.

useParams/useSearch/useNavigate/prefetchRoute wrap the existing useRoute,
navigate and prefetch. redirect validates through isSafeUrl and throws a
navigation signal. beforeNavigate can cancel; both hooks return unsubscribes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 7: Revert the size budget raise

> Measurement after the fact showed the raise was not needed: actual growth was
> 292 B to 6023 B, which fits the original 6200 B ceiling with 177 B to spare.
> The decision to raise was made on my estimate of 192 B of headroom, before
> the thunking cost was known to be zero.

**Files:** `.size-budgets.json`

- [ ] **Step 1: Confirm current size fits the old budget**

```bash
npm run check:size 2>&1 | grep core-counter
```
Expected: `6023 B` or lower. If Tasks 3-6 pushed it above 6200 B, STOP and report the number rather than keeping the raised ceiling silently.

- [ ] **Step 2: Revert the ceiling and its comment**

```bash
git diff HEAD~ -- .size-budgets.json   # see what the raise added
```
Set `core-counter` back to `6200` and remove the 2026-07-26 raise note from `$comment`, leaving the file's existing measurement-date convention intact.

- [ ] **Step 3: Verify and commit**

```bash
npm run check:size
git add .size-budgets.json
git commit -m "$(cat <<'EOF'
chore(size): restore the 6200 B core-counter budget

The raise to 6656 B was approved on an estimate of 192 B of remaining headroom.
Direct measurement afterwards showed actual growth was 292 B to 6023 B, which
fits the original ceiling with 177 B to spare, and that thunked children cost
nothing measurable (4000 component-child sites, four alternating rounds, no
difference outside run-to-run variance). The raise was never required.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3: Clean DX, enforced

### Task 8: Adopt the structured error system in the runtime that ships it

> Eight codes exist with good text. `createWhatError()` has two call sites, both
> in `guardrails.js`, both for the same code. `classifyError()` has zero callers.
> Meanwhile 32 bare `throw new Error` and the flagship `ERR_INFINITE_EFFECT`
> code is never constructed: the actual detector emits a hand-written
> `console.warn`. `getHealth()` therefore returns `effectCycleRisk: false`
> unconditionally, because it filters for codes that never fire.

**Files:**
- Modify: `packages/core/src/reactive.js:639-647` (infinite-loop detector), `:85-90` (write-in-render)
- Modify: `packages/core/src/errors.js:247-252` (context spread order bug)
- Modify: `packages/devtools-mcp/src/tools-agent.js:12-120` (import instead of hand-copy)
- Delete: `packages/core/src/warnings.js` (110 LOC, never imported, duplicates this system)
- Create: `docs/reference/ERRORS.md` and a docs-site error reference page
- Test: `packages/core/test/errors.test.js`, plus a catalogue-sync test

- [ ] **Step 1: Write the failing tests**

```js
test('the infinite-effect detector emits ERR_INFINITE_EFFECT', () => {
  clearCollectedErrors();
  const a = signal(0);
  effect(() => a(a() + 1));           // self-writing cycle
  flushSync();
  const codes = getCollectedErrors().map((e) => e.code);
  assert.ok(codes.includes('ERR_INFINITE_EFFECT'), `got ${JSON.stringify(codes)}`);
});

test('getHealth reports effectCycleRisk once a cycle has been detected', () => {
  assert.equal(getHealth().effectCycleRisk, true);
});

test('caller context cannot overwrite the error code', () => {
  const e = createWhatError('MISSING_SIGNAL_READ', { code: 'ERR_SPOOFED', signalName: 'x' });
  assert.equal(e.code, 'ERR_MISSING_SIGNAL_READ');
});

test('the devtools-mcp catalogue matches core exactly', async () => {
  const { ERROR_CODES } = await import('what-core');
  const { ERROR_DATABASE } = await import('what-devtools-mcp/tools-agent');
  assert.deepEqual(Object.keys(ERROR_DATABASE).sort(), Object.keys(ERROR_CODES).sort());
});
```

- [ ] **Step 2: Run and confirm they fail**

Expected: FAIL on all four. `errors.js:247-252` spreads `...context` last, so a caller-supplied `code` silently overwrites `ERR_RUNTIME`.

- [ ] **Step 3: Route the real detectors through `createWhatError`**

Emit `ERR_INFINITE_EFFECT` from the 25-iteration detector and `ERR_SIGNAL_WRITE_IN_RENDER` from the write-in-render warning, preserving the existing dev-only console output so nothing gets noisier in production. Fix the spread order. Replace `ERROR_DATABASE` with an import from `what-core` so the two catalogues cannot desynchronize. Delete `warnings.js` and re-point its two diagnostics at the structured system.

- [ ] **Step 4: Run, then write the error reference**

`ERROR_CODES` already carries `code`, `severity`, `template`, `suggestion` and `codeExample` for all eight. Generate `docs/reference/ERRORS.md` from the catalogue rather than hand-writing it, so it cannot drift. Add the page to `docs-site/build.mjs`'s route table.

- [ ] **Step 5: Verify and commit**

```bash
npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
node docs-site/build.mjs
git add packages/core/src packages/devtools-mcp/src/tools-agent.js docs/reference/ERRORS.md docs-site/
git rm packages/core/src/warnings.js
git commit -m "$(cat <<'EOF'
fix(core): actually emit the structured errors this framework advertises

Eight codes existed with genuinely good text, and seven were never constructed
at runtime. createWhatError had two call sites, both for the same code;
classifyError had none. The infinite-loop detector, the flagship case, emitted
a hand-written console.warn instead, so getHealth's effectCycleRisk filter
matched nothing and returned false unconditionally.

Routes the real detectors through the catalogue, fixes a spread order that let
caller context overwrite the error code, replaces devtools-mcp's hand-copied
ERROR_DATABASE with an import plus a sync test, deletes the dead parallel
warnings.js, and generates a docs reference from the catalogue.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

### Task 9: Resolve `{stable: true}` and the 25-iteration cascade cap

> `{stable:true}` is public, typed, and undocumented, and it voids the
> scheduler's central guarantee. Measured: a non-stable 2-dep effect gives
> `["1/10","2/20"]`; stable gives `["1/10","2/10","2/20"]`, a torn intermediate
> state, which is exactly what `docs/EFFECT-TIMING.md:26-32` promises cannot
> happen. It also sets `currentEffect = null` before running, so it never
> re-tracks: a conditional read that switches branches silently stops reacting.
> Separately, the flush cap abandons legitimate cascades: measured stopping at
> 26 of 40 rounds with only a `console.warn`.

**Files:** `packages/core/src/reactive.js:456, 505-527, 593, 649-650`, `packages/core/index.d.ts:29`, `docs/EFFECT-TIMING.md`

- [ ] **Step 1: Write failing tests pinning both behaviors**

```js
test('a multi-dep stable effect does not observe torn state', () => {
  const first = signal('1'), last = signal('10');
  const seen = [];
  effect(() => seen.push(`${first()}/${last()}`), { stable: true });
  batch(() => { first('2'); last('20'); });
  assert.deepEqual(seen, ['1/10', '2/20']);
});

test('a stable effect re-tracks when a conditional read switches branches', () => {
  const useA = signal(true), a = signal('a'), b = signal('b');
  const seen = [];
  effect(() => seen.push(useA() ? a() : b()), { stable: true });
  useA(false);
  seen.length = 0;
  b('b2');
  assert.deepEqual(seen, ['b2'], 'newly live signal was never tracked');
});

test('a deep but terminating cascade completes', () => {
  const n = signal(0);
  effect(() => { if (n() < 40) n(n() + 1); });
  flushSync();
  assert.equal(n(), 40);
});
```

- [ ] **Step 2: Run and confirm all three fail**

- [ ] **Step 3: Decide and implement**

Recommended: restrict `{stable:true}` to the single-dep case it is safe for (auto-promotion at `reactive.js:456` already limits itself this way) and ignore it with a dev warning for multi-dep effects, rather than removing a public option. For the cap, distinguish a cycle from depth: track whether the pending set is *repeating* rather than merely deep, and only abort on a genuine cycle. If the cap must stay, raise it substantially and make exhaustion emit `ERR_INFINITE_EFFECT` (Task 8) rather than a bare warn.

- [ ] **Step 4: Document `stable` in `docs/EFFECT-TIMING.md`**

It currently appears zero times in `docs/`. Whatever the semantics end up being, they must be written down next to the guarantee they interact with.

- [ ] **Step 5: Verify, benchmark and commit**

```bash
npm test && npm run bench:gate
```
`bench:gate` matters here: `stable` exists for speed, so confirm the restriction did not regress the guarded ops.

### Task 10: Fix the wrong documentation

> 8 of 12 sampled doc examples are wrong, 5 of which throw or return HTTP
> errors. Two pages contradict each other on the server-action wire format.

**Files:** `docs/AGENT-PATTERNS.md:144,156,165`, `docs/API.md:93,120`, `docs/GOTCHAS.md`, `docs/QUICKSTART.md:64`, `GETTING-STARTED.md:169`, `CLAUDE.md:11`, `docs-site/docs/learn/{actions,ssr,caching,signals}.html`, `docs-site/docs/reference/For.html`

- [ ] **Step 1: Fix the five that throw or 400/404**

| Location | Wrong | Right |
|---|---|---|
| `AGENT-PATTERNS.md:144,147` | `state.items()` inside `derived()` | `state.items` (the proxy at `store.js:78-80` already returns the value) |
| `AGENT-PATTERNS.md:156` | `cart.itemCount()` | `cart.itemCount` (`store.js:113-118` defines getters) |
| `AGENT-PATTERNS.md:165` | `cart.items.set(...)` | `useStore()` returns read-only getters plus actions; show an action |
| `learn/actions.html:114` | `data-action` attribute | a hidden input, plus the `_csrf` field required at `action-handler.js:145` |
| `learn/ssr.html:305` | `actionId` read from `req.body` | the `X-What-Action` header (`actions.js:130`), matching `learn/actions.html:127` |

- [ ] **Step 2: Add the run-once trap to `GOTCHAS.md`**

`if (isLoading()) return <Spinner/>` appears three times with no warning, and pins the spinner forever because components run once. The framework source warns about exactly this in three places (`router/src/index.js:436`, `components.js:158`, `:216`) while the 20 numbered gotchas omit it. Add it, and fix the three occurrences.

- [ ] **Step 3: Resolve the API-style contradiction**

`CLAUDE.md:11` and `README.md:82` teach `count(5)`; `GETTING-STARTED.md:169` and `docs/API.md:9` say "prefer `sig.set(value)`". The docs site uses `.set(` 144 times and the callable form zero times. Pick one, state it once, and make all five locations agree.

- [ ] **Step 4: Fix the remaining three**

`For.html:61,114` documents a `fallback` prop the compiler silently drops (`babel-plugin.js:1714-1721` reads only `each` and `key`); `For.html:138` describes runtime-`For` keying while compiled `<For>` without `key` is unkeyed; `API.md:93` documents `memo(component, areEqual?)` but `components.js:16` ignores `_areEqual`; `API.md:120` lists `storeComputed` and `atom` as current when both warn deprecated.

- [ ] **Step 5: Commit**

### Task 11: Wire the unrun tests and add the missing CI gates

> Six of eight `stress-tests/` files are unwired and three of them fail, 9
> tests total. Five Playwright specs in `examples/real-world-suite/tests/` are
> invisible to the runner because the directory is `tests/` and the extension
> is `.spec.js`. There is no `tsc`, no ESLint and no coverage anywhere in CI.

**Files:** `scripts/run-all-tests.mjs`, `.depot/workflows/ci.yml`, `.github/workflows/ci.yml`, `stress-tests/*`, root `tsconfig.json` (new)

- [ ] **Step 1: Run the six unwired stress files and catalogue the failures**

```bash
for f in stress-tests/stress-test*.js; do echo "== $f"; node "$f" 2>&1 | tail -5; done
```
Expected: `stress-test.js` 3 failures, `stress-test-compiler.js` 1, `stress-test-compat.js` 5. The `-0`/`+0` one should already pass after Phase 0. Most of the compat failures are stale expectations (`useState` now returns a signal getter), not real bugs; fix the tests, not the runtime, where that is the case.

- [ ] **Step 2: Wire them in and make them green**

- [ ] **Step 3: Add a root `tsconfig.json` for typechecking only**

`noEmit: true`, `allowJs: false`, checking the `.d.ts` surface and any TS fixture. This is the first `tsconfig.json` in the repo; `typescript@^5.7.3` is already a devDependency that nothing invokes.

- [ ] **Step 4: Add `typecheck`, `lint` and `coverage` jobs to CI**

Add to both workflow copies. ESLint runs `eslint-plugin-what`'s own 9 rules against the repo, which currently never happens. Coverage uses `node --experimental-test-coverage`; report the number, and do not set a threshold in this task. Recording the first real coverage number is the deliverable, since none has ever been measured.

- [ ] **Step 5: Commit**

### Task 12: Publish the honest benchmarks

> The rigorous krausest results are linked from nowhere: grep for `krausest`
> outside `benchmark/` returns 0 hits in the README, the docs, or any site.
> Meanwhile `benchmarks.whatfw.com` publishes only What's own numbers from an
> in-process Node microbenchmark with no DOM, labelled "Real measured
> performance data."

**Files:** `sites/benchmarks/`, `scripts/update-benchmarks.mjs`, `README.md`, `benchmark/krausest/RESULTS.md`

- [ ] **Step 1: Publish the comparison, including the unflattering parts**

Geomean vs vanilla: vanilla 1.00, **what 1.06**, react 1.13, solid 1.15. Bundle: **what 29.7 kB vs solid 12.2 kB**. State the bundle gap first, in your own words, before anyone else does. The audience that reads benchmark methodology will respect the disclosure more than the numbers.

- [ ] **Step 2: Replace or clearly relabel the DOM-less microbenchmark**

If the Node micro-ops stay on the site, label them as what they are: in-process reactivity throughput, no rendering. They cannot be presented as "real measured performance."

- [ ] **Step 3: Carry over the harness's own caveats**

Not the official harness; no CPU throttling; double-rAF floor of 8-10 ms; differences under ~2 ms are noise; `what` is built from the working tree. `RESULTS.md` already discloses all of these unprompted. Keep that.

- [ ] **Step 4: Commit and deploy**

---

## Out of scope for this plan

Tracked so they are not lost, deliberately deferred:

- **Nested layout composition, client-side loaders, route code splitting.** `Outlet` and `buildLayoutChain` are no-ops because the feature is unfinished, not because they are cruft. `file-router.js:245` emits static imports with zero `import(` in the file. This is a feature-sized project and needs its own plan.
- **`$$typeof: Symbol.for('react.element')` in `what-react`.** Small change, unlocks MUI, emotion, hoist-non-react-statics, react-transition-group and recharts. Worth its own task once the ecosystem story is a priority.
- **Decomposing `babel-plugin.js` (2,544 LOC) and `render.js` (1,843 LOC).** Highest-risk files in the repo, but a refactor during active correctness work is the wrong sequencing.
- **Unpublishing `what-mcp`** (734 LOC of hardcoded doc strings, self-labelled DEPRECATED, still version-bumped every release).
- **Moving `docs/superpowers/`** (3,676 lines of internal specs, 45% of `docs/`) out of the public docs directory. Note this plan itself lives there.
- **Deleting `examples/package-demos`** (10 empty directories on a fresh clone) and fixing the seven examples pinned to `^0.6.0`, which do not satisfy 0.11.7 and work only because workspaces symlink over the top.
- **Pinning the 23 unpinned CI actions by SHA.**

## Operator actions, not code

- **Rotate the npm token in `.env`.** It is a live automation token for all 14 packages, verified never committed and correctly gitignored, but it sits in cleartext where agents and dev tooling execute. Task 1 closes the workflow path that could exfiltrate it; only rotation closes the credential.
- **Re-run `npm audit`.** The security audit could not complete it: the registry bulk-advisory endpoint returned malformed gzip on both attempts. Dependency CVE status is **unknown**, not clean. A fresh scaffold reported 7 vulnerabilities (2 moderate, 5 high) via `@hono/node-server` and `brace-expansion`.
