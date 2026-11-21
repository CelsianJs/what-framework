# What vs SolidJS 2.0: review and upgrade plan

*2026-11-20. Compared: What 0.14.0 (git `0731cbb8`) against `solid-js@2.0.3`, `solid-js@1.9.20`, React 19, alien-signals 3.2.1 and `@preact/signals-core` 1.14.5.*

## Verdict

Solid 2.0 is not faster than What where it matters, and it is larger. Its signal engine is the slowest of the five we measured, and its bundles are bigger than ours on every app. What is worth taking from it is its semantics: async values inside the reactive graph, transitions that commit together, a diagnostics stream that carries a code, an owner path and a source location, and dev code that is really absent from production builds.

The review was more useful for what it showed about What:

- **The signal engine has algorithmic defects.** It fails 6 of the 20 standard reactivity workloads, runs out of memory on 22 stacked diamonds, has no equality cut-off, and lets effects observe stale derived values.
- **`renderToStream` leaks data between concurrent requests.** One user's page can render another user's context value.
- **Server rendering is 14 to 19 times slower than Solid 2.0** and 23 to 32 times slower than Solid 1.9, because the compiler has no server target.
- **Dev code ships in production builds**, about 1 kB gzip per app.
- **The agent tooling is weaker than the pitch.** Only one of 33 error codes is ever raised by the core runtime as a structured error, and two MCP tools give wrong answers.

Each has a measured fix, most with a working prototype. With them applied, the prototypes put What ahead of both Solid majors on client script time, level with Solid 1.9 on server rendering, and at alien-signals class on raw reactivity.

## Baseline numbers

Apple M3 Max, Node 22.13.1, Chromium 156. Every harness lives in `benchmark/` and regenerates its own `RESULTS.md`.

### Client rendering: `benchmark/krausest`

Script time per operation, from the click until the framework's synchronous and microtask work is done, with the DOM verified. Median ms.

| Operation | Vanilla | What | Solid 1.9 | Solid 2.0 | React 19 |
|---|---:|---:|---:|---:|---:|
| Create 1,000 rows | 1.49 | 2.67 | 1.96 | 2.39 | 4.62 |
| Replace 1,000 rows | 3.23 | 7.12 | 3.99 | 4.05 | 9.12 |
| Update every 10th row | 0.145 | 0.200 | 0.178 | 0.212 | 0.695 |
| Select a row | 0.068 | 0.363 | 0.090 | 0.142 | 0.462 |
| Swap two rows | 0.078 | 0.193 | 0.275 | 0.150 | 4.43 |
| Remove a row | 0.073 | 0.210 | 0.243 | 0.217 | 0.677 |
| Create 10,000 rows | 15.2 | 25.2 | 18.7 | 20.2 | 149.7 |
| Append 1,000 rows | 1.63 | 2.47 | 1.99 | 2.23 | 5.05 |
| Clear 1,000 rows | 2.03 | 4.77 | 2.07 | 2.26 | 3.42 |
| **Geometric mean vs vanilla** | **1** | **2.20** | **1.54** | **1.61** | **5.83** |
| Same, at 4× CPU throttle | 1 | 3.65 | 2.76 | 2.53 | 9.26 |

The older click-to-paint metric reads about 30 ms for every framework on this Chromium, because two animation frames dominate it. It no longer separates frameworks, so the script-only metric replaces it.

### Signal engine: `benchmark/reactivity`

The standard js-reactivity-benchmark suite, 20 workloads.

| | What | Solid 1.9 | Solid 2.0 | alien-signals | Preact signals |
|---|---:|---:|---:|---:|---:|
| Workloads completed | 14 of 20 | 20 | 20 | 20 | 20 |
| Correctness checks | failed | passed | passed | passed | passed |
| Geometric mean vs fastest, 14 shared workloads | 6.26× | 3.85× | 5.85× | 1.05× | 1.46× |
| `updateSignals` (ms) | 1,275 | 855 | 1,706 | 302 | 292 |
| `diamond` (ms) | 485 | 275 | 388 | 72 | 116 |
| `25-1000x5` dynamic graph (ms) | 20,441 | 969 | 1,376 | 342 | 497 |
| `cellx1000` (ms) | out of memory | 1.17 | 1.72 | 0.45 | 0.41 |

What's six failures are four heap exhaustions at a 768 MB limit and two timeouts at 180 s.

