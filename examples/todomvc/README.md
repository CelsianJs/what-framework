# TodoMVC — What Framework

The classic TodoMVC implementation built with What Framework and JSX.

## Features

- Add, toggle, edit, and delete todos
- Filter by all / active / completed (hash routing)
- Toggle all complete
- Clear completed
- Follows the official TodoMVC specification

## Getting Started

```bash
npm install
npm run dev
# Open http://localhost:5173
```

To build for production:

```bash
npm run build
npm run preview
```

## Project Structure

```
todomvc/
  index.html          Entry HTML
  todomvc.css         Standard TodoMVC stylesheet
  vite.config.js      Vite + what-compiler plugin
  package.json
  src/
    app.jsx           Main app component and mount
    store.js          Todo store with createStore + derived
    todo-item.jsx     Individual todo item with inline editing
    footer.jsx        Filter bar and counts
```

## Patterns Demonstrated

- **createStore** with `derived` for filtered todos and counts
- **useSignal** for local editing state
- **mapArray** for efficient list rendering
- **JSX** with reactive function children `{() => ...}`
