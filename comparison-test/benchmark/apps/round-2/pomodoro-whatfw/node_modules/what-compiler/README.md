# what-compiler

JSX compiler for [What Framework](https://whatfw.com). Transforms JSX into optimized DOM operations via a Babel plugin, with a Vite plugin for seamless integration. Also provides file-based routing via `virtual:what-routes`.

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
})
```

## Babel Plugin

Use the Babel plugin directly for custom build setups:

```js
// babel.config.js
export default {
  plugins: [
    ['what-compiler/babel', { production: false }],
  ],
};
```

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
