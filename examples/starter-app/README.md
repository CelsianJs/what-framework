# Pulse Board — What Framework Starter

A real-time task board SPA built with What Framework and JSX.

## What This Shows

- **Signals** — module-scope `signal()`, `computed()`, `batch()` for state management
- **Components** — Functional components with JSX
- **Reactivity** — Fine-grained DOM updates, no virtual DOM diffing
- **Data Fetching** — REST + SSE integration with an offline fallback
- **Vite** — Fast development with the `what-compiler` Vite plugin

## Getting Started

```bash
npm install
npm run dev
# Open http://localhost:5173
```

The board runs offline on demo data by default. To connect it to a CelsianJS
Pulse backend (REST at `/api/tasks`, live updates over SSE at `/api/events`),
start the backend and point the app at it:

```bash
VITE_PULSE_API=http://localhost:4000 npm run dev
```

To build for production:

```bash
npm run build
npm run preview
```

## Architecture

```
What Framework (Frontend)
┌─────────────────────────┐
│ signal() state          │
│ computed() derived      │
│ JSX components          │
│ mount(<App />, '#app')  │
└─────────────────────────┘
```

## Project Structure

```
starter-app/
  index.html          Entry HTML
  vite.config.js      Vite + what-compiler plugin
  package.json
  src/
    app.jsx           Main application component
```
