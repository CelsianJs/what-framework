# Task Manager — What Framework

A full-featured task management app built with What Framework and JSX.

## Features

- Add, edit, delete, and complete tasks
- Filter by status (all / active / completed)
- Light/dark theme toggle
- Spring animations on task completion
- localStorage persistence
- Double-click to edit task text

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
task-manager/
  index.html          Entry HTML with CSS variables
  vite.config.js      Vite + what-compiler plugin
  package.json
  src/
    app.jsx           Full application with store, components, and styles
```

## Patterns Demonstrated

- **createStore** with `derived` computeds for filtered/counted state
- **useSignal** for local component state
- **useEffect** for side effects (theme, focus management)
- **useRef** for DOM refs and spring animation instances
- **useMemo** for computed values with dependencies
- **cls()** utility for conditional class names
- **spring()** for physics-based animations
