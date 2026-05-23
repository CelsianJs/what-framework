# What Kanban

A multi-board kanban app built on [What Framework](https://github.com/CelsianJs/what-framework).

Demonstrates:

- `createStore` + `derived` for nested state (boards → columns → cards).
- HTML5 drag-and-drop with insert-before / insert-after / drop-at-end.
- `what-router` with `/` (board list) and `/board/:id` (board view).
- `localStorage` persistence with shape validation.
- Inline rename, double-click to edit, keyboard escape, optimistic updates.

## Run

```bash
cd examples/kanban
npm install
npm run dev
```

Open http://localhost:5173.

## Stress

Click **Seed 15 cards** to populate a board, then drag cards within and across columns to exercise the reactive cascade.