Callback counts are deterministic. On `avoidablePropagation` What runs 5,005 computed and 1,001 effect callbacks where every other engine runs 2,002 and 0. On `mux` it runs 1,800 effects where the others run 18.

### Bundle size: `benchmark/size`

JavaScript bytes, minified / gzip.

| App | What | Solid 1.9 | Solid 2.0 | React 19 |
|---|---:|---:|---:|---:|
| Hello (counter) | 23,795 / 8,113 | 8,797 / 3,640 | 28,382 / 11,785 | 222,667 / 69,203 |
| Todo | 34,132 / 12,033 | 11,243 / 4,684 | 34,502 / 14,264 | 223,682 / 69,638 |
| Krausest | 34,297 / 12,100 | 13,224 / 5,441 | 62,145 / 24,083 | 196,314 / 61,526 |

What is already smaller than Solid 2.0. The target is the Solid 1.9 class.

### Server rendering: `benchmark/ssr`

The krausest table page rendered in Node, one fresh process per job, output verified equivalent across frameworks.

| 1,000 rows | What | Solid 1.9 | Solid 2.0 | React 19 |
|---|---:|---:|---:|---:|
| String render, median ms | 4.75 | 0.157 | 0.249 | 1.98 |
| Hydratable string render, median ms | 4.47 | 0.195 | 0.322 | 2.05 |
| Heap allocated per render, MB | 11.1 | 0.36 | 0.92 | 6.85 |
| Stream, time to done, ms | 40.4 | 1.70 | 0.52 | 3.95 |
| Stream, chunks | 18,049 | 1 | 1 | 62 |
| Async boundary: footer sent at, ms | 63.9 | 1.66 | 0.73 | 0.25 |
| Async boundary: fallback sent before data | no | yes | yes | yes |

At 10,000 rows the string render takes 53.3 ms in What, 1.69 ms in Solid 1.9, 3.46 ms in Solid 2.0 and 37.2 ms in React 19.

## What is broken in What today

Every item has a repro script from the review.

| # | Problem | Impact |
|---|---|---|
| 1 | `renderToStream` keeps component frames on a process-wide stack across `await`s | Concurrent requests render each other's context values. Leftover frames poison every later render in the process. |
| 2 | Notification walks every path through the graph | Exponential time and memory. 66 computeds in stacked diamonds exhaust a 64 MB heap on one write. |
| 3 | No equality cut-off on computeds | A computed that recalculates to the same value re-runs everything downstream. |
| 4 | Computed evaluation restarts by throwing a sentinel | `user() ? name() : 'guest'` throws on every read once `user` is null. A `try/catch` around a computed read caches the fallback permanently. |
| 5 | Effects can observe stale derived values mid-flush | Two scheduler glitches, reproducible in production mode. |
| 6 | Effect cascades longer than 25 rounds are dropped silently | Lost updates. |
| 7 | Effects created in a component body outlive the component | Stray runs after unmount; a component-scope computed over a module signal is retained forever. |
| 8 | Errors thrown in bindings after mount never reach `<ErrorBoundary>` | They only reach `console.error`. |
| 9 | `<Suspense>` rebuilds its children when a promise resolves; `createResource` never suspends on the client | Lost DOM state and focus on every load. |
| 10 | `useQuery` keys are frozen at creation | A changed id never refetches. |
| 11 | Server-action `revalidate` fires on the client and nothing listens | Stale data after mutations. |
| 12 | `what-framework/server` under esbuild drops the request-context install | Async components read `undefined` context. |
| 13 | `<Suspense>` nested in a boundary streams its fallback as the final HTML | Wrong page. |
| 14 | Streamed pages carry no hydration markers; hydration reports false mismatches and evaluates every reactive child twice | Streamed pages cannot hydrate; wasted work on hydrate. |
| 15 | The CSRF cookie overwrites a route's `Set-Cookie`; the Node adapter keeps only the last `Set-Cookie` | Lost cookies. |
| 16 | A client disconnect does not stop the loader or the render | Wasted server work. |
| 17 | `__DEV__` is decided at runtime | Dev branches ship in production: about 2.8 kB minified, 1 kB gzip per app. |
| 18 | `what_signal_trace` credits the wrong writer; `what_fix` knows 10 of 33 codes and misroutes anything containing "render"; `__WHAT_AGENT__.health()` always reports zero | Agents are pointed at the wrong code. |
| 19 | `classList={{…}}` renders `class="[object Object]"`; `ref={letVariable}` throws | Compiler bugs. |
| 20 | `useTransition` is an animation helper that returns an object | The React form `const [isPending, startTransition] = useTransition()` throws. |

