/**
 * What Compiler Runtime
 *
 * With the unified rendering path (babel plugin → h() → core reconciler),
 * most runtime helpers are no longer needed. The compiler now outputs h() calls
 * that go through what-core's VNode reconciler.
 *
 * This file re-exports from what-core for backwards compatibility.
 */

export { h, Fragment, mount, Island } from 'what-core';
