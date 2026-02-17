# npm Consumer Review (What Framework 0.4.2)

Date: February 17, 2026  
Project: `examples/npm-eight-pages-review`

## Scope

- Create a new app from npm only (`create-what@0.4.2`, `what-framework@0.4.2`).
- Build an 8-page feature walkthrough.
- Validate setup/build/runtime behavior and document DX pain points, bugs, and workarounds.

## What Was Created

Routes implemented:

1. `/` home overview
2. `/signals` signals/computed/effect/batch
3. `/lists` `For`/`Show`/`Switch`/`Match`
4. `/forms` `useForm` + `ErrorMessage`
5. `/data` `useSWR` + `mutate` + `invalidateQueries`
6. `/store` `createStore` + `derived`
7. `/focus` `useFocus` + `useFocusTrap` modal flow
8. `/html` HTML/SVG update path

Smoke script added: `scripts/smoke.mjs` (`npm run smoke`).

## Final Validation Status

- `npm run build`: passes.
- `npm run smoke`: passes route and interaction checks.
- No console/page errors in final smoke run.

Observed smoke outputs:

- Signals incremented from `Count: 0` to `Count: 2`.
- Lists added items successfully.
- Data page optimistic row append worked.
- Store page add/filter worked.
- Focus modal opened and closed via Escape.
- HTML page text and SVG node updates applied.

## Confirmed Issues Found

## P0 - Compiler-first scaffold path is broken out-of-the-box

### Symptom
`create-what@0.4.2` scaffolds with `what-compiler/vite`, but dynamic JSX path fails.

### What was observed

1. Build failures like:
   - `"effect" is not exported by "what-framework/render"`
2. Even after alias-shimming exports, runtime rendered `<undefined>` elements because fine-grained compiler output returns DOM nodes that current mount/reconciler path does not consume as component return values.

### Impact
- New users scaffold, then hit build/runtime failures on normal dynamic JSX patterns.
- This is a release-blocking DX issue.

## P1 - `useFocusRestore` missing from published package exports

### Symptom
Import fails from npm package:

- `"useFocusRestore" is not exported by "what-framework"`

### Impact
- Docs/expectations drift from published npm surface.
- Accessibility guidance cannot be followed as documented.

## P1 - `FocusTrap` component can crash at activation

### Symptom
`FocusTrap` path throws:

- `container.querySelectorAll is not a function`

### Likely cause
Activation can run before ref is attached; `containerRef.current` is null and fallback object is passed to selector logic.

### Impact
- Modal accessibility flow can crash under common open-on-click behavior.

## P1 - `useForm` instance stability pitfall

### Symptom
If `useForm(...)` is called directly in a rerendering component, internal state can reset due new instance creation on rerender.

### Observed consequence
- Submit counters and behavior were unstable until form creation was memoized.

### Workaround used
- `useMemo(() => useForm(...), [])`

### Impact
- This is non-obvious and easy to get wrong.
- API looks hook-like but is not stable by default.

## P1 - `ErrorMessage` did not render from `formState.errors` after invalid submit in this flow

### Symptom
After empty submit:

- `formState.errors` panel showed required-field errors.
- `<ErrorMessage ... formState={formState} />` placeholders stayed empty.

### Impact
- Built-in helper appears unreliable for common invalid-submit case.
- Developers must implement manual error rendering to be safe.

## P2 - Routing docs/API familiarity gap (`Link` prop naming)

### Symptom
In practice, router links in this package flow use `href`; teams coming from React-router style `to` will fail silently unless docs are explicit.

### Impact
- Small but common migration friction.

## Additional DX Friction Notes

- `useEffect` without deps reruns every render; when coupled with signal writes this can create loops quickly.
- Signals read in deps arrays are often required for predictable rerun behavior in this runtime model.
- `what-compiler` remains in scaffold dependencies even though this example had to switch to JSX runtime path to stay stable.

## Workarounds Applied in This Example

1. Switched to Vite `esbuild` JSX runtime config (`jsxImportSource: "what-framework"`) instead of `what-compiler/vite` plugin.
2. Replaced file-router virtual routes with explicit `src/routes.js`.
3. Memoized `useForm` instance with `useMemo(..., [])`.
4. Used `useFocusTrap` hook directly with guarded activation timing instead of `FocusTrap` component.
5. Used ref + effect-driven HTML/SVG updates on the HTML page (and documented compiler-path limitations encountered during setup).

## Recommended Framework-Level Fix Order

1. **Fix compiler/runtime contract (P0)**
   - Ensure compiler output and runtime mount model are aligned.
   - Ensure `what-framework/render` exports exactly what compiler-generated code imports.
2. **Update `create-what` scaffold defaults (P0)**
   - Do not scaffold to a broken default path.
3. **Publish export parity fixes (P1)**
   - Add missing exports like `useFocusRestore` to npm release if intended public API.
4. **Harden `FocusTrap` lifecycle (P1)**
   - Guard activation until concrete element ref exists.
5. **Stabilize `useForm` ergonomics (P1)**
   - Make form instance stable by default in component usage.
6. **Fix `ErrorMessage` reactivity behavior (P1)**
   - Ensure it renders reliably when errors are introduced after first render.
7. **Add npm consumer CI scenario (P1)**
   - `npx create-what`, add dynamic JSX page, run `build` + smoke.

## Repro Commands Used

```bash
cd examples
npx -y create-what@0.4.2 npm-eight-pages-review
cd npm-eight-pages-review
npm install
npm run build
npm run dev
npm run smoke
```
