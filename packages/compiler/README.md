# what-compiler

JSX compiler for [What Framework](https://whatfw.com). Transforms JSX into optimized DOM operations for the browser, and into string templates for the server, via a Babel plugin, with a Vite plugin for seamless integration. Also provides file-based routing via `virtual:what-routes`.

## Install

```bash
npm install what-compiler --save-dev
```

## Vite Plugin

The recommended way to use the compiler. Add it to your Vite config:

```js
// vite.config.js
import { defineConfig } from 'vite';
import what from 'what-compiler/vite';

export default defineConfig({
  plugins: [what()],
});
```

### Options

```js
what({
  include: /\.[jt]sx$/,       // File extensions to process (default: .jsx/.tsx)
  exclude: /node_modules/,    // Files to exclude (default: node_modules)
  sourceMaps: true,           // Enable source maps (default: true)
  production: false,          // Enable production optimizations (default: auto)
  pages: 'src/pages',         // Pages directory for file-based routing
  autoSelector: true,         // Rewrite selected() === row.id in keyed rows to a selector (default: true)
  ssr: true,                  // Compile server transforms with the server target (default: true)
  ssrGuard: true,             // false: compile every server transform for the DOM, whatever ssr says (default: true)
  hydratable: 'auto',         // Client output that hydrate() adopts server markup with (default: 'auto')
})
```

### Hydration

`hydrate()` adopts server-rendered markup when the client is compiled with the
`hydratable` option: templates claim the server's nodes in document order
instead of cloning new ones, components keep the server's owner paths, and
keyed lists adopt their rows. The same output still mounts with `mount()`. The
Vite plugin's `'auto'` turns it on when the config says the app renders on the
server (`appType: 'custom'`, `build.ssr` or `build.ssrManifest`) and leaves a
client-only project on plain output; pass `true` or `false` to decide. With the
Babel plugin, pass `hydratable: true` (off by default). Client output built
without it renders the page again under `hydrate()` and reports one
`ERR_HYDRATION_MISMATCH` of kind `not-hydratable`.

### Keyed lists

`items().map((item) => <li key={item.id}>…</li>)` is lowered to keyed rows. A
row keeps its DOM and state for as long as its key is in the list, and a row
that reads its item for more than its key reads it through the row's item cell,
so a new object under the same key (an immutable update, a refetch) shows in
place; a row that hands the item to a component, which takes its props once,
is built again from the new item.

### Moved imports

Every script module the plugin transforms (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`,
`.tsx`, ... outside `exclude`) is checked for names the root entry
(`what-framework`, `what-core`) no longer exports, in imports and re-exports
alike. One fails the build, and the dev server's transform, with
`ERR_MOVED_IMPORT` at the first such name's `path:line:column`, listing each
name with where it went or what replaces it: the answer
[UPGRADING.md](../what/UPGRADING.md) and eslint-plugin-what's
`no-moved-imports` rule give, which `eslint --fix` applies. Type-only imports,
subpath imports and import statements quoted in a string are left alone. It
has no option: the bundler would fail on the same import, with only "is not
exported".

### Server builds

Modules Vite transforms for the server (`vite build --ssr`, SSR in the dev
server, the `ssr` environment) are compiled with the server target: string
templates that every what-server renderer accepts (`renderToString`,
`renderToHydratableString`, `renderToStream`, `renderDocument`, ...), so the
same components render on both sides. `ssr: false` compiles server transforms
as client output and refuses one that would build DOM with
`ERR_COMPILED_JSX_IN_SSR`; `ssrGuard: false` compiles every server transform
for the DOM, with or without `ssr: false`, for a test runner that applies SSR
transforms in a process with a DOM.

Compiled server JSX means what the same JSX means as `h()` calls: a plain hole
(`{label}`, `id={props.id}`) is read when the JSX expression runs, a reactive one
(`{count()}`, `title={t()}`) is rendered where the markup is placed, and a hole
that throws or suspends is handled as `h()` handles it, in every renderer. A
string is always escaped, including one a `.map()` or `<For>` row returns; only
compiled markup is written as HTML. The text of `<script>` and `<style>` is
written as it is, with the sequences that could end the element encoded.

The dev server's output carries component, signal and binding names with their source
locations (`"Row@src/App.jsx:12:5"`) for devtools; production builds do not.

## Babel Plugin

Use the Babel plugin directly for custom build setups:

```js
// babel.config.js
export default {
  parserOpts: { plugins: ['jsx'] },
  plugins: [
    ['what-compiler/babel', { production: false }],
  ],
};
```

| Option | Default | |
|---|---|---|
| `generate` | `'dom'` | `'dom'`: cloned templates and fine-grained bindings. `'ssr'`: server string templates, imported from `what-framework/ssr-runtime`. |
| `production` | `false` | No development warnings or metadata. |
| `devMetadata` | `false` | Development only: names and `path:line:column` locations for components, What's `signal`/`effect`, and bindings. Format in `babel.d.ts`. |
| `projectRoot` | Babel's cwd | Root that locations and server action ids are relative to. |
| `autoSelector` | `true` | DOM target: `selected() === row.id` in keyed rows becomes a `createSelector` lookup. |
| `onActionId` | none | Called with every server action id. |

Both targets reject markup the HTML parser would restructure (a `<div>` in a
`<p>`, a row directly in a `<table>`, ...) with `ERR_INVALID_HTML_NESTING` at
`path:line:column`; the server target also checks the JSX it writes into its
parent's markup (`<p>{ok && <div/>}</p>`, the rows of
`<table>{rows.map(r => <tr/>)}</table>`). Both targets reject static values the
runtime refuses on every path (a `javascript:`, `vbscript:` or `data:` URL,
`srcdoc`, `outerHTML`, a string `innerHTML`, `<script>`/`<style>` text that could
end the element, a namespaced tag such as `<svg:rect>`) with
`ERR_UNSAFE_STATIC_MARKUP`, and JSX as an island prop with
`ERR_JSX_ISLAND_PROP`, since island props are serialized to JSON.

## File-Based Routing

The compiler scans a pages directory and generates a virtual routes module.

```
src/pages/
  index.jsx        -> /
  about.jsx        -> /about
  blog/
    index.jsx      -> /blog
    [slug].jsx     -> /blog/:slug
  [...all].jsx     -> /*
```

Import the generated routes in your app:

```jsx
import { routes } from 'virtual:what-routes';
import { FileRouter } from 'what-router';
import { mount } from 'what-framework';

mount(<FileRouter routes={routes} />, '#app');
```

## Sub-path Exports

| Path | Contents |
|---|---|
| `what-compiler` | All exports |
| `what-compiler/vite` | Vite plugin |
| `what-compiler/babel` | Babel plugin |
| `what-compiler/runtime` | Compiler runtime helpers |
| `what-compiler/file-router` | `scanPages`, `extractPageConfig`, `generateRoutesModule` |

## API

| Export | Description |
|---|---|
| `vitePlugin(options?)` | Vite plugin for JSX transform and file routing |
| `what(options?)` | Named alias for the Vite plugin |
| `babelPlugin` | Babel plugin for JSX transformation |
| `scanPages(dir)` | Scan a directory for page files |
| `extractPageConfig(file)` | Extract page configuration from a file |
| `generateRoutesModule(pagesDir, rootDir)` | Generate a routes module string |

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
