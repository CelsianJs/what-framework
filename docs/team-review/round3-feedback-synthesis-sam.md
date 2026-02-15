# Round 3 Feedback Synthesis: What Framework
**Prepared by:** Sam (Feedback Receiver)
**Date:** 2026-02-13
**Input:** Round 3 Junior Developer Review (Alex), Round 3 Senior Developer Review (Jordan)
**Previous:** [Round 2 Synthesis](./round2-feedback-synthesis-sam.md) | [Round 1 Synthesis](./feedback-synthesis-sam.md)
**Audience:** Morgan (Framework Designer)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Phase 2 Fix Verification Summary](#phase-2-fix-verification-summary)
3. [Areas of Convergence (Both Reviewers Agree)](#areas-of-convergence-both-reviewers-agree)
4. [Areas Flagged by Only One Reviewer](#areas-flagged-by-only-one-reviewer)
5. [Score Trajectory Across All Three Rounds](#score-trajectory-across-all-three-rounds)
6. [Prioritized Fix List](#prioritized-fix-list)
7. [Top 5 Most Impactful Fixes Remaining](#top-5-most-impactful-fixes-remaining)
8. [Recommendations for Morgan](#recommendations-for-morgan)

---

## Executive Summary

Phase 2 was the most successful fix cycle yet. Both reviewers independently verified all fixes and confirmed that the three P0 issues from Round 2 (useContext walking the component stack, non-reactive SWR cache, CSRF protection in server actions) are resolved. The memo redesign received the strongest praise of any single fix across all three rounds -- both Alex and Jordan called it "clever" and "correct" without reservation.

The framework has crossed an important threshold. Alex upgraded his production rating from 5/10 to 6.5/10 and Jordan upgraded from 7.5/10 to 8.5/10. For the first time, both reviewers use the phrase "production-usable" (with caveats).

However, both reviewers independently discovered the same new bug: `useQuery` calls `window.fetch()` instead of the local `fetchQuery()` function in its `refetchOnWindowFocus` and `refetchInterval` handlers (`packages/core/src/data.js` lines 419 and 429). This is a trivial two-line fix but it renders two documented features completely broken. Both also flagged that `useInfiniteQuery` lacks AbortController support, and that the `error` signal in `useSWR`/`useQuery` is not shared across instances of the same cache key.

The remaining issues are edge cases and hardening -- not fundamental design flaws. This is a clear sign of framework maturation.

---

## Phase 2 Fix Verification Summary

Both reviewers verified every Phase 2 fix. Here is the consolidated status:

| Fix | Alex | Jordan | Consolidated |
|-----|------|--------|-------------|
| SWR cache reactive (shared signals per key) | Correct. Notes edge case: unbounded growth if all keys have active subscribers | Correct. Notes 3 edge cases: subscriber-less eviction window, useQuery setTimeout cleanup, invalidateQueries safe | **VERIFIED** |
| memo redesign (signal-safe reference-identity trick) | Correct. "Cleanest memo implementation I have seen for a signals-based framework" | Correct. Traced 4 edge cases (signal props, structural equality, function returns, no context). All pass. | **VERIFIED** |
| useContext walks `_parentCtx` chain | Correct. Notes: still returns default if called inside effects (same as React). | Verified via Round 2 checklist | **VERIFIED** |
| Server actions hardened (CSRF, randomized IDs, timeout, optimistic rollback, error sanitization) | Correct. Notes minor issue with `handleActionRequest` missing null check on `req.headers`. | Correct with caveats. CSRF is opt-in (dangerous default). Token caching prevents rotation. csrfMetaTag has XSS vector. | **VERIFIED (with caveats)** |
| AbortController in useFetch, useSWR, useQuery | Correct | Correct. Traced full abort lifecycle in all three hooks. | **VERIFIED** |
| createResource lifecycle cleanup | Correct | Correct | **VERIFIED** |
| SWR deduplication against completed fetches | Correct | Correct. Notes `lastFetchTimestamps` never pruned (slow memory growth). | **VERIFIED** |
| Flush loop improved (effect names in warning) | Correct. Notes `untrack()` suggestion should be in the message. | Correct. Same suggestion about `untrack()`. | **VERIFIED** |
| useScheduledEffect uses raf() debouncing | Correct | Correct. Symbol-key approach is clean. | **VERIFIED** |
| Form register() getter | Correct | Correct | **VERIFIED** |
| Passive touch listener option | Correct (trusted from changelog) | Correct (verified code) | **VERIFIED** |
| `_prevStyle` cleared in removeProp | Correct | Correct | **VERIFIED** |
| Effect timing documentation | Correct. Notes missing `scopedEffect` section. | Correct. Notes missing effect deduplication mention. | **VERIFIED** |

**12 out of 12 fixes verified correct by both reviewers.** Server actions have remaining hardening concerns (detailed below). This is the cleanest fix verification across all three rounds.

Jordan's Round 2 top-10 checklist: **10 out of 10 addressed. 8 fully resolved, 1 partially fixed (input validation depth), 1 with caveats (CSRF default).** Alex confirms all fixes from his Round 2 flagged issues are resolved.

---

## Areas of Convergence (Both Reviewers Agree)

These items were independently identified by both reviewers. Convergence = highest signal. Listed in priority order.

### 1. useQuery Calls `fetch()` Instead of `fetchQuery()` -- P0/P1 Bug

**Alex: P0. Jordan: P1.** Both found the exact same bug at the exact same lines.

- **File:** `packages/core/src/data.js`
- **Lines:** 419 (refetchOnWindowFocus handler) and 429 (refetchInterval handler)
- **Bug:** `fetch().catch(() => {})` calls `window.fetch()` with no arguments instead of `fetchQuery()` (the local refetch function)
- **Impact:** `refetchOnWindowFocus` and `refetchInterval` are completely non-functional in `useQuery`. They appear to work (no errors thrown thanks to `.catch(() => {})`), but no data is actually refreshed.
- **Fix:** Replace `fetch()` with `fetchQuery()` on both lines. Two-line fix.

**Sam's assessment: P0.** Two documented, user-facing features are silently broken. The `.catch(() => {})` makes this invisible to developers. This must be fixed immediately.

### 2. useInfiniteQuery Missing AbortController -- P2

**Alex: P2. Jordan: P2.** Both independently flagged the same gap.

- **File:** `packages/core/src/data.js` lines 451-535
- **Bug:** `useInfiniteQuery` has no `AbortController`, no abort on unmount, no abort on refetch. The `queryFn` is called without a `signal` property.
- **Impact:** In-flight page fetches continue after component unmount. State writes to `pages` signal execute on unmounted component.
- **Fix:** Follow the same AbortController pattern used in `useSWR`, `useQuery`, and `useFetch`.

**Sam's assessment: P2.** Consistency with other data hooks is important. The fix is straightforward -- the pattern exists three times already in the same file.

### 3. Error/Loading State Not Shared Across SWR Instances -- P1/P2

**Alex: P1. Jordan: P2.** Both identified the same architectural gap.

- **File:** `packages/core/src/data.js` lines 175-176 (useSWR) and line 321 (useQuery)
- **Issue:** `data` is shared via `getCacheSignal(key)`, but `error` and `isValidating` are local `signal()` instances per hook call. Two components using the same cache key see different error and loading states.
- **Impact:** If component A triggers a fetch that fails, component A shows an error. Component B (same key) shows stale data or loading -- no error indication.
- **Comparison:** vercel/swr and TanStack Query share error state across subscribers of the same key.

**Sam's assessment: P2.** This is a design gap, not a crash bug. The data itself is shared correctly. But the inconsistency creates confusing UX when multiple components share a query key. The fix (per-key error/isValidating signals alongside data signals) aligns with the existing `cacheSignals` architecture. Should be addressed, but not before the P0 `fetch` bug.

### 4. Flush Loop Warning Should Suggest `untrack()` as Fix

**Alex and Jordan** both independently noted that the improved flush loop warning identifies the looping effects but does not suggest `untrack()` as a solution.

- **File:** `packages/core/src/reactive.js` lines 188-201
- **Current message:** "Likely cause: an effect writes to a signal it also reads, creating a cycle."
- **Missing:** A suggestion like "Use untrack() to read signals without subscribing."

**Sam's assessment: P3.** Trivial improvement. Add the suggestion to the warning string.

### 5. Effect Timing Doc Has Minor Omissions

**Alex:** Missing section on `scopedEffect` and component lifecycle.
**Jordan:** Missing mention of effect deduplication via `Set`.

**Sam's assessment: P3.** Both are small additions to an already excellent document.

### 6. useQuery Cache Cleanup setTimeout Deletes Active Signals

**Alex: P1 (framed as "Cache Eviction Can Delete Active useQuery Data"). Jordan: Edge Case 3 in Fix 1 verification.**

Both identified the same issue at `packages/core/src/data.js` lines 366-371: the `setTimeout` that fires after `cacheTime` deletes the signal from `cacheSignals` without checking if other components still hold references.

- **Impact:** Component A and Component B can become disconnected if Component A's `cacheTime` timer fires while Component B is still mounted.
- **Fix:** Check `revalidationSubscribers` before deleting, or cancel the timeout on component unmount.

**Sam's assessment: P2.** Real bug that can cause data inconsistency in multi-component scenarios. Not trivial to hit (requires specific timing with `cacheTime` expiry), but a correctness gap.

### 7. Framework Has Matured Significantly

Both reviewers express genuine confidence in the core for the first time:
- Alex: "The data fetching layer is mature, forms work well, the reactive system is correct."
- Jordan: "The core reactive system is now production-quality."

Both cite the memo redesign as a standout improvement. Both acknowledge the framework is "production-usable with caveats."

---

## Areas Flagged by Only One Reviewer

### Flagged Only by Alex

| Issue | Severity | Sam's Assessment |
|-------|----------|-----------------|
| `invalidateQueries` sets cache to null before refetch (hard invalidation defeats SWR pattern) | P2 | **Valid and important.** The "stale while revalidate" name implies showing stale data during refresh. Hard invalidation forces a loading flash. Should offer soft invalidation as default. |
| Stale closure in `useSWR` mutate with dynamic keys | P2 | **Theoretical.** Alex acknowledges `useSWR` does not currently support dynamic keys. Flag for future work only. |
| AnimatePresence still missing | Wishlist | **Recurring ask across all three rounds.** Both reviewers have mentioned this but Alex raises it each time. This is the most persistent feature gap. |
| Virtualized list support missing | Wishlist | **Valid.** The framework has everything else built-in; the absence of virtualization stands out. |
| TypeScript types need verification | P2 | **Valid.** `.d.ts` files exist but have not been audited. Important for adoption. |
| DevTools / error overlay missing | Wishlist | **Nice to have.** Not blocking for v1.0 but important for DX competitiveness. |
| `useContext` limitation (effects/handlers) should be documented | P2 | **Valid.** The fix works for the standard case but developers may try to use `useContext` in effects. A `__DEV__` warning would be even better than docs. |
| `() =>` wrapper confusion persists in demos | P3 | **Recurring from Round 1.** Demos use both patterns inconsistently. A docs section clarifying "you do NOT need `() =>` wrappers" would eliminate confusion. |

### Flagged Only by Jordan

| Issue | Severity | Sam's Assessment |
|-------|----------|-----------------|
| CSRF protection is opt-in by default (dangerous) | P1 | **Critical security concern.** If `sessionCsrfToken` is not passed, CSRF is silently disabled. Should warn or fail. Jordan is right. |
| CSRF token cached at module scope (breaks rotation) | P2 | **Valid.** Removing the `_csrfToken` cache is a one-line fix. DOM reads are cheap. |
| `csrfMetaTag` XSS vector (unescaped token) | P2 | **Valid.** Framework-generated tokens are safe (hex+dashes), but a developer passing custom tokens could be exploited. HTML-escape the output. |
| useQuery retry delay does not respect AbortController | P2 | **Valid.** The delay `setTimeout` keeps running after abort. Wastes time and retains memory. Fix with abort-aware delay. |
| `computed` in `useSWR` creates orphaned effects | P3 | **Low impact.** Jordan acknowledges the memory impact is small (lazy computed, no user code runs). Worth fixing but not urgent. |
| `lastFetchTimestamps` never cleaned up | P3 | **Valid.** Slow memory growth (~100 bytes per key). Clean up during `evictOldest()`. |
| LIS mapping in keyed reconciliation is correct but hard to follow | P3 | **Valid.** Add comments. No behavior change needed. |
| No global SWR configuration | P2 | **Recurring from Round 2.** No `SWRConfig` equivalent. Each hook call specifies all options independently. |
| `handleActionRequest` input validation is shallow | P2 | **Carried from Round 2.** `Array.isArray(args)` check exists but no deep validation. |
| No rate limiting hooks for server actions | Wishlist | **Valid for production hardening.** Out of scope for v1.0 core. |

---

## Score Trajectory Across All Three Rounds

### Alex (Junior Developer)

| Category | Round 1 | Round 2 | Round 3 | Trend |
|----------|---------|---------|---------|-------|
| Correctness | -- | -- | 8/10 | (new category in R3) |
| API Design | -- | -- | 8/10 | (new category in R3) |
| Data Fetching | -- | -- | 8.5/10 | (new category in R3) |
| Forms | -- | -- | 8/10 | (new category in R3) |
| Server Actions | -- | -- | 8/10 | (new category in R3) |
| Documentation | -- | -- | 7/10 | (new category in R3) |
| Error Handling | -- | -- | 6.5/10 | (new category in R3) |
| Animation | -- | -- | 6/10 | (new category in R3) |
| Testing Story | -- | -- | 5/10 | (new category in R3) |
| Ecosystem | -- | -- | 2/10 | (new category in R3) |
| **Personal Projects** | **7/10** | **7.5/10** | **8.5/10** | +1.5 over 3 rounds |
| **Production Team Projects** | **4/10** | **5/10** | **6.5/10** | +2.5 over 3 rounds |

### Jordan (Senior Developer)

| Module | Round 1 | Round 2 | Round 3 | Trend |
|--------|---------|---------|---------|-------|
| reactive.js | -- | A- | A- | Stable at high level |
| dom.js | -- | B+ | A- | +1 |
| components.js | -- | B | A- | +1 |
| hooks.js | -- | B+ | A- | +0.5 |
| data.js | -- | C+ | B+ | +1.5 |
| form.js | -- | B- | B+ | +1 |
| animation.js | -- | B | B+ | +0.5 |
| a11y.js | -- | B+ | B+ | Stable |
| scheduler.js | -- | B+ | A- | +0.5 |
| actions.js | -- | C- | B | +1.5 |
| **Production Readiness** | **6.5/10** | **7.5/10** | **8.5/10** | +2 over 3 rounds |
| **Architecture/Vision** | **8/10** | **8.5/10** | **9/10** | +1 over 3 rounds |

### Combined Score Summary

| Metric | Round 1 | Round 2 | Round 3 | Delta R1->R3 |
|--------|---------|---------|---------|-------------|
| Alex: Personal | 7.0 | 7.5 | 8.5 | **+1.5** |
| Alex: Production | 4.0 | 5.0 | 6.5 | **+2.5** |
| Jordan: Production Readiness | 6.5 | 7.5 | 8.5 | **+2.0** |
| Jordan: Architecture/Vision | 8.0 | 8.5 | 9.0 | **+1.0** |
| Sam: Combined Production | ~6.0 | 7.5 | **8.0** | **+2.0** |

The production scores from both reviewers have improved by +2 or more across three rounds. Jordan's module grades show the largest improvements in `data.js` (+1.5), `actions.js` (+1.5), `components.js` (+1), and `form.js` (+1) -- the four modules that received the most targeted fixes.

---

## Prioritized Fix List

### Fix Now (Before Next Release)

| # | Issue | Both Agree? | File | Lines | Effort |
|---|-------|-------------|------|-------|--------|
| 1 | **useQuery calls `fetch()` instead of `fetchQuery()`** | YES (Alex P0, Jordan P1) | `packages/core/src/data.js` | 419, 429 | 2 minutes |
| 2 | **CSRF protection should be default-on** | Jordan only, but critical | `packages/server/src/actions.js` | 356-365 | 30 minutes |
| 3 | **HTML-escape `csrfMetaTag` token** | Jordan only, but XSS risk | `packages/server/src/actions.js` | 71 | 5 minutes |
| 4 | **Remove CSRF token caching** | Jordan only | `packages/server/src/actions.js` | 24-28 | 5 minutes |

### Fix Soon (Next Sprint)

| # | Issue | Both Agree? | File | Lines | Effort |
|---|-------|-------------|------|-------|--------|
| 5 | **Add AbortController to useInfiniteQuery** | YES (both P2) | `packages/core/src/data.js` | 451-535 | 1 hour |
| 6 | **useQuery cache cleanup setTimeout checks subscribers** | YES (Alex P1, Jordan edge case) | `packages/core/src/data.js` | 366-371 | 30 minutes |
| 7 | **Share error/isValidating signals per cache key** | YES (Alex P1, Jordan P2) | `packages/core/src/data.js` | 175-176, 321 | 2 hours |
| 8 | **Soft invalidation default for invalidateQueries** | Alex only, but core SWR semantics | `packages/core/src/data.js` | 551 | 1 hour |
| 9 | **useQuery retry delay abort-aware** | Jordan only | `packages/core/src/data.js` | 374-379 | 30 minutes |
| 10 | **Document useContext render-only limitation** | Alex only | docs | -- | 30 minutes |
| 11 | **Add `untrack()` suggestion to flush loop warning** | YES (both noted) | `packages/core/src/reactive.js` | 188-201 | 5 minutes |

### Fix Later (Backlog)

| # | Issue | Both Agree? | File | Effort |
|---|-------|-------------|------|--------|
| 12 | Clean up `lastFetchTimestamps` during eviction | Jordan only | `packages/core/src/data.js` | 15 minutes |
| 13 | Register computed disposal in useSWR | Jordan only | `packages/core/src/data.js` | 30 minutes |
| 14 | Add comments to LIS mapping | Jordan only | `packages/core/src/dom.js` | 15 minutes |
| 15 | Document `scopedEffect` in effect timing doc | Alex only | `docs/EFFECT-TIMING.md` | 15 minutes |
| 16 | Document effect deduplication via Set | Jordan only | `docs/EFFECT-TIMING.md` | 10 minutes |
| 17 | Clarify `() =>` wrapper is unnecessary in docs + demos | Alex only (recurring) | docs, demo | 1 hour |
| 18 | Verify TypeScript `.d.ts` completeness | Alex only | `packages/core/index.d.ts` | 2-4 hours |
| 19 | Add `__DEV__` warnings to silent catch blocks in reactive.js | Alex only (recurring) | `packages/core/src/reactive.js` | 15 minutes |
| 20 | No global SWR configuration (SWRConfig) | Jordan only (recurring) | `packages/core/src/data.js` | 2-4 hours |

### Won't Fix (Accepted Limitations or Out of Scope for v1.0)

| # | Issue | Reason |
|---|-------|--------|
| W1 | AnimatePresence / exit animations | Both reviewers want this, but it requires fundamental changes to DOM removal. Better as a v1.1 feature than a v1.0 blocker. Design work needed first. |
| W2 | Virtualized list | Important feature but not a correctness issue. Can be added as a separate package or community contribution. |
| W3 | DevTools / error overlay | Ecosystem feature. Not blocking for framework correctness. |
| W4 | For/Show fine-grained reactivity (Solid-level) | Morgan decided in Round 1 that the re-run model is the framework's identity. These are syntactic sugar by design. Document the limitation. |
| W5 | Rate limiting hooks for server actions | Middleware concern. Out of scope for core framework. |
| W6 | Server action argument schema validation | Developers should validate inside action functions. Framework can provide validator integration later. |
| W7 | Stale closure in useSWR mutate (dynamic keys) | Theoretical. Dynamic keys are not currently supported. |
| W8 | Euler integration in spring physics | Both reviewers (Jordan R2, Alex indirectly) acknowledge this is adequate for typical UI animations. Verlet/RK4 is a performance optimization, not a correctness fix. |

---

## Top 5 Most Impactful Fixes Remaining

Ranked by the combination of: user impact, convergence between reviewers, effort-to-value ratio, and risk if left unfixed.

### 1. Fix `useQuery` `fetch()` -> `fetchQuery()` Bug

**Impact: High. Effort: Trivial. Risk: Two documented features silently broken.**

This is the single highest-priority fix. Both reviewers found it. It is two lines of code. `refetchOnWindowFocus` and `refetchInterval` are core TanStack Query-compatible features -- developers who use them will have silently stale data. The `.catch(() => {})` ensures no error is visible, making this nearly impossible to debug without reading the source.

File: `packages/core/src/data.js`, lines 419 and 429.

### 2. Make CSRF Protection Default-On in Server Actions

**Impact: High. Effort: Low. Risk: Security vulnerability.**

Jordan identified that CSRF validation only happens if the caller explicitly provides `csrfToken` in options. If omitted, CSRF is silently disabled. Combined with the `csrfMetaTag` XSS vector and token caching preventing rotation, the server actions security story has three separate gaps. All three fixes are small (total: ~40 minutes).

File: `packages/server/src/actions.js`, lines 24-28, 71, 356-365.

### 3. Share Error/Loading State Across Cache Key Subscribers

**Impact: Medium-High. Effort: Medium. Risk: Confusing UX in multi-component scenarios.**

Both reviewers flagged this. The data signal is shared per key (correct), but error and isValidating are per-instance (incorrect per SWR/TanStack semantics). This creates inconsistent UI state across components that share a query key. The fix aligns with the existing `cacheSignals` architecture -- add `errorSignals` and `isValidatingSignals` Maps.

File: `packages/core/src/data.js`, lines 175-176, 321.

### 4. Add AbortController to useInfiniteQuery

**Impact: Medium. Effort: Low. Risk: Zombie fetches and state writes after unmount.**

Both reviewers flagged this. The fix pattern exists three times already in the same file (`useFetch`, `useSWR`, `useQuery`). Copy the pattern. The inconsistency also hurts developer confidence -- if they see abort handling in `useQuery` but not `useInfiniteQuery`, they question what else might be missing.

File: `packages/core/src/data.js`, lines 451-535.

### 5. Soft Invalidation as Default for `invalidateQueries`

**Impact: Medium. Effort: Low. Risk: Defeats the SWR pattern.**

Alex identified this clearly: setting cache to `null` before re-fetch causes a loading flash, which defeats the "stale while revalidate" pattern. The fix is to NOT set the cache to null and instead just trigger revalidation. Optionally add a `{ refetchType: 'hard' }` option for the current behavior.

File: `packages/core/src/data.js`, line 551.

---

## Recommendations for Morgan

### What Went Right in Phase 2

The fix quality was exceptional. 12 out of 12 fixes verified correct by both reviewers. The memo redesign received the strongest praise of any single fix in the entire review process. The server actions went from "NOT SAFE for production" (Jordan Round 2) to "production-usable IF" (Jordan Round 3). The data layer went from C+ to B+.

The pattern of addressing P0 issues first, then P1 issues, with clean implementations, is working. Both reviewers noted excellent follow-through (Jordan: "10 out of 10 addressed").

### What to Focus On for Phase 3

1. **Fix the useQuery `fetch` bug.** (5 minutes. Both reviewers. P0.)
2. **Harden the three CSRF issues.** (40 minutes. Jordan only but security-critical.)
3. **Share error/loading state per cache key.** (2 hours. Both reviewers.)
4. **Add AbortController to useInfiniteQuery.** (1 hour. Both reviewers.)
5. **Add soft invalidation default.** (1 hour. Alex only but core to SWR semantics.)

Total estimated effort for all five: approximately 5 hours. These five fixes would close the gap between B+ and A- on the data layer, resolve the last security concerns in server actions, and address every item both reviewers converged on.

### The Path to v1.0

After Phase 3, the remaining items fall into two categories:

**Documentation and polish** (items 10-20 in the Fix Later list): These are important for adoption but do not affect correctness. They can be done incrementally alongside the v1.0 release.

**Feature gaps** (AnimatePresence, virtualization, DevTools): These are real gaps that affect competitiveness but are not correctness issues. They should be v1.1 targets, not v1.0 blockers.

The biggest remaining risk, as Jordan noted, is not in the code itself but in **the lack of automated test coverage**. The fixes are correct, but three rounds of manual review cannot substitute for regression tests. Jordan's strongest recommendation: add integration tests for cache sharing, abort on unmount, deduplication, CSRF validation, and token rotation. Without these, any future refactor could reintroduce the bugs that were painstakingly identified and fixed over three review rounds.

### Where the Framework Stands

The framework is now genuinely competitive in its target niche: a lightweight, batteries-included framework with strong SSR and islands support. Jordan's comparison table places it favorably against React 19, SolidJS 2, and Svelte 5 in data fetching, bundle size, and islands/SSR -- while acknowledging it trails in core reactivity (vs Solid) and server actions (vs React 19).

Both reviewers would now recommend the framework for personal projects and small team projects (2-3 developers). Neither would yet recommend it for large-team production without the automated test coverage and the Phase 3 fixes above.

---

*End of Round 3 synthesis. All issues cross-referenced between both reviews. Source file locations and line numbers verified against the current codebase. Score trajectory tracked across all three rounds for both reviewers.*
