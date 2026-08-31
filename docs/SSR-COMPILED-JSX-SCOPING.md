# Server-rendering what-compiler output: scope, seams, and a staged plan

Status: investigation complete, first slice landed, main work not started.
Measured against `origin/main` at `27030cf`.

This document exists because the headline framing of the problem was wrong in a
way that changes what should be built. Everything below labelled "measured" was
produced by running code, not by reading it.

## 1. What is actually broken

**Not this:** "a JSX component cannot be server-rendered."

**This:** "a component compiled by *what-compiler* cannot be server-rendered."

The distinction is the whole scoping decision. What lowers JSX matters:

| Toolchain | Lowers `<div/>` to | Server-renders? |
| --- | --- | --- |
| `h()` by hand | `h('div', ...)` | Yes |
| Automatic JSX runtime (`jsxImportSource: "what-framework"`) | `jsx('div', ...)` then `h('div', ...)` | **Yes** |
| what-compiler (fine-grained) | module-scope `_$template()` plus a `cloneNode` | No |

Measured, in a Node process with **no DOM at all**, using esbuild's automatic
JSX transform against `packages/core/src/jsx-runtime.js`:

```
typeof document = undefined

renderToString(h(App, { title: 'Hi', items: [1,2] }))
  -> <div class="app"><h1>Hi</h1><ul><li class="row">1</li><li class="row">2</li></ul></div>

renderToHydratableString(...)
  -> <div data-hk="h0" class="app"><h1>Hi</h1><ul><li data-hk="h1" ...
```

So ordinary JSX already server-renders, hydration markers and all. What does not
work is the *fine-grained* compiled output, and the honest statement of the gap
is therefore:

> You can have what-compiler's fine-grained output, or you can have SSR. Not
> both, in the same module.

That is still a real and significant limitation. It is not the limitation the
issue title implied, and it is a much better-defined one.

## 2. Where exactly it fails, in order

Measured with the real compiler:

```js
// what-compiler output for: function App() { return <div class="app"><h1>Title</h1></div>; }
import { _$template } from "what-framework/render";
const _tmpl$0 = /* @__PURE__ */ _$template("<div class=\"app\"><h1>Title</h1></div>");
export function App() { return _tmpl$0(); }
```

**Failure 1, import time.** The `_$template(...)` call is hoisted to *module
scope*, and `_$templateImpl` (`packages/core/src/render.js`) calls
`document.createElement('template')` eagerly, with no `typeof document` guard
anywhere in that file. Measured on a bare Node import:

```
IMPORT THREW: ReferenceError document is not defined
```

This happens before any render function is reached, and the stack points into
what-core rather than at the developer's file. `renderToString` is therefore
**not** the seam it appears to be: on a real server the module never loads.

**Failure 2, render time, only where a DOM exists.** With jsdom installed (a
test, or a shim someone added), `App()` returns an `HTMLDivElement`. Every
renderer destructures `vnode.tag` off it, gets `undefined`, and before this PR
reported:

```
renderToString(h(AppCompiled)) THREW: [what-server] Invalid tag name in SSR: undefined
renderToString(h(AppH))        = "<div class=\"app\"><h1>Title</h1></div>"
```

`ERR_INVALID_SSR_TAG`'s own documentation blames "a component that returned a raw
object, or a value interpolated where an element was expected". Neither is what
happened.

**Failure 3, silent.** Every render path in `packages/server/src/index.js`
degrades rather than returning a 500, which is correct for a runtime error and
wrong for a configuration error. Measured on `origin/main`:

```
renderToString(h('main', null, () => CompiledComponent()))        -> "<main></main>"
renderToHydratableString(h('main', null, () => Compiled()))       -> "<main><!--$--><!--/$--></main>"
renderToStream(h('main', null, h(Compiled, {})))                  -> "<main><!-- SSR Error: ... --></main>"
```

