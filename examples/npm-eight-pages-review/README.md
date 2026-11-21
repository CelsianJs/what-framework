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

- `what-framework`
- `what-compiler` (its Vite plugin compiles the JSX)
- `vite`

## Purpose

This app is used to review DX from the perspective of a fresh npm consumer and to capture confusion/bugs in `REVIEW.md`.
