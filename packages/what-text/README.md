# what-text

Optional text engine for [What Framework](https://whatfw.com), powered by [@chenglou/pretext](https://www.npmjs.com/package/@chenglou/pretext). Provides text measurement/layout utilities and alpha text-rendering components (`TextFlow`, `TextCanvas`, `TextSVG`).

This package is **optional and off by default** — nothing here runs unless you opt in, and `@chenglou/pretext` is an optional peer dependency that is lazy-loaded on first use.

## Install

```bash
npm install what-text @chenglou/pretext
```

`@chenglou/pretext` is an optional peer: APIs that need it (`measureText`, the components, `configureText({ measure: true })`) lazy-load it via dynamic `import()` and throw a clear "install it with: npm install @chenglou/pretext" error if it's missing.

## Text measurement

```js
import { measureText, configureText } from 'what-text';

// One-off measurement: layout a string at a given font/width/line-height.
// Waits for document.fonts.ready, lazy-loads Pretext, caches prepared text (LRU).
const layout = await measureText(
  'The quick brown fox jumps over the lazy dog',
  '16px Inter, sans-serif',
  400,   // container width in px
  24     // line height in px
);
// layout.lines -> per-line layout from Pretext

// Opt into automatic measurement of text inserted by what-core's renderer.
// Registers a hook with what-core; skipped during hydration; off by default.
configureText({ measure: true, cacheSize: 1000 });
```

- Measurements are cached in an LRU keyed on `font|text` (`cacheSize` entries, default 1000).
- The cache is cleared automatically when new fonts finish loading (`document.fonts` `loadingdone`).
- `configureText({ measure: false })` unregisters the hook again.

## Components (alpha)

> All three components are `@alpha` — APIs may change without a major version bump. `TextCanvas` and `TextSVG` have no text selection or accessibility story yet.

```jsx
import { TextFlow, TextCanvas, TextSVG } from 'what-text';

// Magazine-style multi-column flow. Works WITHOUT Pretext (falls back to CSS
// columns); the `around` shape-flow prop requires Pretext.
<TextFlow columns={3} gap="1.5rem">{() => article()}</TextFlow>

// Text rendered to <canvas> via Pretext layout (requires Pretext).
<TextCanvas width={600} height={200} font="16px Inter, sans-serif">
  {() => content()}
</TextCanvas>

// Text rendered as SVG <text>/<tspan> lines via Pretext layout (requires Pretext).
<TextSVG width={600} height={200} font="16px Inter, sans-serif">
  {() => content()}
</TextSVG>
```

Children may be a plain string or a reactive function — the components re-layout when signals they read change.

## API

| Export | Description |
|---|---|
| `configureText(opts)` | `{ measure: boolean, cacheSize: number }` — toggles the what-core text-insert measurement hook |
| `getTextConfig()` | Current config (copy) |
| `measureText(text, font, width, lineHeight)` | Async: font-ready gate → Pretext prepare (cached) → line layout |
| `clearMeasureCache()` | Drop all cached measurements |
| `ensurePretext()` | Lazy-load and return the `@chenglou/pretext` module |
| `TextFlow` | Multi-column text flow (`columns`, `gap`, `around`) — CSS-columns fallback without Pretext |
| `TextCanvas` | Canvas text rendering (`width`, `height`, `font`) — requires Pretext |
| `TextSVG` | SVG text rendering (`width`, `height`, `font`) — requires Pretext |

## Example

A live demo (reflow sliders, canvas/SVG tabs) lives in [`example/`](./example) — `npm install && npm run dev` inside that directory.

## Links

- [Documentation](https://whatfw.com)
- [GitHub](https://github.com/CelsianJs/what-framework)

## License

MIT