The component vanished from the page. The accompanying `console.warn` is gated on
dev mode, so in production nothing was logged and the server reported success on
a page with a hole in it. The differential fuzzer measures the width of this:
**250 of 500 generated tree-routes** silently rendered `<main></main>`.

Failure 3 is the one that mattered most, and it was not in the original problem
statement.

## 3. Why there is no cheap way to make it work

Three independent pieces are missing. Only the third makes the first two useful.

### Half A: a string-emitting server backend for the compiler

`packages/compiler/src/babel-plugin.js` (3655 lines) has exactly three options,
verified by enumerating every `state.opts` read: `onActionId`, `production`,
`projectRoot`. None switches codegen shape. There is no `ssr`, `hydratable`,
`target` or `generate` option, and no second backend to reach.

The existing element codegen (`extractStaticHTML`, `applyDynamicAttrs`,
`applyDynamicChildren`, roughly 800 lines) is DOM-imperative throughout: it
addresses positions with `_el$0.firstChild.nextSibling` chains computed at compile
time. A string backend cannot reuse any of that. It must re-derive, in codegen
form, everything `what-server`'s `renderAttrs` does at runtime: attribute
precedence across interleaved spreads (the subject of bugs #69 and #74), HTML
escaping, void elements, SVG namespacing, table wrapping, and the aria/data
enumerated-`false` rules.

There is one adjacent shortcut and it is a trap. `transformElementAsH` already
emits `h()` calls, and `h()` trees server-render perfectly. But it is a degraded
emergency path used only when template extraction fails, it emits a
`console.warn` when it runs, and it **silently drops every spread attribute**
(`if (t.isJSXSpreadAttribute(attr)) continue;`). Promoting it to a supported SSR
backend without first making it correct would ship exactly the
silently-wrong-output failure this work is meant to eliminate.

### Half B: a hydration-aware client template path

This is the half that is easy to forget and impossible to skip.

Suppose Half A lands and the server emits correct markup. The **client** module is
still compiled fine-grained, so the component body still returns a `cloneNode`.
`hydrateNode` sees already-built DOM, warns, and lets `trimUnclaimed` delete
everything the server sent. The result is correct markup that is thrown away on
every load: better than a crash, still not hydration.

Making it real means, at minimum:

- `_$template()` becomes claim-or-clone under hydration (Solid's
  `_$getNextElement`), so the compiled body walks the *server's* nodes.
- `_$insert` adopts the text or nodes already between the markers rather than
  inserting new ones.
- The `<!--$-->` markers the compiler bakes into the template string must appear
  in the server's HTML at the same positions, or the compile-time
  `firstChild.nextSibling` chains land on the wrong nodes. This is the constraint
  that couples Half A and Half B: the server backend cannot be designed
  independently of the client walk.
- Attribute effects re-run on hydrate and overwrite the server's values. Correct,
  but wasteful, and worth a pass.

PR #72 established the one precedent here: `_$componentVNode` is
`_$createComponent` stopping short of `createDOM`, and `hydrateNode` already
accepts that shape. It applies to the **argument of a `hydrate()` call** only.
There is no equivalent unbuilt shape for an element body, because a host element
lowers to a template clone and "unbuilt" is not a property children inherit.

### Half C: a server build that the target could apply to

There is nothing to target today.

- `packages/compiler/src/vite-plugin.js` had **zero** SSR awareness before this
  PR. It never read Vite's `ssr` flag or `this.environment`.
- The full-stack scaffold in `packages/create-what/index.js` is deliberately
  **buildless**: "Full-stack apps are buildless: server.js does SSR + ISR, so
  there is no Vite/compiler toolchain." Its devDependencies deliberately omit
  `what-compiler` and `vite`.
- The CLI's SSG command collects `.js` only, so `.jsx` pages are never even
  gathered.
- No app in this repo (smoke apps, examples) runs the compiler in an SSR graph.
  The SSR-using smoke apps are authored with `h()`.

So "compile the server bundle differently" presupposes a server bundle that the
framework does not currently produce or scaffold.

### Verdict

Each half is a PR or more. Half B is the largest and cannot be validated without
Half A. Half C is a product decision about what the framework's SSR story is,
not just an implementation. Attempting the three in one pass would produce
something that looks green and is wrong in the places nobody generated a test
for, which is the failure mode this repo has been bitten by repeatedly.

**This is a milestone, not a PR.** Forcing it green in one pass was declined.

## 4. What the first slice does (this PR)

It does not make compiled JSX server-render. It makes every way of hitting the
limitation loud, named, and accurate, and it removes the silent one.

1. **Build time, the earliest seam that exists.** `vite-plugin.js` refuses the
   transform when it is compiling for the SSR environment *and* the output
   builds DOM, throwing `ERR_COMPILED_JSX_IN_SSR` naming the file and both
   supported alternatives. The verdict is taken from the emitted code
   (`_$template` / `_$createComponent`), not from the file extension, so a
   JSX-free server-action module and a `hydrate()`-only module (which emits the
   unbuilt `_$componentVNode`) both still compile. `ssrGuard: false` opts out.
   Both `options.ssr` and `this.environment.name` are read, because Vite reports
   it differently by major.
2. **Render time.** `assertSafeTag` distinguishes a DOM node from a bad tag and
   raises `ERR_COMPILED_JSX_IN_SSR` instead of mislabelling it. A genuinely
   invalid tag still raises `ERR_INVALID_SSR_TAG`, which is security-relevant and
   must not be widened away.
3. **The silent path.** All eleven degrading catches on the render paths now
   rethrow this one code. A configuration error cannot be retried or fallen back
   from, so absorbing it only hides it.
4. **Docs.** `docs/ARCHITECTURE.md` showed `renderToHydratableString(<App />)`
   with no statement of which toolchain that `<App />` may come from. It is now
   stated. (The `docs-site` SSR and reference guides were already correct and
   explicit; this was the one place that was not.)

## 5. Recommended order for the real work

1. **Decide Half C first.** Is what-compiler supposed to be usable in a server
   build at all, or is the automatic JSX runtime the supported answer for server
   modules with what-compiler reserved for the client entry? This is a product
   call and it determines whether Halves A and B are worth building. If the
   answer is "automatic runtime is the answer", then the correct follow-up is
   documentation and a scaffold that wires both transforms, not a codegen target,
   and this whole milestone closes cheaply.
2. **If a target is wanted, build Half A and Half B together**, against the
   marker contract, not sequentially. Land it behind an explicit
   `hydratable: true` option so the default path is untouched.
3. **Do not start with the static-only slice.** "A compiled body with no dynamic
   children" is a rare shape in real code and it exercises none of the marker,
   insert, or attribute-precedence problems that make the target hard. It would
   pass quickly and teach nothing.
4. **Use the fuzzer as the oracle.** `packages/compiler/test/lowering-parity-fuzz.test.js`
   already generates one spec and emits it as both JSX and `h()`. Its SSR arm is
   shaped so that landing the target inverts it: replace "the compiled arm must
   refuse" with "the two strings must be equal". The spec and both emitters do
   not change.

## 6. Things found on the way that are not this problem

- **Component-scoped hooks during SSR are fixed.** `smoke/apps/scrollytelling/smoke.config.mjs`
  documents (as of 0.12.2) that `useState`, `useRef`, `useEffect`, `useMemo`,
  `onMount` and `onCleanup` all throw during SSR. Re-measured on `27030cf`: all
  seven tested hooks render fine. That note is stale and its workarounds are no
  longer required.
- **`renderToStream` swallows every component error**, not only this one, and in
  production emits a bare `<!-- SSR Error -->` with no detail. That is a
  deliberate degrade, but it is worth asking whether a page should ship with a
  silent hole in it and a 200 status.
