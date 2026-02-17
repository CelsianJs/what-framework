# Pulse Board — What Framework Starter

A real-time task board SPA built with What Framework.

## What This Shows

- **Signals** — `signal()`, `computed()`, `batch()` for state management
- **Components** — Functional components with `h()` hyperscript
- **Reactivity** — Fine-grained DOM updates, no virtual DOM diffing
- **Data Fetching** — REST API integration with offline fallback
- **Router** — `what-framework/router` navigation patterns

## Quick Start

```bash
# Frontend example app
npm install
npm run dev
# → http://localhost:3001
```

## Architecture

```
What Framework (Frontend)
┌─────────────────────┐
│ signal() state      │
│ computed() derived  │
│ h() components      │
│ mount() render      │
└─────────────────────┘
```