## Ranked pull-in list

Gains are measured on experimental copies of the repo unless marked as estimates. Effort is for one engineer: S under a day, M one to three days, L more.

### A. Correctness and security

| # | Change | Measured result | Effort | Risk |
|---|---|---|---|---|
| A1 | Keep component frames off the shared stack across `await`s | Cross-request leak gone; server and core suites pass | S | Low |
| A2 | Build-time `__DEV__` with development and production builds chosen by export condition | Hello −2,777 B minified, −971 B gzip. Required before A3 fits the size budget | S–M | Low; keep the dual-instance gate |
| A3 | New signal engine: push-pull marking with linked dependency edges, equality cut-off, parent-first effect order, cached errors, bounded-stack evaluation | 20 of 20 workloads. One binding update 133 ns → 38 ns. Signal memory 553 → 217 B. 12,000-batch fuzz with no glitch. Core suite 1,082 of 1,084, both failures assert old behaviour | L | Medium: two documented ordering changes |
| A4 | Server fixes: request-context install, nested boundaries, cookies, abort, `<Head>` under a DOM shim, keyless resource keys | Each repro passes | S–M | Low |
| A5 | Agent-tool fixes: writer attribution at write time, one error catalogue behind `what_fix` and `what_errors`, real data behind `__WHAT_AGENT__`, guardrail output that matches production | `what_fix` coverage 10 → 33 codes; trace 0 of 2 → 2 of 2 correct (expected) | S–M | Low |
| A6 | Compiler fixes for `classList` objects and `ref={letVariable}` | Verified in Chromium | S | Low |

### B. Speed and bytes

| # | Change | Measured result | Effort | Risk |
|---|---|---|---|---|
| B1 | Dispose list rows through their scope; clear and replace with one DOM call | Replace −47%, clear −55% | M | Low |
| B2 | O(1) selector, with the compiler rewriting `selected() === row.id` inside keyed rows to use it | Select 0.335 → 0.085 ms, ahead of both Solids | M | Low; needs an opt-out |
| B3 | Fewer nodes per row: drop unneeded hole markers, no comment marker on single-node keyed rows, `textContent` for text | 3,000 fewer DOM nodes per 1,000 rows | S–M | Low |
| B4 | Lazy templates, no per-component props proxy, template minification | Part of the combined result below | S | Low |
| B5 | Compiled-only runtime path: compiled apps no longer bundle the `h()` renderer, boundaries or portals unless they use them | Hello 7,823 → 4,540 B gzip together with A2 and B4 | M | Medium: hydration, islands and react-compat need re-verifying |
| B6 | Server string quick wins: single-scan escape, cached attribute rules, one props copy | 4.35 → 1.49 ms per 1,000 rows; allocation 11.1 → 4.8 MB | S | Low |
| B7 | Buffered stream renderer with an explicit work stack | 60 ms in 18,049 chunks → 1.9 ms in 4 chunks | S–M | Low |
| B8 | Compiled server target with eager string holes | 0.172 ms per 1,000 rows on a hand-written prototype (Solid 1.9: 0.157, Solid 2.0: 0.244) | L | Medium: new back-end in the compiler |
| B9 | Out-of-order streaming: shell and fallbacks first, boundaries swapped in as they resolve | Footer at 0.05 ms instead of 54 ms | M | Medium |
| B10 | Component context and disposal on the engine's owner tree; lists split into an engine mapper and a small node reconciler; keyed-only entry | Closes the remaining 10–15% on create; about −2 to −5 kB on todo (estimate) | L | Higher: touches every render path |

B1 to B4 together took the krausest geometric mean from 2.19 to 1.50 in one interleaved run, against Solid 1.9 at 1.57 and Solid 2.0 at 1.61.

### C. Capabilities

Design principle: Solid's semantics under React's names, with a read after a write still returning the new value.

