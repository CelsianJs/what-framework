# Framework bundle size benchmark

From the repository root, after installing the workspace dependencies:

```sh
npm --prefix benchmark/size ci
npm --prefix benchmark/size run measure
```

The second command builds the hello and keyed todo apps for What, Solid 1, Solid 2 and React, validates them in headless Chromium, then writes [RESULTS.md](RESULTS.md) and [results.json](results.json). Install the browser with `npx playwright install chromium` from the repository root if it is missing. The measurement command also reads and tests any existing apps under `benchmark/krausest/dist/`. When the sibling dependencies and sources are available, the runner can recover What and Solid 2 module attribution by matching JS hashes against a rebuild in its own output directory.

Both Solid versions live in the isolated lockfile. The 1.x compiler preset declares an optional peer on the package name `solid-js`. The local npm configuration allows the 1.x runtime to use an npm alias while 2.x keeps the canonical name. Vite redirects 1.x compiler-generated imports for the 1.x builds, and the measurement asserts both versions’ emitted runtime paths.

What uses the workspace compiler and the working-tree core source. Hidden sourcemaps support attribution and are excluded from measured bytes.

## What is in a size-gate bundle

`node benchmark/size/why.mjs <scenario>` lists what one of `npm run check:size`'s scenarios bundles, declaration by declaration, with gzip estimates and the declarations that keep each one (or "runs at module scope" for a side effect a bundler cannot drop). It builds the scenario as check-size does, from `packages/*/src`: the core apps through what-compiler/vite, `react-counter` through what-react's `reactCompat()` alone, and the mixed apps through both (`mixed-recharts` attributes only the chunk that holds what-core and what-react). `--json out.json` writes the rows, `--text` the readable bundle, `--min 40` hides small rows.
