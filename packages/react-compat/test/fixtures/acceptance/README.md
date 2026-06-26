# what-react browser acceptance fixture

A minimal Vite app that runs the verified React libraries on what-react's
compat runtime through the **`reactCompat()` vite plugin** (the documented
one-line setup), using LOCAL packages (`file:` deps to this repo's
`packages/react-compat` and `packages/core`).

This is the browser-dependent half of the compat verification. The CI half
lives in `packages/react-compat/test/runtime.test.js` (hook/render semantics,
jsdom) and `packages/react-compat/test/libs.test.js` (the same libraries in
jsdom), which run under `node --test` via the repo's `npm test`.

## Run

```bash
npm install          # isolated install — NOT part of the npm workspace
npm run dev          # http://localhost:4600
# production build path:
npm run build && npm run preview   # http://localhost:4601
```

Ports 4600/4601 (Track B's assigned range).

## Manual checklist (what was verified 2026-06-09, dev AND prod build)

| Section | Action | Expected |
|---|---|---|
| 1. Context | click `toggle theme` | `#ctx-value` flips `light` ⇄ `dark` (provider → deep child) |
| 2. zustand | click `increment` | `#z-count` +1 and `#z-doubled` is exactly 2× (values, not functions) |
| 3. react-query | load page | `loading…` then `Ada Lovelace (engineer)` in `#q-data` |
| 4. react-hook-form | submit empty | `#f-error` shows "Email is required"; input receives focus |
| | type `a@b.c`, submit | error clears, `#f-success` shows the value |
| 5. react-hot-toast | click `fire toast` | toast animates in bottom-right, auto-dismisses ~2s |
| 6. headlessui | click `Options` | menu opens (`role=menu`, `aria-expanded=true`); clicking an item updates `#m-picked` and closes the menu |
| 7. framer-motion | load / `move` / `toggle box` | box fades in; `move` animates `x` by 60px; toggle plays the exit animation then removes `#mo-box`, toggling back re-animates in |
| 9. recharts | load page | `#rc-area` shows a filled area chart and `#rc-line` shows a 2-line chart, both with labeled axes + dashed gridlines (SVG namespace, non-null getBBox) |

All sections expose stable element IDs so any browser automation tool
(Playwright etc.) can assert the same flows.