| # | Change | Effort |
|---|---|---|
| C1 | Async `computed`: a computed whose function returns a promise is an async node. Readers of a pending value keep their previous output and re-run when it lands. `.pending()`, `refresh()`, `isPending()` | L |
| C2 | `<Suspense>` shows its fallback on first load only and keeps children mounted during refresh. `<ErrorBoundary>` catches async, binding and effect errors, and `reset()` retries | L |
| C3 | `startTransition` and React-shaped `useTransition`: everything dirtied inside waits for the async work it caused, then commits in one flush. Router navigations run as transitions | L |
| C4 | `useOptimistic` in React 19's shape with rollback that never flickers; server actions run as transitions; `useActionState`, `useFormStatus`, `use()` | M |
| C5 | `query(key, fetcher)` with reactive keys and one cache under every async-read hook; server-action revalidation wired to that cache and the router | M–L |
| C6 | Hydration protocol: owner-path keys, one data channel so nothing refetches on hydrate, claim-by-key on the client; response status, headers and redirects from inside the render tree | L |
| C7 | A coherent surface: the core entry shrinks from 177 names to about 70, with a11y, skeleton, motion, forms and scheduler helpers on subpaths; React's names mean what they mean in React; `<Ctx value>` as a provider; render effects run before user effects; effects own what they create | M |

### D. Agent tooling

| # | Change | Effort |
|---|---|---|
| D1 | One coded diagnostic channel in core, fed by every runtime check, with new codes for the mistakes What accepts silently today, hydration mismatches included | M |
| D2 | Owner path and compiler-injected name and `file:line:col` on every diagnostic and devtools record | M |
| D3 | `what_why`: the engine records why each effect ran; MCP arms it on demand, so no app code changes | L |
| D4 | A small generated `SKILL.md` and `diagnostics.json`, shipped in the npm package and in scaffolds | S–M |
| D5 | MCP tool set trimmed and made cheaper: compact output, merged redundant tools, one-call orientation, a cursor-based event pull | M |
| D6 | Diagnostic capture and matchers in `what-framework/testing`; `settled()` for tests and agents | S |

### E. Tests and gates

| # | Change | Effort |
|---|---|---|
| E1 | Engine conformance suite ported from the reference engines' scenarios; the reactivity benchmark's correctness checks as a gate | S |
| E2 | Streaming and hydration on one fixture; forced-GC retention checks; deterministic async schedules; keyed multi-node rows across the compiled, `h()` and hydration paths | M |
| E3 | Packed-consumer type tests; a compiled corpus run in production mode; the DOM performance gate moved to the script-only metric | S–M |

## What we are not taking from Solid 2.0

- **Stale reads until flush, and the removal of `batch`.** The async benefits do not need them; a prototype demonstrates this.
- **The height-ordered scheduler and two-slot value staging.** They cost 14 to 22% of synchronous time each.
- **Renaming `Suspense` to `Loading` and `ErrorBoundary` to `Errored`.** Solid's own agent guide calls React habits its dominant bug source.
- **Closure-per-hole server output.** It measured 1.3 to 1.7 times slower than Solid 1.9's eager holes, on every synchronous page.
- **Halting all reactivity on an unhandled error.** What logs and keeps running.
- **Throwing on writes inside effects, generator actions, `latest()`, quiet `refresh()`.**
- **Store-based selection.** It adds 17.5 kB to Solid 2.0's krausest bundle.
- **A third "observe" build tier, a 62 kB skill file, a native Rust compiler.** What's Babel plugin is already faster than both Solid Babel compilers.

## What What does better and must not regress

- A read right after a write returns the new value.
- Infinite loops are caught and the effect is named; one throwing effect does not stop the others.
- Live inspection and actuation of the running app over MCP, wired into every scaffold.
- A missing `key` is a compile-time error with a file and line.
- Server-side security checks Solid lacks: URL scheme blocking, attribute-name validation, `innerHTML` requires `{ __html }`.
- Loaders, CSRF-protected actions, ISR and islands in the box.
- React-familiar authoring: `.map()` with `key`, `className`, `Suspense`, `ErrorBoundary`.
- Swap and single-move list fast paths, already ahead of Solid 1.9.
- First evaluation of chains 10,000 levels deep; every reference engine overflows the stack between 1,180 and 7,820.
- A no-build test suite on four Node versions, with compiled-versus-`h()` parity fuzzing.

## Method

Six review tracks, each with file-and-line evidence against the Solid monorepo at commit `b4212bf`: signal engine, compiler and DOM runtime, server rendering, testing and CI, diagnostics and agent tooling, and API and async model. Four benchmark harnesses were built first so the review could chase measured gaps. Prototypes for the engine, the DOM runtime changes, the server pipeline and the async model were built on copies of the repo and run against What's own test suites.

Code adapted from MIT-licensed projects keeps its notice: the engine's linking, propagation and dependency check follow alien-signals (© 2024 Johnson Chu), and the owner-path id format follows Solid (© Ryan Carniato).
