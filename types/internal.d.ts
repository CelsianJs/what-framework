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
   * The devtools hook surface. `__devtools` in core/src/reactive.js is null in
   * production, a buffering placeholder in dev before install, and the real
   * hooks after `__setDevToolsHooks`. All three shapes satisfy this.
   */
  interface WhatDevToolsHooks {
    onSignalCreate?(sig: any): void;
    onSignalUpdate?(sig: any, next?: any, prev?: any): void;
    onEffectCreate?(effect: any): void;
    onEffectDispose?(effect: any): void;
    onEffectRun?(effect: any, ...rest: any[]): void;
    onError?(err: any, ...rest: any[]): void;
    onComponentMount?(ctx: any): void;
    onComponentUnmount?(ctx: any): void;
    /** Marks the pre-install buffering placeholder, not the real hooks. */
    __isPreinstallBuffer?: boolean;
    /** The placeholder's weak-ref buffer, drained on late install. */
    __buffer?: { signals: Set<any>; effects: Set<any>; components: any[] };
    [key: string]: any;
  }

  /**
   * The reactive graph's effect node, created in core/src/reactive.js. The
   * literal is written out in full at creation so every node shares one hidden
   * class; the fields that start as null are filled in later by `computed()`
   * and by the effect runner, which is why they are unions rather than plain
   * nulls here.
   */
  interface WhatEffectNode {
    fn: any;
    deps: any[];
    lazy: boolean;
    disposed: boolean;
    _pending: boolean;
    _stable: boolean;
    _level: number;
    _computed: boolean;
    _epoch: number;
    _onNotify: null | (() => void);
    _computedSubs: null | Set<any>;
    _isDirty: null | (() => boolean);
    _markDirty: null | (() => void);
    _cleanup: null | (() => void);
    /** Dev-only extras (`_debugName`, `_stack`) and future fields. */
    [key: string]: any;
  }

  /**
   * Ownership / root scope created by `createRoot` and `_createItemScope`
   * in core/src/reactive.js. `owner` is the parent scope (null at the
   * outermost root and on item scopes, which do not register with a parent).
   */
  interface WhatOwner {
    disposals: Array<() => void>;
    owner: WhatOwner | null;
    children: WhatOwner[];
    _disposed: boolean;
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
     * Set by `effect()` in core/src/reactive.js. A dependency Set owned by an
     * effect points back at it so disposal can unsubscribe. Signal subscriber
     * Sets deliberately leave this `undefined`; see the invariant documented at
     * reactive.js:50, where `_owner === undefined` is what marks level 0.
     */
    _owner?: any;
    /**
     * Set by `signal()` in core/src/reactive.js under `__DEV__` only. Points a
     * subscriber Set back at the signal that owns it so `trackSignals()` can
     * follow reads transitively.
     */
    _signalOwner?: any;
    /**
     * Set by the JSX transform in compiler/src/babel-plugin.js. Hangs the set
     * of names destructured out of a component's props parameter off the
     * signal-name set, so a prop identifier can be told apart from a signal.
     */
    fromDestructuredProps?: Set<any>;
  }

  interface Comment {
    /** Set by core/src/dom.js and core/src/render.js on range-marker comments. */
    _dispose?: () => void;
    /** Set by core/src/dom.js on the marker that anchors a component's range. */
    _componentCtx?: any;
  }

  interface DocumentFragment {
    /** Set by core/src/dom.js on the fragment a component renders into. */
    _componentCtx?: any;
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
    /** Verbose-logging flag for the devtools client. */
    __WHAT_DEVTOOLS_DEBUG__?: boolean;
  }
}
