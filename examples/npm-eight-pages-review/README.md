# npm-eight-pages-review

8-page example app that consumes `what-framework` directly from npm (no workspace linking).

## Setup

```bash
npm install
npm run dev
npm run smoke
```

## Routes

- `/` home
- `/signals`
- `/lists`
- `/forms`
- `/data`
- `/store`
- `/focus`
- `/html`

## Stack

- `what-framework@0.4.2`
- `what-compiler@0.4.2`
- `vite`

## JSX Runtime Mode

This project uses Vite `esbuild` JSX runtime with `jsxImportSource: "what-framework"` for stability while reviewing npm consumer DX.
It intentionally avoids `what-compiler/vite` in this sample because that path produced blocker-level issues in this review cycle.

## Purpose

This app is used to review DX from the perspective of a fresh npm consumer and to capture confusion/bugs in `REVIEW.md`.
