# What Framework — Text Engine (Pretext Integration)

> **Status: alpha.** The text engine API is stable for the measure-only path. TextCanvas, TextSVG, and TextFlow are experimental. Breaking changes may occur before v1.0.

The text engine is an optional layer that lets What Framework use `@chenglou/pretext` for precise text measurement and layout. Without Pretext installed, everything works as normal — measurement is just skipped.

---

## Installation

`@chenglou/pretext` is an **optional peer dependency**. Install it only if you need measurement:

```bash
npm install @chenglou/pretext
```

If Pretext is not installed, all text engine features degrade gracefully: static text renders normally, and dynamic text updates as usual. The only thing missing is computed layout data.

---

## Measure-Only Mode

The simplest integration path. Enable it before calling `mount()`:

```js
import { configureText } from 'what-framework';
import { mount, h } from 'what-framework';
import App from './App.js';

configureText({ measure: true });   // must be called before mount()
mount(h(App, {}), '#app');
```

**What it does:** when `insert()` places a text node, the engine queues a microtask to call `pretext.prepare()` and `pretext.layout()` on that text. Results are cached (LRU, 1000 entries by default). This warms the cache for any component that subsequently needs layout data.

**When it helps:**
- You have `TextFlow` or custom layout components that need text dimensions on first render.
- You want to avoid layout jank caused by on-demand measurement in scroll handlers or resize observers.

**When it is a no-op:**
- During server-side rendering (SSR) — measurement is skipped automatically.
- During hydration — the server already wrote the text nodes; the engine skips re-measurement.
- When `@chenglou/pretext` is not installed — calls to `measureText()` will reject with a clear error.

**Configuring cache size:**

```js
configureText({ measure: true, cacheSize: 2000 });
```

The cache key is `font + text`. Eviction is LRU.

---

## TextFlow

Wraps text in a flow container where Pretext controls line breaking. Falls back to normal block layout if Pretext is unavailable.

```js
import { TextFlow } from 'what-framework/text';

function Article() {
  return h(TextFlow, { columns: 2, width: 640 },
    'Long article body that Pretext will reflow into two columns...'
  );
}
```

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `columns` | number | `1` | Number of text columns |
| `around` | Element\|null | `null` | DOM element to flow text around (float-like) |
| `width` | number\|string | `'100%'` | Container width passed to `pretext.layout()` |

**Fallback:** if Pretext is not loaded at component creation time, TextFlow renders as a plain `<div>` with the children inserted normally. Text reflows with standard CSS.

---

## TextCanvas

Renders text into a `<canvas>` element using Pretext layout data. Useful for pixel-perfect rendering or non-standard typography.

```js
import { TextCanvas } from 'what-framework/text';

function Badge({ label }) {
  return h(TextCanvas, { width: 200, height: 40, font: '700 14px Inter' }, label);
}
```

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `width` | number | `300` | Canvas width in CSS pixels |
| `height` | number | `150` | Canvas height in CSS pixels |
| `font` | string | `'16px sans-serif'` | Canvas `ctx.font` string |

**Requires Pretext.** If Pretext is not installed, the component renders an empty `<canvas>` and logs a warning.

**Limitations:**
- No text selection.
- Not accessible to screen readers — add an `aria-label` on a wrapper element.
- `canvas.measureText()` may diverge from Pretext metrics on some platforms (see Known Issues).
- Client-only — cannot be server-rendered.

---

## TextSVG

Renders Pretext-laid-out text into an `<svg>` element. Useful for diagrams, data-viz labels, and print-quality output.

```js
import { TextSVG } from 'what-framework/text';

function ChartLabel({ text, x, y }) {
  return h(TextSVG, { width: 120, height: 24, font: '12px monospace' }, text);
}
```

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `width` | number | `200` | SVG `viewBox` width |
| `height` | number | `40` | SVG `viewBox` height |
| `font` | string | `'16px sans-serif'` | Font used for `<text>` elements |

**Requires Pretext.** Degrades to an empty `<svg>` with a warning if Pretext is not installed.

**Limitations:**
- No native selection or accessibility (add `<title>` children for screen readers).
- Line breaks are rendered as individual `<text>` elements — copy-paste produces separate lines.
- Client-only.

---

## Rollback

To remove the text engine integration entirely:

1. Uninstall the package: `npm uninstall @chenglou/pretext`
2. Remove any `configureText(...)` calls from your app entry point.
3. Replace `TextFlow`, `TextCanvas`, or `TextSVG` components with standard HTML equivalents.

No other changes are required. The framework core does not depend on Pretext at runtime.

---

## Known Issues

**Canvas `measureText()` divergence.** Browser `CanvasRenderingContext2D.measureText()` uses the OS font rasterizer, which may differ from Pretext's own shaping engine. On Windows with ClearType, character advances can be off by 1–2px for certain typefaces. Use Pretext metrics (from `measureText()`) as the source of truth, not canvas metrics.

**Font loading delay.** Measurement runs after `document.fonts.ready` resolves, but late-loading fonts (e.g., downloaded via `@font-face` after initial render) may trigger a second measurement pass. The engine clears the cache on `loadingdone` automatically, but components that cached a layout before the font arrived will not re-render — call `clearMeasureCache()` and trigger a signal update if you need a forced refresh.

**Alpha components are client-only.** `TextCanvas` and `TextSVG` cannot be server-rendered. Wrap them in a client-only guard or use `onMount` to avoid SSR mismatches.
