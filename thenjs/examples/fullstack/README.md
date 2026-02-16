# Pulse Board — ThenJS Full-Stack Example

A complete full-stack task board built with ThenJS. Demonstrates every feature of the meta-framework: file-based routing, SSR, API routes, RPC, and background tasks.

## The Stack

- **What Framework** — frontend (signals, components, reactivity)
- **CelsianJS** — backend (server, RPC, caching, tasks)
- **ThenJS** — meta-framework (file routing, SSR, Vite, build)

## Quick Start

```bash
pnpm install
pnpm dev
# → http://localhost:3000
```

## File Structure

```
src/
├── pages/                  # File-based routing
│   ├── _layout.tsx         # Root layout (nav, styles)
│   ├── index.tsx           # Dashboard — hybrid SSR
│   ├── tasks.tsx           # Task board — client-rendered
│   └── about.tsx           # About page — static
├── api/                    # REST API routes
│   ├── health.ts           # GET /api/health
│   └── tasks.ts            # CRUD /api/tasks
├── rpc/                    # Type-safe RPC
│   └── index.ts            # /_rpc/* procedures
└── tasks/                  # Background tasks
    └── cleanup.ts          # Cron: every 5 minutes
```

## Rendering Modes

Each page declares its rendering strategy:

| Page | Mode | Description |
|------|------|-------------|
| `/` | `hybrid` | Server-rendered, client-hydrated |
| `/tasks` | `client` | Fully client-rendered SPA |
| `/about` | `static` | Pre-rendered at build time |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | Server health check |
| GET | /api/tasks | List all tasks |
| POST | /api/tasks | Create a task |
| PUT | /api/tasks/:id | Update a task |
| DELETE | /api/tasks/:id | Delete a task |

## RPC Procedures

```typescript
// Client usage (with full type inference):
import { rpc } from 'virtual:then-rpc-client';

const tasks = await rpc.tasks.list();
const stats = await rpc.tasks.stats();
const task = await rpc.tasks.create({ title: 'New task', priority: 'high' });
const health = await rpc.system.health();
```
