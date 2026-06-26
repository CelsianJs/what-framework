# React Compatibility Layer (`what-react`)

`what-react` lets you run React ecosystem libraries on What Framework. It is a
secondary feature — What's native APIs (`signal`, `computed`, `createStore`,
`useSWR`, …) are preferred for new code. Reach for the compat layer when you
need a specific React library with no What equivalent.

**Honesty note (2026-06-09):** the compat runtime was rewritten this sprint.
Before the rewrite, hooks re-exported What's accessor-returning hooks
(`useState` returned `[signalFn, setFn]`, not `[value, set]`), components never
re-rendered, and `createContext`/`useContext` did not propagate values — most
React libraries crashed or silently broke. Every compatibility claim in this
file was re-established against the NEW runtime, with the date and method
listed. Older lists claiming "49/90+ confirmed packages" referred to the old
runtime and should be considered void.

## Setup

```bash
npm install what-react what-core
```

```js
// vite.config.js
import { defineConfig } from 'vite';
import { reactCompat } from 'what-react/vite';

export default defineConfig({
  plugins: [reactCompat()],
});
```

The plugin aliases `react`, `react-dom`, `react/jsx-runtime`, and
`use-sync-external-store` to `what-react`, sets the automatic JSX runtime, and
excludes React-ecosystem packages from Vite pre-bundling so a single module
instance is shared.

## How It Works

`what-react` ships its own React-semantics runtime (`what-react/src/runtime.js`)
that runs alongside What's run-once renderer — **what-core is not modified**:

- **Hooks return values.** `useState` → `[value, setState]`, `useMemo` → the
  memoized value, `useReducer` → `[state, dispatch]`, etc. Functional updates,
  `Object.is` bail-outs, and batched re-renders (microtask flush) work like
  React's.
- **Components re-render.** On state change the component function re-executes
  and its new output is **reconciled** against the previous tree (keyed,
  type-matched diff). DOM elements and child component instances are preserved
  — focus, input state, and child hook state survive re-renders.
- **Granularity:** only the instance whose state changed re-renders (plus its
  children via the normal React cascade). Siblings and ancestors don't run.
  An infinite-loop guard (100 flush cycles / 250 renders-per-instance window)
  logs and stops runaway update loops instead of hanging.
- **Context works.** `createContext`/`useContext` return actual values, providers
  propagate to arbitrarily deep children, nested providers shadow correctly, and
  context updates reach consumers even through `React.memo`-skipped subtrees.
- **Effects follow React timing.** Element refs attach after DOM insertion,
  `useLayoutEffect` runs synchronously at commit, `useEffect` runs async,
  children's effects run before the parent's, cleanup on deps-change/unmount.
- **Interop is explicit.** Compat semantics apply ONLY to elements created via
  what-react's `createElement`/JSX runtime. Native What vnodes inside a compat
  tree are delegated verbatim to what-core (signals keep working); compat
  components inside native What trees render through a run-once bridge
  component. What's own components are unaffected by this package.

## Verified compatibility matrix

`✅ Verified` = exercised end-to-end on the current runtime. Method legend:
**B** = real browser (headless Chromium driving the Vite fixture at
`packages/react-compat/test/fixtures/acceptance`, dev AND production build),
**J** = jsdom CI tests (`packages/react-compat/test/libs.test.js`, run by
`npm test`).

