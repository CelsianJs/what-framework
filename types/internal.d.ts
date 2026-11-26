// Internal-only type declarations. Nothing here is published: no package
// references this file, `tsconfig.src.json` is the only config that includes it,
// and it exists so the implementation can be typechecked without pretending the
// framework's runtime expando properties do not exist.
//
// Every property below is really attached at runtime by the file named in its
// comment. Declaring them here is not a suppression: `_dispose?: () => void`
// still rejects `node._dispose = 5` and still catches `node._dispsoe`.

export {};

declare global {
  /**
   * The development flag's input, read by core/src/env.js and
   * core/src/env-development.js (what-core's `#env` import). scripts/build.js
   * (dist/*.min.js) and what-compiler/vite (production builds) define it as
   * `false`. In src/, it is an optional global: set before the framework
   * loads, it forces the development or production tier. The bundler tier
   * (dist/*.js) reads process.env.NODE_ENV instead.
   */
  var __WHAT_DEV__: boolean | undefined;

  /**
   * The devtools hook surface. `__devtools` in core/src/reactive.js is null
   * until `__setDevToolsHooks` installs hooks (always null in production);
   * every hook is optional.
   *
   * Signals are handed out as their function; computeds and effects as their
   * node (`WhatComputedNode`, `WhatEffectNode`).
   */
  interface WhatDevToolsHooks {
    onSignalCreate?(sig: any): void;
    /** Called after the write, with the new and the previous value. */
    onSignalUpdate?(sig: any, next?: any, prev?: any): void;
    /** Effects and computeds. */
    onEffectCreate?(node: any): void;
    onEffectDispose?(node: any): void;
    /**
     * After every run of an effect or a computed. Re-runs pass `causes`: the
     * dependencies whose value changed since the node's previous run (signal
     * functions and computed nodes), i.e. why it ran.
     */
    onEffectRun?(node: any, info?: { causes: any[] | null }): void;
    trace?: boolean;
    onRecord?(type: string, subject: any, state?: any): void;
    /**
     * Once per thrown error: an effect's run or cleanup ('effect',
     * 'effect-cleanup', with the effect), a cleanup an owner held ('cleanup'),
     * or a component that threw while it was built ('component', with the
     * owner it was built under).
     */
    onError?(err: any, context?: { type: 'effect' | 'effect-cleanup' | 'cleanup' | 'component'; effect?: any; owner?: any }): void;
    onComponentMount?(ctx: any): void;
    onComponentUnmount?(ctx: any): void;
    [key: string]: any;
  }

  /**
   * Development-only exports of core/src/reactive.js (re-exported by
   * what-core/internal) for tools that inspect the reactive graph. Production builds
   * return empty results. Nodes are reported the way the devtools hooks hand
   * them out: a signal as its function, a computed or an effect as its node.
   */
  interface WhatDevApi {
    /**
     * The dependencies `x` read in its latest run, without duplicates, in read
     * order. `x` is a signal or computed function, or a computed or effect
     * node. A signal has none.
     */
    __depsOf(x: any): any[];
    /** The computed and effect nodes subscribed to a signal or computed. */
    __subsOf(x: any): Array<WhatComputedNode | WhatEffectNode>;
    /**
     * The effect whose function is executing (untrack() does not hide it), or
     * null. Called from `onSignalUpdate`, it names the effect that wrote.
     */
    __currentEffect(): WhatEffectNode | null;
    /**
     * The owner of an effect or computed node (or computed function), of an
     * owner, or of a DOM node: the component whose output holds it.
     */
    __ownerOf(x: any): WhatOwner | WhatEffectNode | WhatComputedNode | null;
    /**
     * The scopes holding `x`, root first ('<App>', 'effect "sync"'), with the
     * innermost source location the compiler supplied as `loc`.
     */
    __ownerPath(x: any): string[] & { loc: string | null };
  }

  /**
   * A signal function from core/src/reactive.js: `s()` reads (and tracks),
   * `s(v)` writes. `set`, `peek` and `subscribe` come from a shared prototype
   * and become own properties on first access, so they can be detached or
   * replaced.
   */
  interface WhatSignalFunction {
    (): any;
    (next: any): void;
    set(next: any): void;
    peek(): any;
    subscribe(fn: (value: any) => void): () => void;
    mutate(fn: (value: any) => void): void;
    _signal: true;
    /** Development only. */
    _debugName?: string;
    _devLoc?: string | null;
    /** Set by what-devtools on registration. */
    _devId?: number;
  }

  /** A computed (or memo) reader from core/src/reactive.js. */
  interface WhatComputedFunction {
    (): any;
    peek(): any;
    _signal: true;
  }

  /**
   * A dependency edge, created in core/src/reactive.js. It sits in the
   * subscriber's dependency list (`prevDep`/`nextDep`) and the dependency's
   * subscriber list (`prevSub`/`nextSub`) at once. `version` is the run that
   * last read it, or -1 once the edge is removed from both lists.
   */
  interface WhatLink {
    dep: WhatSignalNode | WhatComputedNode | WhatKeyNode;
    sub: WhatComputedNode | WhatEffectNode | WhatSelectorNode;
    version: number;
    prevDep: WhatLink | null;
    nextDep: WhatLink | null;
    prevSub: WhatLink | null;
    nextSub: WhatLink | null;
  }

  /**
   * The state behind a signal function (core/src/reactive.js). `flags` is 0.
   * The dev fields are attached only in the development tier.
   */
  interface WhatSignalNode {
    value: any;
    subHead: WhatLink | null;
    subTail: WhatLink | null;
    flags: number;
    devOwnerRef?: WeakRef<WhatOwner | WhatEffectNode | WhatComputedNode>;
    /** Dev: the signal function and its last write stamp. */
    sig?: any;
    devSeq?: number;
  }

  /**
   * A computed (also what memo() creates). `value` holds the thrown error
   * while the ERRORED flag is set. `owner` is the owner record it was created
   * under; `owned` is the owner record of its latest evaluation, made the
   * first time an evaluation creates something, and disposed before the next.
   */
  interface WhatComputedNode {
    value: any;
    subHead: WhatLink | null;
    subTail: WhatLink | null;
    depHead: WhatLink | null;
    depTail: WhatLink | null;
    flags: number;
    fn: () => any;
    owner: WhatOwner | null;
    owned: WhatOwner | null;
    /** Dev: what-compiler's "name@path:line:column". */
    devName?: string;
    /** Dev: the reader function and its change stamps. */
    sig?: any;
    devSeq?: number;
    devSeen?: number;
    /** Set by what-devtools on registration. */
    _devId?: number;
  }

  /**
   * The computed behind a createSelector (core/src/reactive.js,
   * `_createSelector`): `fn` is the selector's source, `value` its current
   * value. `keys` holds one key node per key a tracked read asked about.
   */
  interface WhatSelectorNode extends WhatComputedNode {
    keys: Map<any, WhatKeyNode>;
  }

  /**
   * One key of a selector: a dependency node, like a signal's, whose readers
   * re-run when the selector's value leaves or enters `value` (the key).
   * `sel` is its selector, which drops the key once it has no readers.
   */
  interface WhatKeyNode {
    value: any;
    subHead: WhatLink | null;
    subTail: WhatLink | null;
    flags: number;
    sel: WhatSelectorNode;
  }

  /**
   * An effect node. `owner` is the owner record it is registered with (during
   * its first run, whatever was current when it was created); `parent` is the
   * effect that was running when it was created, which is always queued
   * before it. `owned` is the owner record of its latest run, made the first
   * time a run creates something, and disposed before the next run.
   */
  interface WhatEffectNode {
    fn: () => any;
    depHead: WhatLink | null;
    depTail: WhatLink | null;
    flags: number;
    cleanup: null | (() => void);
    owner: WhatOwner | WhatEffectNode | WhatComputedNode | null;
    parent: WhatEffectNode | null;
    owned: WhatOwner | null;
    /** A useEffect's or onMount's (_userEffect): the order it was first queued in, 0 until then. */
    queued?: number;
    /** Dev: what-compiler's "name@path:line:column". */
    devName?: string;
    devBinding?: Node;
    /** Dev: change stamp of the last run. */
    devSeen?: number;
    /** Set by what-devtools on registration. */
    _devId?: number;
  }

  /**
   * Owner record (core/src/reactive.js): a root (`createRoot`), a list row
   * (`_createItemScope`), a component (`_componentOwner`), or the record of an
   * effect's or computed's run (`owned`). `owner` is what it was created under:
   * an owner record, or for the record of a run, its effect or computed.
   * Roots and components are linked into their parent's child list
   * (`firstChild`…`lastChild` through `prevSibling`/`nextSibling`); rows keep
   * `owner` for lookups but are not linked, because the list reconciler
   * disposes them. `disposals` holds cleanup functions and effect and
   * computed nodes; `dropped` counts the entries disposed one by one since the
   * list was last swept. `flags` carries DISPOSED, as every owner does.
   *
   * Handlers: `_onError` (an error boundary installs it on the root of its
   * children) receives errors from effect re-runs and cleanups, bindings, rows
   * and components built later under this owner while it is not disposed;
   * `_onPending` (a Suspense boundary installs it) receives the thenables a
   * component throws while it is built.
   *
   * A component's owner also carries `Component`, its hook slots (`hooks`,
   * `hookIndex`) and its context values (`context`), and in development its
   * compiler location (`devLoc`), its parent component (`_parentCtx`) and the
   * node that opens its output (`_wrapper`). A server component frame carries
   * `_parentCtx` and the owner to restore when it ends (`_outer`).
   */
  interface WhatOwner {
    devScope?: string;
    flags: number;
    disposals: Array<(() => void) | WhatEffectNode | WhatComputedNode>;
    owner: WhatOwner | WhatEffectNode | WhatComputedNode | null;
    firstChild: WhatOwner | null;
    lastChild: WhatOwner | null;
    prevSibling: WhatOwner | null;
    nextSibling: WhatOwner | null;
    dropped: number;
    _onError?: (error: any) => void;
    _onPending?: (thenable: any) => void;
    Component?: any;
    hooks?: any[] | null;
    hookIndex?: number;
    context?: Map<any, any> | null;
    [key: string]: any;
  }

  /**
   * A what-react component instance. Created in react-compat/src/runtime.js
   * and hung off `currentInstance` for the duration of a render. The `_ctx*`
   * and suspense fields are written later by hooks.js / index.js.
   */
  interface WhatCompatInstance {
    parent?: WhatCompatInstance | null;
    _ctxProvided?: Map<any, any>;
    _ctxSubs?: Map<any, any>;
    _ctxDeps?: any[];
    _errorHandler?: ((error: any) => void) | null;
    _isSuspense?: boolean;
    _suspendCount?: number;
    [key: string]: any;
  }

  /**
   * Cursor used by hydrate() in core/src/render.js to walk the existing DOM.
   */
  interface WhatHydrationCursor {
    parent: any;
    index: number;
  }

  interface Set<T> {
    /**
     * Set by the JSX transform in compiler/src/babel-plugin.js. Hangs the set
     * of names destructured out of a component's props parameter off the
     * signal-name set, so a prop identifier can be told apart from a signal.
     */
    fromDestructuredProps?: Set<any>;
  }

  interface Comment {
    /**
     * Set by core/src/render.js on the start comment of a component built
     * under no owner, until mount() or hydrate() adopts the component.
     */
    _owner?: WhatOwner;
  }

  interface ImportMeta {
    /** Vite's define-time environment object. Absent under plain Node. */
    env?: Record<string, any> & { DEV?: boolean; PROD?: boolean; MODE?: string };
  }

  interface Window {
    /** Installed by what-devtools / what-devtools-mcp client bundles. */
    __WHAT_CORE__?: any;
    __WHAT_DEVTOOLS__?: any;
    __WHAT_COMPILER__?: any;
    /** Opt-in flag that lets the MCP bridge evaluate arbitrary expressions. */
    __WHAT_UNSAFE_EVAL__?: boolean;
    /** Reconnect handle the MCP client exposes for manual retries. */
    __WHAT_MCP_RECONNECT__?: () => void;
  }
}
