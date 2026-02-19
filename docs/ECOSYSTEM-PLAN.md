# What Framework — Ecosystem Plan

> What does a frontend framework need to be taken seriously?
> What's the fastest path to get there?

## The Reality

React's ecosystem is massive because thousands of companies and OSS contributors built it over 10+ years. We're not going to replicate that. But we don't need to — we need to cover the **20% of libraries that 80% of projects actually use**.

Most real-world apps need: UI components, animation, forms, data fetching, routing, state management, and maybe a table/list component. We already have forms, routing, state, and data fetching built into core. The gaps are UI components, rich animation, and a handful of specialized widgets.

## The Three Strategies

Not every gap needs the same approach:

### Strategy 1: Adapt (cheapest)
Many popular "React libraries" are actually thin React wrappers around **framework-agnostic cores**. The core does all the work — the React package just provides hooks and components that wire into React's lifecycle. We write a What adapter for the same core. This is 100-200 lines of code per library, not a rewrite.

### Strategy 2: Wrap (moderate)
Some categories have excellent **vanilla JS / Web Component** libraries that work with any framework. We write a thin What-flavored wrapper that provides nice signal-based APIs and JSX components. The heavy lifting is already done.

### Strategy 3: Build (expensive but differentiating)
A few things are worth building from scratch because they can leverage What's fine-grained reactivity for genuinely better performance or DX than the React equivalent. These become selling points.

---

## The Gap Analysis

### TIER 1 — Must Have (blocks adoption)

#### 1. Headless UI Components
**What people reach for in React:** Radix UI, Headless UI, Ariakit
**Why it matters:** Accessible dropdowns, dialogs, popovers, tabs, accordions, tooltips. Every app needs these. Building them correctly (focus management, ARIA, keyboard nav) is hard. Nobody wants to do it from scratch.