| Library | Version | Status | Verified | Method | What was tested |
|---|---|---|---|---|---|
| react (API surface) | 18.3-level | ✅ Verified | 2026-06-09 | B+J | hooks, context, refs, keyed lists, portals, class components, error boundaries, lazy+Suspense (47 unit tests) |
| zustand | 5.0.11 | ✅ Verified | 2026-06-09 | B+J | selector returns value, `count*2` renders, store action click updates UI, external `getState().action()` updates UI |
| @tanstack/react-query | 5.90.21 | ✅ Verified | 2026-06-09 | B+J | `QueryClientProvider` + `useQuery` (pending → data), `useMutation` |
| react-hook-form | 7.71.1 | ✅ Verified | 2026-06-09 | B+J | `register`, submit, validation error display + clear, focus-on-error, typed value preserved across error re-render |
| react-hot-toast | 2.6.0 | ✅ Verified | 2026-06-09 | B+J | `<Toaster/>` mounts, `toast.success()` renders with enter animation, auto-dismisses and is removed |
| @headlessui/react | 2.2.9 | ✅ Verified | 2026-06-09 | B+J | Menu opens with ARIA (`aria-expanded`, `role=menu/menuitem`), item click runs handler and closes menu; Switch toggles |
| framer-motion | 11.18.2 | ✅ Verified | 2026-06-09 | B | mount animation (opacity 0→1), `animate={{x}}` transform, `AnimatePresence` exit animation + DOM removal, re-mount |
| use-sync-external-store (shim) | — | ✅ Verified | 2026-06-09 | J | `useSyncExternalStoreWithSelector` selector + isEqual semantics (the shim previously crashed on what-react's own `useMemo`) |
| recharts | 3.8.1 | ✅ Verified | 2026-06-25 | B | AreaChart + LineChart render real SVG geometry (SVG-namespace portal layers, kebab SVG attrs, dashed grid); ResponsiveContainer measures container; no render-loop |

Everything else — including the libraries on the old "confirmed" lists (Radix,
MUI, AntD, react-router, redux, jotai, SWR, TanStack Table, …) — is
**Untested** on the current runtime. They are plausible (the runtime now
implements the semantics they rely on) but no claim is made until they're
re-verified. The compat showcase site (`sites/react-compat`) reflects the same
policy: verified entries listed in the table above, the rest `Untested`.

### Previously-broken findings, re-checked this sprint

| 0.10.0 audit finding | Status now |
|---|---|
| `useState` returns accessor → `count * 2` renders `NaN` | Fixed — values returned; tested |
| zustand selectors return functions; actions become no-ops | Fixed — verified in browser + jsdom |
| react-query / react-hook-form / framer-motion / react-hot-toast / headlessui crash at mount | All five mount and function; verified |
| `createContext`/`useContext`: Provider value never reaches a direct child | Fixed — root cause was reliance on core's `_parentCtx` chain, which is not maintained on the lazy h()/createDOM path; compat now tracks its own instance parent chain |
| what-react's own `use-sync-external-store-with-selector.js` crashes on its own `useMemo` | Fixed by the hooks rework; regression-tested |
| Components run once → no re-render mechanism for React libs | Compat runtime re-renders + reconciles (keyed diff, DOM/state preserving) |

## Known limitations (honest list)

- **No SSR.** Compat components render in the browser (or jsdom) only.
  `renderToString`-ing a compat vnode is unsupported. `hydrateRoot` replaces
  server HTML with a fresh client mount (no real hydration).
- **Suspense is minimal.** Thrown thenables (`lazy()`, `use(promise)`) switch
  the nearest `<Suspense>` to its fallback and back. While the fallback shows,
  the suspended subtree is unmounted (state lost) — React 18 preserves it.
- **Error boundaries** catch render-phase errors (`getDerivedStateFromError` /
  `componentDidCatch`). Errors thrown inside effects are logged to the console,
  not routed to boundaries (React routes those too).
- **`useTransition`/`useDeferredValue` are synchronous.** Rendering is not
  time-sliced; transitions degrade to immediate updates (`isPending` is always
  false). Correct but not concurrent.
- **Class components:** supported (state/lifecycle/error boundaries/contextType),
  but `shouldComponentUpdate` is not consulted — use `React.memo` for skipping.
  `getSnapshotBeforeUpdate` is approximated (called before commit, not between
  render and mutation).
- **Native What children inside compat trees mount once.** Reactivity flows
  through signals, as in What itself; plain-value props passed from a compat
  parent to a What component will not propagate on compat re-renders.
- **Bridge-mounted compat components** (compat component used inside a native
  What tree) attach refs/layout effects before the surrounding What fragment is
  inserted into the document, so layout measurement there can read zeros on
  first mount. When `createRoot` from `what-react/dom` owns the tree (the
  normal case), ref/layout timing matches React.
- **Render-phase cleanup on errors:** if a descendant throws during a subtree
  commit, partially-mounted children's effect cleanups may not run before the
  boundary fallback replaces them.
- **Event mapping:** `onChange` maps to native `input` for text controls and
  `change` for checkbox/radio/file/select (React semantics). `onFocus`/`onBlur`
  use `focusin`/`focusout` (bubbling, like React's delegated events). Events are
  attached directly to elements — there is no synthetic event pooling
  (`e.persist()` is a no-op shim).

## Re-running the verification

```bash
# jsdom CI suites (run automatically by `npm test` at the repo root)
node --test packages/react-compat/test/

# Browser acceptance fixture (real Chromium, uses the reactCompat() plugin)
cd packages/react-compat/test/fixtures/acceptance
npm install
npm run dev        # http://localhost:4600 — interact with the 7 sections
npm run build && npm run preview   # same checks against the production build
```

The fixture's sections map 1:1 to the matrix rows; each renders IDs
(`#ctx-value`, `#z-count`, `#q-data`, `#f-error`, `#m-picked`, `#mo-box`, …)
so the flows can be asserted by any browser automation tool. The jsdom suite
(`test/libs.test.js`) imports the same libraries from
`packages/react-compat/test/app/node_modules` and skips with a notice if that
fixture isn't installed.
