# Framework bundle size baseline

What ships 4587 fewer raw JS bytes than Solid 2 for hello and 370 fewer for todo. With Brotli it ships 3520 fewer bytes for hello and 2265 fewer for todo.

## Size in bytes

| App | Framework | Raw | Gzip 9 | Brotli 11 | Mapped framework JS |
| --- | --- | --- | --- | --- | --- |
| hello | what | 23795 | 8113 | 7267 | 22874 |
| hello | solid1 | 8797 | 3640 | 3293 | 7877 |
| hello | solid2 | 28382 | 11785 | 10787 | 27488 |
| hello | react | 222667 | 69203 | 59694 | 221611 |
| todo | what | 34132 | 12033 | 10753 | 32471 |
| todo | solid1 | 11243 | 4684 | 4226 | 9571 |
| todo | solid2 | 34502 | 14264 | 13018 | 32828 |
| todo | react | 223682 | 69638 | 60060 | 221616 |
| krausest | react | 196314 | 61526 | 53062 | — |
| krausest | solid | 13224 | 5441 | 4921 | — |
| krausest | solid2 | 62145 | 24083 | 21988 | 59554 |
| krausest | vanilla | 3936 | 1602 | 1384 | — |
| krausest | what | 34297 | 12100 | 10793 | 31779 |


Krausest rows use the existing sibling builds as-is, including their own toolchain and compiler options. A dash means no module attribution was available. The files were measured and exercised in Chromium.

- solid2 attribution — byte-identical shadow rebuild.
- what attribution — byte-identical shadow rebuild.

## Method and provenance

- Each matched app is a separate Vite production build targeting ES2022 with esbuild minification and default module preload support. What uses the workspace compiler and aliases from the krausest harness. Solid 1 uses the 1.x Babel preset and Solid 2 uses the stable `@solidjs/babel-plugin` 2.x compiler. React uses Vite’s automatic JSX transform. The compiler-specific defaults are part of each measured stack.
- Plain JS asset byte counts exclude HTML, CSS and hidden maps. Gzip level 9 and Brotli quality 11 run independently on each complete JS asset. Framework overhead is the sum of attributed minified spans owned by runtime source packages, including dependencies. Compression is measured for whole assets.
- Rollup `renderedLength` counts characters after tree-shaking and before minification. Minified bytes attribute UTF-8 spans between source map segments to their mapped source. Synthetic code, uncovered parts and line terminators appear in the unmapped count. Per-module and per-symbol values are estimates based on generated mappings. The raw JS and compressed asset sizes are exact.
- Every listed app passed a production smoke test with the root Playwright dependency. Todo checks add, toggle, count, filter, keyed row identity and removal. Krausest checks create, update, remove and clear.
- When the existing Krausest What and Solid 2 assets have no maps, the runner attempts to rebuild them with hidden maps and the sibling toolchain. The original artifacts supply all headline sizes. The reports use the rebuilt attribution only when all JS asset hashes match.
- Both Solid majors emitted mapped bytes from their expected production browser modules. The script asserts the package versions and rejects the other major’s modules. `results.json` includes the verified module paths and per-asset SHA-256 digests.
- Machine `darwin / 25.5.0 / arm64 / Apple M3 Max`.
- Toolchain `node v22.13.1`, `npm 11.0.0`, `zlib 1.3.0.1-motley-82a5fec`, `brotli 1.1.0`, `solid1 1.9.20`, `solid-js 2.0.3`, `@solidjs/web 2.0.3`, `@solidjs/signals 2.0.3`, `react 19.3.1`, `react-dom 19.3.1`, `vite 7.3.8`, `esbuild 0.28.2`, `rollup 4.68.7`, `@babel/core 7.29.0`, `babel-preset-solid 1.9.19`, `@solidjs/babel-plugin 2.0.2`, `playwright 1.64.0`, `what-compiler 0.14.0`, `chromium 156.0.8078.4`.
- What working-tree build at `0731cbb80e4695de6d0a4039a1a855254ffdbcae`. Git reported no local core or compiler changes.

## Krausest package provenance

These are the sibling harness’s own package-level, pre-minifier Rollup totals. The module tables below give mapped minified bytes where available.