**Strategy: Adapt — `@what/ui`**
- [Floating UI](https://floating-ui.com/) already has a framework-agnostic core (`@floating-ui/dom`). Their React package is just a `useFloating()` hook. We write `useFloating()` for What. Covers: tooltips, popovers, dropdowns, select menus.
- For the component abstractions (Dialog, Tabs, Accordion, etc.), we build a small headless library inspired by Radix's API design but using What signals internally. These are mostly state machines + ARIA attributes — not complex rendering.
- **Scope:** ~15 headless components. Each is 100-300 lines.
- **Key components:** Dialog, Popover, Dropdown Menu, Select, Tabs, Accordion, Tooltip, Toggle, Switch, Checkbox, Radio Group, Slider, Toast, Alert Dialog, Combobox

#### 2. Animation
**What people reach for in React:** Framer Motion, React Spring
**Why it matters:** Enter/exit animations, layout transitions, gesture-driven animation, spring physics. The `transition` CSS property only covers simple cases.

**Strategy: Wrap + Build — `@what/motion`**
- [Motion One](https://motion.dev/) is the vanilla JS successor to Framer Motion's engine, by the same author (Matt Perry). It works on DOM elements directly. We wrap it with What directives and lifecycle hooks.
- What already has `spring()` and `tween()` in core. Extend these into a cohesive animation API:
  - `<Presence>` component for enter/exit animations (needs to delay unmount until exit animation completes)
  - `animate()` directive for declarative animation on mount/update
  - `useSpring()` / `useTween()` that return signals
  - Layout animation via FLIP technique
- **This is a differentiator.** Fine-grained reactivity means we can animate individual signal-driven values without re-rendering entire component trees. React can't do this cleanly.

#### 3. Data Table / Virtualized List
**What people reach for in React:** TanStack Table, react-virtuoso, react-window
**Why it matters:** Any data-heavy app needs a table with sorting, filtering, pagination. Large lists need virtualization.

**Strategy: Adapt — `@what/table`**
- [TanStack Table](https://tanstack.com/table) has a framework-agnostic core (`@tanstack/table-core`). Their React adapter is ~150 lines. We write the What adapter.
- For virtualization: [TanStack Virtual](https://tanstack.com/virtual) also has a framework-agnostic core. Same deal.
- **This is a massive win for minimal effort.** TanStack Table is the best data table library in any ecosystem. We get it for ~200 lines of adapter code.

---

### TIER 2 — Important (expected by serious users)

#### 4. Rich Text Editor
**What people reach for in React:** TipTap, Slate, Lexical
**Why it matters:** Content-heavy apps need rich text editing.

**Strategy: Wrap — `@what/editor`**
- [TipTap](https://tiptap.dev/) is built on ProseMirror and already has a framework-agnostic core. Their React integration is just a wrapper. We write one for What.
- [Lexical](https://lexical.dev/) by Meta also has a vanilla JS core with React bindings on top.
- Pick one (TipTap is more popular), write the What adapter.

#### 5. Date Picker / Calendar
**What people reach for in React:** react-day-picker, react-datepicker
**Why it matters:** Date inputs are notoriously hard to build accessibly.

**Strategy: Build — part of `@what/ui`**
- Date pickers are mostly state machines + a grid of buttons. Build this as part of the headless UI set.
- Use `Intl.DateTimeFormat` for i18n (no dependencies).
- This is actually simpler to build than to wrap because React date pickers are deeply React-coupled.

#### 6. Toast / Notification System
**What people reach for in React:** react-hot-toast, sonner
**Why it matters:** Global notification management.

**Strategy: Build — part of `@what/ui` or standalone `@what/toast`**
- Toasts are a signal-based store + a portal'd UI. Dead simple in What:
  - `toast('message')` / `toast.success('done')` / `toast.error('fail')`
  - A `<Toaster />` component that renders from a signal-based queue
- ~200 lines total. Signals make this trivially reactive.

#### 7. Form Schema Validation (enhanced)
**What we have:** `useForm`, `simpleResolver`, built-in rules
**What people also want:** Zod integration, Yup integration

**Strategy: Build — `@what/form-resolvers`**
- Write resolvers that bridge Zod/Valibot/Yup schemas to What's `useForm`:
  - `zodResolver(schema)` → plug into `useForm({ resolver: zodResolver(mySchema) })`
- Each resolver is ~50 lines. The schema libraries are framework-agnostic.

---

### TIER 3 — Nice to Have (differentiators)

#### 8. Charts / Data Visualization
**What people reach for in React:** Recharts, Nivo, Victory
**Why it matters:** Dashboards need charts.

**Strategy: Wrap**
- [Chart.js](https://www.chartjs.org/) and [D3](https://d3js.org/) are vanilla JS. Write thin What wrappers:
  - `<Chart type="line" data={data()} />` component that syncs signal data to Chart.js
  - Or just recommend D3 directly (it operates on DOM, works perfectly with What)
- [Apache ECharts](https://echarts.apache.org/) is another option — massive feature set, vanilla JS.

#### 9. Drag and Drop
**What people reach for in React:** dnd-kit, react-beautiful-dnd
**Why it matters:** Kanban boards, sortable lists, file upload zones.

**Strategy: Wrap — `@what/dnd`**
- [dnd-kit](https://dndkit.com/) — unfortunately React-coupled.
- [SortableJS](https://sortablejs.github.io/Sortable/) — vanilla JS, works on DOM elements. We add a What directive/wrapper.
- Alternatively, the Drag and Drop Web API + a ~300 line What utility covers most cases.

#### 10. Internationalization (i18n)
**What people reach for in React:** react-i18next, next-intl
**Why it matters:** Multi-language apps.

**Strategy: Adapt**
- [i18next](https://www.i18next.com/) is framework-agnostic. Their React package is just hooks. We write What hooks:
  - `useTranslation()` that returns a signal-backed `t()` function
  - Reactive language switching via signals
- ~100 lines of adapter code.

#### 11. Authentication UI
**What people reach for in React:** Clerk, Auth.js, NextAuth
**Why it matters:** Login/signup flows.

**Strategy: This is a ThenJS concern, not What**
- Auth is a backend + frontend concern. ThenJS + CelsianJS should provide the server-side auth.
- The What-side is just forms + routing guards, which we already have.
- Could provide pre-built `<LoginForm />`, `<SignupForm />` components as part of a `@thenjs/auth` package.

---

## Priority Roadmap

### Phase 1 — Unblock adoption (highest leverage)
| Package | Strategy | Effort | Impact |
|---------|----------|--------|--------|
| `@what/ui` (headless components) | Build | Large (but modular) | Critical |
| `@what/table` (TanStack adapter) | Adapt | Small (~200 LOC) | High |
| `@what/motion` (animation) | Wrap + Build | Medium | High |
| `@what/toast` | Build | Tiny (~200 LOC) | Medium |

### Phase 2 — Credibility
| Package | Strategy | Effort | Impact |
|---------|----------|--------|--------|
| `@what/editor` (TipTap adapter) | Wrap | Small | Medium |
| `@what/form-resolvers` (Zod/Valibot) | Build | Tiny (~100 LOC) | Medium |
| `@what/virtual` (TanStack Virtual) | Adapt | Small (~150 LOC) | Medium |
| Date picker (in `@what/ui`) | Build | Medium | Medium |

### Phase 3 — Ecosystem richness
| Package | Strategy | Effort | Impact |
|---------|----------|--------|--------|
| `@what/i18n` (i18next adapter) | Adapt | Small | Low-Med |
| `@what/charts` (Chart.js wrapper) | Wrap | Small | Low-Med |
| `@what/dnd` (SortableJS wrapper) | Wrap | Small | Low-Med |
| `@thenjs/auth` | Build | Medium | Med (ThenJS) |

---

## What We Should NOT Build

- **Full component library** (styled, opinionated like MUI/Chakra) — too much maintenance surface. Stay headless. Let users style with Tailwind/CSS.
- **State management alternatives** — we already have signals + stores. Don't build a Redux/Zustand equivalent. That's the whole point of signals.
- **React compatibility layer** — some frameworks (Preact, Million.js) try to be React-compatible. This is a trap. It's an infinite maintenance burden and you're always playing catch-up. What is its own thing.
- **SSG framework** — ThenJS already handles this. Don't build a separate Astro-like thing.
- **CSS-in-JS runtime** — the industry is moving away from this. Tailwind + CSS modules + native CSS is the right answer.

---

## The "Adapt" Pattern in Detail

For libraries with framework-agnostic cores, the adapter pattern is:

```
┌─────────────────────┐
│  @tanstack/table     │  ← Framework-agnostic core (maintained by TanStack)
│  @floating-ui/dom    │  ← Framework-agnostic core (maintained by Floating UI)
│  i18next             │  ← Framework-agnostic core (maintained by i18next)
└─────────┬───────────┘
          │
┌─────────▼───────────┐
│  @what/table         │  ← Our thin adapter (~200 lines)
│  @what/floating      │  ← Our thin adapter (~150 lines)
│  @what/i18n          │  ← Our thin adapter (~100 lines)
└─────────────────────┘
```

The adapter's job:
1. Create a What hook (e.g., `useTable()`) that initializes the core
2. Wire signal reactivity to the core's state updates
3. Provide JSX helpers if needed (e.g., `<TableHeader>`)
4. Handle cleanup on component unmount via `onCleanup()`

This is extremely cheap to maintain because the core library handles all the complex logic. We just bridge the lifecycle.

---

## Naming Convention

All ecosystem packages under `@what/` scope:
- `@what/ui` — headless UI components
- `@what/motion` — animation
- `@what/table` — TanStack Table adapter
- `@what/virtual` — TanStack Virtual adapter
- `@what/editor` — TipTap adapter
- `@what/toast` — toast notifications
- `@what/floating` — Floating UI adapter
- `@what/i18n` — i18next adapter
- `@what/charts` — Chart.js wrapper
- `@what/dnd` — drag and drop
- `@what/form-resolvers` — Zod/Valibot/Yup form resolvers

ThenJS ecosystem under `@thenjs/`:
- `@thenjs/auth` — authentication

---

## Success Criteria

A developer should be able to build a **SaaS dashboard** (the most common web app archetype) using only What Framework + `@what/*` packages:

- Layout with sidebar navigation ← `@what/ui` (Tabs, Navigation)
- Data tables with sorting/filtering ← `@what/table`
- Modal dialogs and popovers ← `@what/ui` (Dialog, Popover)
- Toast notifications ← `@what/toast`
- Form with validation ← `what-framework` (useForm) + `@what/form-resolvers`
- Charts ← `@what/charts`
- Animated transitions ← `@what/motion`
- Auth ← `@thenjs/auth`

If all of that works smoothly, What Framework is viable for production use.

---

*Last updated: February 18, 2026*
