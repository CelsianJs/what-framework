/**
 * What Compiler Runtime (what-compiler/runtime)
 *
 * Re-exports h, Fragment and mount from what-core and _$Island from
 * what-core/render. Compiled output does not import this module: client output
 * imports its helpers from what-framework and what-framework/render (or their
 * what-core twins), server output from what-framework/ssr-runtime.
 */

export { h, Fragment, mount } from 'what-core';
export { _$Island } from 'what-core/render';