| Framework | Package | Rendered length |
| --- | --- | --- |
| react | `react@19.2.7` | 20048 |
| react | `react-dom@19.2.7` | 561127 |
| react | `scheduler@0.27.0` | 11360 |
| react | `what-krausest-benchmark@0.0.0` | 5452 |
| solid | `solid-js@1.9.20` | 22362 |
| solid | `what-krausest-benchmark@0.0.0` | 4372 |
| solid2 | `@solidjs/signals@2.0.3` | 289896 |
| solid2 | `@solidjs/web@2.0.3` | 16447 |
| solid2 | `solid-js@2.0.3` | 850 |
| solid2 | `what-krausest-solid2@0.0.0` | 4448 |
| vanilla | `what-krausest-benchmark@0.0.0` | 4723 |
| what | `what-core@0.14.0` | 89134 |
| what | `what-krausest-benchmark@0.0.0` | 4810 |


## What and Solid 2 module composition

### hello / what

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `packages/core/src/dom.js` | 11718 | 43932 |
| `packages/core/src/render.js` | 6518 | 12137 |
| `packages/core/src/reactive.js` | 4490 | 10505 |
| `benchmark/size/apps/what/hello.jsx` | 188 | 588 |
| `packages/core/src/components.js` | 148 | 683 |
| `benchmark/size/index.html` | 0 | 0 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 733 | — |

### hello / solid2

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/core.js` | 6428 | 38486 |
| `benchmark/size/node_modules/@solidjs/web/dist/web.js` | 5902 | 13683 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/scheduler.js` | 4940 | 42618 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/async.js` | 4013 | 19970 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/owner.js` | 1564 | 12419 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/heap.js` | 1248 | 5015 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/graph.js` | 857 | 6296 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/effect.js` | 831 | 6096 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/flatten.js` | 670 | 2162 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/constants.js` | 411 | 12519 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/error.js` | 322 | 2098 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/signals.js` | 235 | 1653 |
| `benchmark/size/apps/solid2/hello.jsx` | 183 | 421 |
| `benchmark/size/node_modules/solid-js/dist/solid.js` | 67 | 209 |
| `benchmark/size/index.html` | 0 | 0 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 711 | — |

### todo / what

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `packages/core/src/render.js` | 14377 | 33781 |
| `packages/core/src/dom.js` | 11736 | 43932 |
| `packages/core/src/reactive.js` | 6210 | 14699 |
| `benchmark/size/apps/what/todo.jsx` | 928 | 2540 |
| `packages/core/src/components.js` | 148 | 683 |
| `benchmark/size/index.html` | 0 | 0 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 733 | — |

### todo / solid2

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/core.js` | 6434 | 38486 |
| `benchmark/size/node_modules/@solidjs/web/dist/web.js` | 6180 | 13683 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/scheduler.js` | 4941 | 42618 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/map.js` | 4794 | 19200 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/async.js` | 4014 | 19970 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/owner.js` | 1564 | 12419 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/heap.js` | 1248 | 5015 |
| `benchmark/size/apps/solid2/todo.jsx` | 963 | 2285 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/graph.js` | 857 | 6296 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/effect.js` | 831 | 6096 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/flatten.js` | 670 | 2162 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/constants.js` | 412 | 12519 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/error.js` | 322 | 2098 |
| `benchmark/size/node_modules/solid-js/dist/solid.js` | 275 | 657 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/signals.js` | 267 | 1723 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/store/types.js` | 19 | 89 |
| `benchmark/size/index.html` | 0 | 0 |
| `benchmark/size/node_modules/@solidjs/signals/dist/prod/core/attribution-hooks.js` | 0 | 21 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 711 | — |

