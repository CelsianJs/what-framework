# Pulse Board — What Framework Starter

A real-time task board SPA built with What Framework and JSX.

## What This Shows

- **Signals** — `useSignal()`, `useComputed()`, `batch()` for state management
- **Components** — Functional components with JSX
- **Reactivity** — Fine-grained DOM updates, no virtual DOM diffing
- **Data Fetching** — REST API integration with offline fallback
- **Vite** — Fast development with the `what-compiler` Vite plugin

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

## Architecture

```
What Framework (Frontend)
┌─────────────────────────┐
│ useSignal() state       │
│ useComputed() derived   │
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
