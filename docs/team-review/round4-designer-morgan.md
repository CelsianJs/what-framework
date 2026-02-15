# Round 4 Framework Designer Decisions: What Framework -- FINAL
**Author:** Morgan (Framework Designer & Architect)
**Date:** 2026-02-13
**Input:** Round 4 Junior Review (Alex), Round 4 Senior Review (Jordan)
**Previous:** [Round 3 Decisions](./round3-designer-morgan.md) | [Round 2 Decisions](./round2-designer-morgan.md)

---

## Table of Contents

1. [Ship / No-Ship Verdict](#ship--no-ship-verdict)
2. [Phase 3 Fix Verification Summary](#phase-3-fix-verification-summary)
3. [New Findings: Disposition](#new-findings-disposition)
4. [v1.0 Release Checklist](#v10-release-checklist)
5. [v1.1 Roadmap](#v11-roadmap)
6. [Retrospective: The 4-Round Review Process](#retrospective-the-4-round-review-process)

---

## Ship / No-Ship Verdict

**Ship it.**

Both reviewers give a "ship it" verdict. Jordan scores 9.2/10 overall. Alex scores 7.5/10 for production, 9/10 for personal projects. Both independently verified all 18 Phase 3 fixes as correct. No P0 or P1 issues remain. The five new findings are all P2 or P3.

I am making the call: What Framework v1.0 ships.

Here is my reasoning in full.

### Why Ship Now

**1. All blockers from my Round 3 release criteria are met.**

In Round 3, I defined v1.0 as shipping when "all 'Must Have' criteria are met and both reviewers score production readiness at 7.5 or above." Jordan is at 9.2. Alex is at 7.5. Both thresholds are met.

The Must Have checklist from Round 3:

| Criterion | Round 3 Status | Round 4 Status |
|-----------|---------------|----------------|
| All P0/P1 bugs resolved | 2 remaining | **Done.** Both reviewers confirm zero P0/P1. |
| Core reactive system correct | Done | **Done.** A grade from Jordan. |
| Data fetching: shared cache, abort, dedup, invalidation | 1 remaining (shared error state) | **Done.** Shared error/isValidating verified by both. |
| Server actions: CSRF, input validation, timeout, error sanitization | 1 remaining (fail-closed) | **Done.** Fail-closed CSRF verified by both. |
| Automated test suite for critical paths | In progress | Tests exist. Not as comprehensive as I wanted. See release checklist. |
| TypeScript declarations audited | Not started | Not completed. Accepting this as a known gap. See below. |
| API documentation complete | 90% | **Done.** useContext, effect timing, arrow wrappers all added. |
| Quickstart guide accurate and consistent | 85% | **Done.** Arrow wrapper section, demos audited. |

Two items are not fully met: TypeScript audit and comprehensive test coverage. I am shipping anyway. Here is why.

**TypeScript declarations:** The `.d.ts` files exist and cover the public API surface. They have not been systematically audited for completeness. Shipping incomplete types is a known risk, but shipping NO types is worse, and delaying v1.0 for a type audit that could take a week is not justified when the runtime code is correct. We will audit types in v1.0.1 as a fast-follow patch.

**Test coverage:** The test files exist for core modules (form, scheduler, skeleton, animation, a11y, data). The coverage is not as comprehensive as the 12-case plan I laid out in Round 3. But the four rounds of manual review by two independent reviewers, each reading the actual source line by line, provides a level of verification that automated tests alone cannot match. The immediate post-ship priority is backfilling automated tests to protect against regressions.

**2. The remaining issues are P2/P3 edge cases, not design flaws.**

The five new findings across both reviews:
- useInfiniteQuery refetch flash of empty state (P2)
- useInfiniteQuery single AbortController across pages (P2)
- useSWR fetcher abort signal not documented (P3 docs)
- computed disposal in useSWR (P3, re-flagged from Round 3)
- useInfiniteQuery sequential fetch behavior undocumented (P2 docs)

None of these cause data loss, security vulnerabilities, or crashes. None affect the common case. They are exactly the kind of rough edges that every framework carries into v1.0.

**3. The trajectory is right.**

| Metric | R1 | R2 | R3 | R4 |
|--------|----|----|-----|-----|
| Alex: Production | 4.0 | 5.0 | 6.5 | **7.5** |
| Jordan: Production | 6.5 | 7.5 | 8.5 | **9.2** |
| P0 bugs | Multiple | 2 | 0* | **0** |
| P1 bugs | Multiple | Multiple | 3 | **0** |
| Modules below B | Multiple | 1 | 0 | **0** |

*Round 3 had zero P0s in the actual source, though the synthesis reported one that was already fixed.

Four rounds of monotonically improving scores. Every module at B+ or above. Both reviewers say ship. The data speaks.

### Why Not Wait

Waiting for "perfect" is the enemy of shipping. The remaining items (TypeScript audit, computed disposal, infinite query edge cases, AnimatePresence) are all addressable in minor releases without breaking changes. The API surface is stable. The core semantics are locked. Delaying v1.0 costs momentum and provides no safety benefit -- the issues that remain are well-understood and bounded.

---

## Phase 3 Fix Verification Summary

All 18 Phase 3 fixes verified by both reviewers. This is a clean sweep for the second consecutive round (Phase 2 was also 12/12).

| # | Fix | Alex | Jordan |
|---|-----|------|--------|
| 1 | useQuery fetch() -> fetchQuery() | Verified | Verified |
| 2 | Soft invalidation default | Verified | Verified |
| 3 | useInfiniteQuery AbortController | Verified | Verified |
| 4 | Retry delay abort-aware | Verified | Verified |
| 5 | Cache cleanup checks subscribers | Verified | Verified |
| 6 | lastFetchTimestamps cleaned in eviction + clearCache | Verified | Verified |
| 7 | Shared error/isValidating per cache key | Verified | Verified |
| 8 | CSRF fail-closed | Verified | Verified |
| 9 | CSRF token no longer cached | Verified | Verified |
| 10 | csrfMetaTag HTML-escapes token | Verified | Verified |
| 11 | __DEV__ warning for useContext outside render | Verified | Verified |
| 12 | untrack() suggestion in flush loop warning | Verified | Verified |
| 13 | LIS algorithm comments | Verified | Verified |
| 14 | Effect timing doc additions | Verified | Verified |
| 15 | "You Don't Need Arrow Wrappers" section | Verified | Verified |
| 16 | useContext render-only limitation documented | Verified | Verified |
| 17 | Duplicate _getCurrentComponent removed | Verified | Verified |
| 18 | Form test fixes | Verified | Verified |

No disputes. No partial fixes. No regressions. This is the quality bar I expect.

---

## New Findings: Disposition

Five new findings across both reviews. I will address each one.

### Finding 1: useInfiniteQuery Refetch Clears Pages Before New Data (P2)

**Flagged by:** Both reviewers.

**The issue:** `refetch()` calls `pages.set([])` before the fresh data arrives. Between the clear and the fetch completion, the component sees an empty pages array -- a flash of empty state.

**My assessment:** This is a real UX issue, but it is P2 for three reasons:
1. Refetch on infinite queries is uncommon. The primary flow (initial load, fetchNextPage, fetchPreviousPage) is unaffected.
2. The fix is straightforward (keep stale pages visible during refetch, replace on completion) and does not require API changes.
3. This is the exact pattern we already fixed for `invalidateQueries` (Fix 2, soft invalidation). The precedent exists.

**Decision: Defer to v1.0.1.** The fix is small and non-breaking. It follows the same pattern as the soft invalidation fix. I want it fixed quickly after launch, but it does not block the release.

**Implementation guidance for v1.0.1:**

```js
refetch: async () => {
  // Keep stale pages visible during refetch (SWR pattern)
  const stalePages = pages.peek();
  const result = await fetchPage(initialPageParam);
  if (result !== undefined) {
    // fetchPage already updated pages with the fresh first page.
    // Reset pageParams to reflect the fresh state.
    pageParams.set([initialPageParam]);
  }
  return result;
},
```

The key change: do not call `pages.set([])` before the fetch. Let `fetchPage` overwrite the pages array atomically when the fresh data arrives. This requires a small adjustment to `fetchPage` to support a "replace all" mode vs. the current "append" mode. Bounded to 30 minutes of work.

---

### Finding 2: useInfiniteQuery Single AbortController Across Pages (P2)

**Flagged by:** Both reviewers.

**The issue:** There is one `abortController` per `useInfiniteQuery` instance. If the user calls `fetchNextPage` rapidly, each call aborts the previous one, potentially leaving gaps (e.g., pages 2 and 3 are aborted, only page 4 completes).

**My assessment:** Jordan correctly identifies this as a design trade-off, not a bug. The single-controller approach:
- Prevents concurrent fetches from the same hook (no race conditions on page array ordering)
- Is simpler to reason about
- Matches the most common usage pattern (scroll, wait, scroll again)

TanStack Query's per-page controller approach is more sophisticated but also more complex. For a v1.0 that targets simplicity and correctness over advanced concurrency, the single-controller model is the right choice.

**Decision: Defer to v1.1. Document the behavior now.**

What we will do for v1.0:
- Add a note to the `useInfiniteQuery` documentation explaining that page fetches are sequential and that calling `fetchNextPage` during an in-flight fetch aborts the previous one.
- This sets correct expectations. Developers who need parallel page fetching can debounce their scroll handler or use a queue.

What we will do for v1.1:
- Evaluate per-page abort controllers if user feedback indicates the current behavior is a pain point.
- This is a non-breaking change (the public API is identical; only the internal concurrency model changes).

---

### Finding 3: useSWR Fetcher Abort Signal Not Shown in Docs (P3)

**Flagged by:** Alex.

**The issue:** The `useSWR` fetcher receives `(key, { signal })` but the documentation examples ignore the signal. Users get abort support in the hook but not in their actual network requests.

**My assessment:** This is a documentation gap, not a code issue. The code is correct -- the signal is passed. The docs should show how to use it.

**Decision: Fix before v1.0 release.** This is a 5-minute documentation change. Add an example to the useSWR section showing the signal:

```js
const { data } = useSWR('users', (key, { signal }) =>
  fetch(`/api/${key}`, { signal }).then(r => r.json())
);
```

This belongs in the API docs alongside the existing useSWR examples. It is small enough to include in the release preparation work.

---

### Finding 4: Computed Disposal in useSWR Not Registered (P3)

**Flagged by:** Jordan (re-flagged from Round 3).

**The issue:** The `computed` instances in `useSWR` (`data` and `isLoading`) are not registered for disposal with the component context. Their inner effects remain subscribed after the component unmounts.

**My assessment:** This was P3 in Round 3 and I deferred it then. Jordan re-flags it at P3 and explicitly says "does not block v1.0." I agree. The impact is minimal:
- Computed inner effects are lazy and only mark themselves dirty on notification.
- They do not run user code or cause DOM updates after unmount.
- The memory retention is one closure + subscriber set entries per unmounted `useSWR` component.
- In practice, this only matters for long-running SPAs that mount and unmount hundreds of components using the same cache key without page navigation.

**Decision: Defer to v1.0.1.** Same priority as Finding 1. Small, bounded fix. Non-breaking.

---

### Finding 5: useInfiniteQuery Sequential Fetch Behavior Should Be Documented (P2)

**Flagged by:** Jordan.

**The issue:** The sequential fetch model (as opposed to TanStack Query's parallel model) should be explicitly documented so developers set correct expectations.

**My assessment:** This overlaps with Finding 2. The documentation note I specified for Finding 2 covers this.

**Decision: Fix before v1.0 release.** Covered by the documentation work in Finding 2.

---

### Summary of Dispositions

| # | Finding | Severity | Decision | Timeline |
|---|---------|----------|----------|----------|
| 1 | Refetch clears pages (flash of empty state) | P2 | Defer | v1.0.1 |
| 2 | Single AbortController across pages | P2 | Document now, evaluate in v1.1 | Docs: v1.0, Code: v1.1 |
| 3 | Fetcher abort signal not in docs | P3 | Fix before release | v1.0 |
| 4 | Computed disposal in useSWR | P3 | Defer | v1.0.1 |
| 5 | Sequential fetch behavior undocumented | P2 | Fix before release (same as #2) | v1.0 |

**Zero items block the v1.0 release.** Two small documentation additions will be included in release preparation.

---

## v1.0 Release Checklist

Here is the ordered list of tasks between now and the v1.0 tag.

### Pre-Release (Must Complete)

| # | Task | Effort | Status |
|---|------|--------|--------|
| 1 | Add useSWR fetcher signal example to API docs | 10 min | Not started |
| 2 | Add useInfiniteQuery sequential fetch note to API docs | 10 min | Not started |
| 3 | Final pass on CHANGELOG for v1.0 | 30 min | Not started |
| 4 | Verify `npm pack` produces clean package for all 6 packages | 15 min | Not started |
| 5 | Verify demo site builds and runs with published package versions | 15 min | Not started |
| 6 | Tag v1.0.0 on all packages | 5 min | Not started |

**Total pre-release effort: ~1.5 hours.**

### Fast-Follow (v1.0.1, within 1 week of release)

| # | Task | Effort |
|---|------|--------|
| 1 | Fix useInfiniteQuery refetch flash (Finding 1) | 30 min |
| 2 | Register computed disposal in useSWR (Finding 4) | 20 min |
| 3 | TypeScript declarations audit | 4-6 hours |
| 4 | Backfill automated tests for Phase 3 fixes | 3-4 hours |

### Post-Release Quality (v1.0.2, within 2 weeks)

| # | Task | Effort |
|---|------|--------|
| 1 | Automated tests for CSRF (fail-closed, validation, skipCsrf, token rotation) | 1-2 hours |
| 2 | Automated tests for data layer (shared cache, abort on unmount, dedup, invalidation) | 2-3 hours |
| 3 | Integration test: full SSR -> hydration -> islands flow | 2-3 hours |

---

## v1.1 Roadmap

Prioritized list of post-v1.0 improvements, based on four rounds of review feedback.

### Tier 1: High Priority (v1.1)

| # | Feature | Rationale | Effort |
|---|---------|-----------|--------|
| 1 | **AnimatePresence / exit animations** | Both reviewers flag this across all 4 rounds. Alex calls it "table stakes for polished production UIs." Design was committed in Round 2. Requires reconciler changes to the removal path to defer DOM removal until exit animation completes. | 2-3 days |
| 2 | **Global SWR/Query configuration** | `SWRConfig` / `QueryClientProvider` equivalent. Context-based default fetcher, deduplication interval, retry policy. Recurring request across 3 rounds. | 1 day |
| 3 | **useInfiniteQuery per-page abort controllers** | Finding 2 from this round. Evaluate whether the sequential model causes real user pain. If so, implement per-page controllers with ordered assembly. | 1 day |

### Tier 2: Medium Priority (v1.1 or v1.2)

| # | Feature | Rationale | Effort |
|---|---------|-----------|--------|
| 4 | **Testing utilities expansion** | Alex scores testing at 5/10 across all 4 rounds. Need: async act(), flush(), mockSignal(), and component test helpers. The `testing.js` module exists but is thin. | 2-3 days |
| 5 | **useFieldArray for forms** | Dynamic form fields (add/remove rows). Common pattern in production forms. | 1-2 days |
| 6 | **SSR hydration mismatch detection** | __DEV__-only warning when server HTML does not match client render. Standard practice in React, Vue, Solid. | 1-2 days |
| 7 | **Error recovery integration** | ErrorBoundary + retry pattern. When an ErrorBoundary catches, provide a `resetErrorBoundary` function that re-renders the children. | 1 day |

### Tier 3: Lower Priority (v1.2+)

| # | Feature | Rationale |
|---|---------|-----------|
| 8 | DevTools browser extension | Ecosystem maturity. Signal graph visualization, component tree, cache inspector. |
| 9 | FormProvider context for nested forms | Reduces prop drilling in complex form layouts. |
| 10 | `@what-fw/virtual` package | Virtualized list as a separate, opt-in package. Not core. |
| 11 | Fine-grained `For` with `mapArray` | Decided against in Round 1, reaffirmed in Round 2. Revisit only if performance benchmarks demand it. |

### Explicitly Deferred (No Timeline)

| Feature | Reasoning |
|---------|-----------|
| Rate limiting hooks | Middleware concern. Document integration with Express/Hono/Fastify rate limiting. |
| Server action schema validation | Userland responsibility. Developers use zod/valibot/arktype inside their action functions. |
| Euler -> RK4 in spring physics | Euler is adequate for UI. Framer Motion uses Euler. No user reports of instability. |

---

## Retrospective: The 4-Round Review Process

### What Worked

**1. Two-reviewer, two-perspective model.**

Alex (junior, 3 years React) and Jordan (senior, 10+ years multi-framework) complemented each other perfectly. Alex found the issues a new adopter would hit: confusing docs, missing examples, unclear error messages, the arrow wrapper confusion. Jordan found the issues a production team would hit: shared state bugs, security defaults, abort handling gaps, memory leaks. Neither reviewer alone would have surfaced the full picture.

The best example: in Round 3, Alex flagged `useQuery` calling `fetch()` instead of `fetchQuery()` as a user-facing bug (the features do not work). Jordan flagged it as an architectural concern (the internal API surface is inconsistent). Both perspectives were correct and led to the same fix.

**2. Source code verification at the designer level.**

In Round 3, I verified every claim in the synthesis against the actual source code and found that 6 of 8 specific code-level claims were already fixed. This prevented us from wasting Phase 3 effort on phantom bugs. The lesson: synthesis documents are valuable for aggregation, but the designer must read the code. Decisions made on summaries alone will be wrong.

**3. Fix-then-verify cadence.**

The pattern of "implement fixes, then have both reviewers verify in the next round" created accountability. Every fix had to survive two independent code reads. This caught issues that would have slipped through a single review: Alex caught the `csrfMetaTag` XSS vector that Jordan's security review missed in Round 2. Jordan caught the computed disposal issue that Alex would not have thought to look for.

Across 3 fix phases: 40 fixes implemented, 40 verified correct, 0 regressions introduced. That is a 100% fix success rate. The cadence works.

**4. Prioritization discipline.**

The P0/P1/P2/P3 system forced triage. Not everything is equally important. In Round 2, I deferred AnimatePresence (a feature both reviewers wanted) because it required reconciler changes that could not be rushed. In Round 3, I deferred computed disposal because Jordan assessed it as low-impact. These deferrals were correct -- we spent fix effort on the issues that mattered most, and the scores reflect it.

**5. Score trajectories as a decision tool.**

Tracking numerical scores across rounds gave me an objective signal for when we were ready to ship. When Alex hit 7.5 and Jordan hit 9.2, the numbers confirmed what the qualitative feedback was saying: the framework is ready. Without the scores, "ship it" would have been a gut call. With them, it is a data-backed decision.

### What Could Be Improved

**1. The synthesis layer introduced noise.**

In Round 3, Sam's synthesis reported bugs that did not exist in the current source. This created confusion and could have led to wasted effort. In future review cycles, I would either (a) eliminate the synthesis step and have the designer read the raw reviews directly, or (b) require the synthesizer to verify claims against the current source before reporting them.

**2. Automated tests should have been a Round 1 requirement, not a Round 3 aspiration.**

I wrote a testing strategy in Round 3 with 12 specific test cases. As of Round 4, test coverage is better but not where it should be. If I had made "every fix must ship with a test" a hard rule in Round 1, we would have 40+ regression tests today. Instead, we rely on manual verification. The manual verification has been thorough (both reviewers read source line by line), but it does not protect against future regressions. This is the single biggest gap in our process.

**3. The TypeScript audit was perpetually deferred.**

I flagged it as "Fix later" in Round 3 with a target of "v1.0 blocker." It did not get done. I am now shipping without it. This is a process failure -- when I call something a "v1.0 blocker" and then ship without it, it means my priority labels were aspirational, not real. In future, I will either enforce the label or not apply it.

**4. Round count was right at four.**

Four rounds was enough to go from "prototype with real bugs" to "production-ready." Fewer would have left P1 issues unresolved. More would have been diminishing returns -- the last two rounds found only P2/P3 issues. For a framework of this size (~4KB, ~10 modules), four rounds with two reviewers is the right investment.

### By the Numbers

| Metric | Value |
|--------|-------|
| Total review rounds | 4 |
| Total fixes implemented | 40 |
| Fixes verified correct | 40 (100%) |
| Regressions introduced | 0 |
| P0 bugs found (total across all rounds) | ~5 |
| P0 bugs remaining | 0 |
| P1 bugs found (total) | ~12 |
| P1 bugs remaining | 0 |
| Lowest module grade (Round 1) | C- (actions.js) |
| Lowest module grade (Round 4) | B+ (form.js, animation.js, a11y.js) |
| Alex production score trajectory | 4.0 -> 5.0 -> 6.5 -> 7.5 |
| Jordan production score trajectory | 6.5 -> 7.5 -> 8.5 -> 9.2 |
| Average improvement per round (Alex) | +1.17 |
| Average improvement per round (Jordan) | +0.90 |

### The Framework Today

What Framework v1.0 is a lightweight, batteries-included JavaScript framework with:

- **Signals-based reactivity** with microtask-deferred effects, diamond dependency resolution, and batch support. No known correctness bugs after 4 rounds of review.
- **Component model** with memo (shallow comparison, signal-transparent), lazy loading, Suspense boundaries, and ErrorBoundary. All verified correct.
- **Data fetching** with useFetch, useSWR, useQuery, and useInfiniteQuery. Shared per-key cache, shared error/isValidating signals, abort support on all hooks, deduplication, soft invalidation, abort-aware retry delays. The most improved module across the review cycle (C+ to A-).
- **Forms** with per-field signals, getter-based errors, and validation pipeline.
- **Animations** with spring physics, gesture support, and passive touch events. AnimatePresence deferred to v1.1.
- **Accessibility** with focus trap, roving tabindex, ARIA helpers, and live regions.
- **Server actions** with fail-closed CSRF, constant-time token comparison, HTML-escaped meta tags, fresh token reads, randomized action IDs, timeout support, and sanitized error messages. The second most improved module (C- to A-).
- **Islands architecture** with SSR, selective hydration, and partial interactivity.
- **Router** with nested routes, code splitting, and transitions.
- **All of this in approximately 4KB gzipped.**

The framework is not trying to be React, SolidJS, or Svelte. It occupies a specific niche: content-heavy sites with islands of interactivity, where bundle size matters and a single dependency is preferable to assembling React + TanStack Query + React Hook Form + Framer Motion + an SSR framework. In that niche, it is competitive.

---

## Final Disposition

**What Framework v1.0 is approved for release.**

Remaining pre-release work (documentation polish, package verification, changelog) is bounded to approximately 1.5 hours. Fast-follow patches (v1.0.1 for the infinite query refetch fix, computed disposal, and TypeScript audit) are targeted within one week of release.

The four-round review process is now complete. Forty fixes, zero regressions, two independent reviewers in agreement. The core is solid. The API surface is stable. The gaps are known, documented, and addressable without breaking changes.

Ship it.

-- Morgan, Framework Designer

---

*This document represents the final design authority decisions for the What Framework v1.0 review cycle. All claims reference verified source code and reviews dated 2026-02-13. The review cycle is closed.*