### krausest / solid2

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/store.js` | 17494 | 85290 |
| `benchmark/krausest/frameworks/solid2/node_modules/@solidjs/web/dist/web.js` | 8281 | 16447 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/core.js` | 6652 | 39738 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/scheduler.js` | 5066 | 43918 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/map.js` | 4811 | 19229 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/async.js` | 4208 | 20866 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/reconcile.js` | 2930 | 10785 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/projection.js` | 2485 | 15768 |
| `benchmark/krausest/frameworks/solid2/main.jsx` | 1880 | 4448 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/owner.js` | 1628 | 13581 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/heap.js` | 1257 | 5015 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/graph.js` | 879 | 6367 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/effect.js` | 834 | 6096 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/types.js` | 691 | 2513 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/flatten.js` | 670 | 2162 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/constants.js` | 423 | 12815 |
| `benchmark/krausest/frameworks/solid2/node_modules/solid-js/dist/solid.js` | 370 | 850 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/error.js` | 322 | 2098 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/target.js` | 241 | 1665 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/signals.js` | 235 | 1653 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/index.js` | 65 | 136 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/store/hooks.js` | 12 | 180 |
| `benchmark/krausest/frameworks/solid2/index.html` | 0 | 0 |
| `benchmark/krausest/node_modules/@solidjs/signals/dist/prod/core/attribution-hooks.js` | 0 | 21 |
| `benchmark/krausest/shared/main.css` | 0 | 0 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 711 | — |

### krausest / what

| Module | Minified bytes by map | Rollup rendered length |
| --- | --- | --- |
| `packages/core/src/render.js` | 14732 | 32484 |
| `packages/core/src/dom.js` | 11737 | 43932 |
| `packages/core/src/reactive.js` | 5162 | 12035 |
| `benchmark/krausest/frameworks/what/main.jsx` | 1785 | 4810 |
| `packages/core/src/components.js` | 148 | 683 |
| `benchmark/krausest/frameworks/what/index.html` | 0 | 0 |
| `benchmark/krausest/shared/main.css` | 0 | 0 |
| `vite/modulepreload-polyfill.js` | 0 | 1168 |
| Unmapped (including generated bundler code) | 733 | — |


## What’s largest retained runtime regions

The largest retained What costs are listed below. The source ranges are disjoint within each module. They measure how much code ships in those regions, independently of how much a refactor would save.

| What runtime region | Source | Hello bytes | Todo bytes |
| --- | --- | --- | --- |
| Keyed and unkeyed list reconciliation | [`packages/core/src/render.js:601`](../../packages/core/src/render.js#L601)–1450 | 0 | 7269 |
| Generic insertion, conversion and reconciliation | [`packages/core/src/render.js:235`](../../packages/core/src/render.js#L235)–592 | 3439 | 3451 |
| Fallback element creation and generic prop handling | [`packages/core/src/dom.js:977`](../../packages/core/src/dom.js#L977)–1300 | 2794 | 2796 |
| VNode error/suspense boundaries and portal | [`packages/core/src/dom.js:773`](../../packages/core/src/dom.js#L773)–976 | 2208 | 2210 |
| Compiled templates and SVG/table fallback | [`packages/core/src/render.js:94`](../../packages/core/src/render.js#L94)–219 | 2182 | 2182 |
| VNode class bridge, component context and lifecycle | [`packages/core/src/dom.js:616`](../../packages/core/src/dom.js#L616)–772 | 1746 | 1743 |
| Generic VNode dispatcher | [`packages/core/src/dom.js:281`](../../packages/core/src/dom.js#L281)–456 | 1419 | 1422 |
| Disposal and live range tracking | [`packages/core/src/dom.js:108`](../../packages/core/src/dom.js#L108)–263 | 1156 | 1161 |
| Development-only preinstall buffer | [`packages/core/src/reactive.js:934`](../../packages/core/src/reactive.js#L934)–960 | 416 | 416 |
| Hydration entry, walker and boundaries | [`packages/core/src/render.js:1770`](../../packages/core/src/render.js#L1770)–2927 | 0 | 0 |

- **General renderer.** Compiled JSX invokes [`packages/core/src/render.js:82`](../../packages/core/src/render.js#L82) and public mount invokes [`packages/core/src/dom.js:265`](../../packages/core/src/dom.js#L265). Both call the generic VNode dispatcher. Dispatch branches retain uncompiled elements, the class bridge, boundary and portal fallback, and generic props even for a component that returns compiled DOM. Separating a compiler-specific entry could keep those branches out of apps that never use them. The generic entry still needs those behaviors.
- **Insertion and lists.** The counter uses the text fast path inside a generic compiled insert helper. Its type-changing fallback keeps conversion, reconciliation, and disposal reachable. The todo adds the keyed and unkeyed branches of What’s shared mapper. Solid 2’s `map.js` contributes 4794 bytes in this run. A keyed-only entry or a compiler-proven text binding could narrow these call graphs. These are candidates for testing with conditional children, ownership and disposal cases.
- **Templates.** Generic template parsing retains SVG and table wrapping because it dispatches on an HTML string. Compiler specialization could move those branches to call sites that need them.
- **Hydration.** The walker and Island registration contribute zero mapped bytes in these two builds. The diagnostic build that deletes the registration call in memory emitted byte-identical JavaScript. Removing that registration would affect clients that use islands and provides no savings here. [`packages/core/src/render.js:2927`](../../packages/core/src/render.js#L2927)


## What hello runtime exports

The table covers surviving definitions from What source modules. Re-exports are counted at their defining module. An export can remain because internal code calls it, even when the app imports a different symbol.

| Definition | Source | Minified bytes | Why retained |
| --- | --- | --- | --- |
| `_isEventProp` | [`packages/core/src/dom.js:56`](../../packages/core/src/dom.js#L56) | 123 | General VNode prop dispatch distinguishes event handlers from accessors. |
| `_isUnsafeAttr` | [`packages/core/src/dom.js:66`](../../packages/core/src/dom.js#L66) | 101 | The VNode prop path screens URLs and unsafe attributes. |
| `_isAriaAttr` | [`packages/core/src/dom.js:87`](../../packages/core/src/dom.js#L87) | 56 | The general VNode prop path preserves ARIA boolean syntax. |
| `disposeTree` | [`packages/core/src/dom.js:163`](../../packages/core/src/dom.js#L163) | 426 | Called by mount and generic DOM replacement. Cleans up components, effects and owned nodes. |
| `_liveRegionNodes` | [`packages/core/src/dom.js:241`](../../packages/core/src/dom.js#L241) | 209 | Called by reactive and generic replacement to walk live ranges between paired markers. |
| `mount` | [`packages/core/src/dom.js:265`](../../packages/core/src/dom.js#L265) | 159 | Direct app entry. Disposes the previous tree and dispatches the input through createDOM. |
| `createDOM` | [`packages/core/src/dom.js:281`](../../packages/core/src/dom.js#L281) | 1419 | Shared dispatcher for mount, compiled components and generic inserts. It handles DOM, VNodes, lists, accessors and fragments. |
| `getCurrentComponent` | [`packages/core/src/dom.js:488`](../../packages/core/src/dom.js#L488) | 35 | Shared component stack lookup. dom.js:493 also registers it for error reporting. |
| `getComponentStack` | [`packages/core/src/dom.js:496`](../../packages/core/src/dom.js#L496) | 23 | Compiled insert captures and restores the active component around an effect. |
| `_installLazyChildren` | [`packages/core/src/dom.js:574`](../../packages/core/src/dom.js#L574) | 220 | General component instantiation can receive a deferred compiled child factory. |
| `_handleNavigationSignal` | [`packages/core/src/dom.js:608`](../../packages/core/src/dom.js#L608) | 90 | General component error handling checks for router navigation before sending errors to a boundary. |
| `_setSelectValue` | [`packages/core/src/dom.js:1025`](../../packages/core/src/dom.js#L1025) | 80 | The general VNode prop path handles single and multiple select values. |
| `_$componentVNode` | [`packages/core/src/render.js:45`](../../packages/core/src/render.js#L45) | 421 | Called by the compiler-emitted _$createComponent to normalize props and children. |
| `_$createComponent` | [`packages/core/src/render.js:82`](../../packages/core/src/render.js#L82) | 39 | Compiler-emitted component entry. Calls the general createDOM dispatcher. |
| `_$template` | [`packages/core/src/render.js:125`](../../packages/core/src/render.js#L125) | 696 | Compiler-emitted template used for the main element and its children. |
| `svgTemplate` | [`packages/core/src/render.js:200`](../../packages/core/src/render.js#L200) | 318 | The same template implementation dispatches to SVG parsing based on the template string. |
| `insert` | [`packages/core/src/render.js:259`](../../packages/core/src/render.js#L259) | 778 | Compiler-emitted reactive counter binding. Text shares this helper with list and general value insertion. |
| `delegateEvents` | [`packages/core/src/render.js:1717`](../../packages/core/src/render.js#L1717) | 410 | Compiler-emitted click event registration executes at module load. |
| `__DEV__` | [`packages/core/src/reactive.js:23`](../../packages/core/src/reactive.js#L23) | 94 | Runtime global override keeps the development condition live in framework modules. |
| `__devtools` | [`packages/core/src/reactive.js:35`](../../packages/core/src/reactive.js#L35) | 7 | The module-load development buffer and reachable signal, effect and component hooks share this binding. |
| `signal` | [`packages/core/src/reactive.js:77`](../../packages/core/src/reactive.js#L77) | 470 | App counter state. Also used within the reached DOM runtime. |
| `effect` | [`packages/core/src/reactive.js:333`](../../packages/core/src/reactive.js#L333) | 274 | Compiler insertion and general DOM binders use tracked effects. |
| `untrack` | [`packages/core/src/reactive.js:785`](../../packages/core/src/reactive.js#L785) | 60 | Used for component execution and reconciliation reads that must avoid capturing dependencies. |
| `_injectGetCurrentComponent` | [`packages/core/src/components.js:29`](../../packages/core/src/components.js#L29) | 20 | dom.js:493 registers the stack lookup read by reportError. |
| `reportError` | [`packages/core/src/components.js:162`](../../packages/core/src/components.js#L162) | 116 | General component and effect error handling can route errors through a context boundary. |

Other exports from the same included modules were removed, including `addHydrationDisposer`, `addHydratedComponent`, `_beginComponentSSR`, `_endComponentSSR`, `_setTextInsertHook`, `template`, `_template`, `mapArray`, `_mapArrayToArray`, `spread`, `setProp`, `setClass`, `setStyle`, `setAttr`, `setValue`, `setChecked`, `on`, `classList`, `isHydrating`, `hydrate`, `__setDevToolsHooks`, `computed`, `batch`, `memo`, `flushSync`, `getOwner`, `runWithOwner`, `createRoot`, `_createItemScope`, `onCleanup`, `__drainPreinstallBuffer`, `shallowEqual`, `lazy`, `Suspense`, `ErrorBoundary`, `Show`, `For`, `Switch`, `Match`, `_injectIslandRuntime`, `Island`.

## What production diagnostics

Vite builds in production mode. In What, `globalThis.__WHAT_DEV__` can still enable development code when explicitly set at runtime. The diagnostic build replaces the exported flag with literal `false` in memory. That disables the production global override. Both diagnostics passed the same app smoke tests.

| App | Diagnostic | Raw bytes | Raw saved | Gzip saved | Brotli saved |
| --- | --- | --- | --- | --- | --- |
| hello | static-dev-flag | 21058 | 2737 | 952 | 829 |
| todo | static-dev-flag | 31163 | 2969 | 1044 | 915 |
| hello | without-island-registration | 23795 | 0 | 0 | 0 |
| todo | without-island-registration | 34132 | 0 | 0 | 0 |

In hello the mapped reductions from the static flag are 672 B in `dom.js`, 412 B in `render.js`, 1631 B in `reactive.js`, 0 B in `components.js`.

| Output marker | Hello | Todo | Static hello | Static todo |
| --- | --- | --- | --- | --- |
| Runtime development override (`reactive.js:23`) | yes | yes | — | — |
| WeakRef devtools preinstall buffer (`reactive.js:934`) | yes | yes | — | — |
| Signal update hook (`reactive.js:106`) | yes | yes | — | — |
| Effect run hook (`reactive.js:353`) | yes | yes | — | — |
| Component mount/unmount hooks (`dom.js:142`) | yes | yes | — | — |
| Invalid template nesting diagnostic (`render.js:157`) | yes | yes | — | — |
| Invalid insertion parent warning (`render.js:495`) | yes | yes | — | — |
| Potential XSS warning for raw HTML (`dom.js:1127`) | yes | yes | — | — |
| Effect loop developer guidance (`reactive.js:667`) | yes | yes | — | — |
| Unsafe URL warning and block (`dom.js:1089`) | yes | yes | yes | yes |
| Uncaught reactive-update error reporting (`reactive.js:610`) | yes | yes | yes | yes |
| Production effect-loop warning (`reactive.js:677`) | yes | yes | yes | yes |
| Hydration diagnostic (`render.js:1955`) | — | — | — | — |

The marker check looks at emitted JS, while module and symbol attribution use sourcemaps and the Rollup ledger. Standalone `warnings.js`, `guardrails.js` and the `ERROR_CODES` table in `errors.js` have no retained modules in hello or todo. Inline warnings in retained modules do ship, including the dev-only examples above. The invalid-parent early return remains when its warning is removed. The URL protection, uncaught error logging, and effect loop cap are runtime behavior. A separate static production entry could remove the dev-only payload for consumers that do not need runtime opt-in.

