# Pulse Board — What Framework Starter

A real-time task board SPA built with What Framework. Connects to the CelsianJS Pulse backend for live updates.

## What This Shows

- **Signals** — `signal()`, `computed()`, `batch()` for state management
- **Components** — Functional components with `h()` hyperscript
- **Reactivity** — Fine-grained DOM updates, no virtual DOM diffing
- **Data Fetching** — REST API integration with fallback offline mode
- **SSE** — EventSource for real-time live updates from CelsianJS backend

## Quick Start

```bash
# Just the frontend (works offline with demo data)
pnpm install
pnpm dev
# → http://localhost:3001

# Full stack (with CelsianJS Pulse backend)
# In another terminal:
cd ../../celsian/examples/showcase
pnpm dev
# → http://localhost:4000
```

## Architecture

```
What Framework (Frontend)          CelsianJS (Backend)
┌─────────────────────┐          ┌─────────────────────┐
│  signal() state     │ ◀──SSE── │  SSE Hub broadcast  │
│  computed() derived │          │  REST API routes    │
│  h() components     │ ──REST─▶ │  RPC procedures     │
│  mount() render     │          │  Task Queue + Cron  │
└─────────────────────┘          └─────────────────────┘
```
