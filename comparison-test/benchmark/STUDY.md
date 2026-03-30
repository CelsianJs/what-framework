# Cross-Framework Benchmark Study

Comparative study measuring AI agent effectiveness across three frontend frameworks: **What Framework (WhatFW)**, **React**, and **Svelte**.

## What We're Testing

Can a framework designed for AI agents (WhatFW + MCP DevTools) produce better applications at lower cost than established frameworks (React, Svelte) using standard browser automation?

### The Variable

Each framework uses a different **verification toolchain** during development:

| Framework | Build Verification | How It Works |
|---|---|---|
| **WhatFW** | MCP DevTools | Structured signal/component inspection, reactive dependency graphs, DOM analysis — no screenshots |
| **React** | Playwright | Browser automation with screenshots, console checks, interaction testing |
| **Svelte** | Playwright | Browser automation with screenshots, console checks, interaction testing |

### The Controls

Everything else is equal:
- Same app prompt for all 3 frameworks
- Equivalent build context docs (API patterns, CSS conventions, accessibility guidance, project setup)
- Same AI model (Claude Opus 4.6)
- Same scoring rubric and review process
- All agents must start a dev server and iteratively verify their work

## How a Benchmark Round Works

### 1. Pick a Prompt

Select an app from the prompt bank (6 total, 3 complexity levels). Each prompt describes the same app features for all frameworks.

### 2. Dispatch 3 Agents in Parallel

Each agent gets:
- The app requirements (identical across frameworks)
- A framework-specific build context from `comparison-test/benchmark/prompts/`:
  - `whatfw-build-context.md` — WhatFW API, signal patterns, MCP DevTools workflow
  - `react-build-context.md` — React hooks API, component patterns, Playwright workflow
  - `svelte-build-context.md` — Svelte 5 runes API, store patterns, Playwright workflow

### 3. Agent Build + Verify Loop

Each agent must:
1. Write all application code
2. Run `npm install`
3. Start the dev server (`npm run dev`) in the background
4. **Verify the running app** using their framework's tools
5. Fix any issues found
6. Re-verify until clean
7. Stop the dev server

The WhatFW agent uses MCP DevTools (`what_diagnose`, `what_page_map`, `what_look`, `what_errors`, `what_lint`) for verification. React and Svelte agents use Playwright browser automation (screenshots, console checks, interaction testing).

### 4. Build Test

After agents complete, run `npx vite build` on each app. Record:
- Whether the production build succeeds
- Bundle sizes (gzip JS + CSS)

### 5. Review Scoring

A separate review agent reads ALL source files from all 3 apps and scores each on 5 dimensions (0-10):

| Dimension | What It Measures |
|---|---|
| **Styling** | CSS quality, dark mode, responsive design, animations, typography |
| **Performance** | Bundle size, render efficiency, state management, unnecessary recomputation |
| **Code Quality** | Architecture, idiomatic patterns, maintainability, dead code, accessibility |
| **Functionality** | Feature completeness against the prompt requirements |
| **Overall** | Would you ship this? Holistic assessment |

The review agent also provides:
- `winner` — which framework produced the best app
- `summary` — comparative analysis
- `verification_impact` — whether MCP vs Playwright verification affected the outcome

### 6. Record Results

All data is saved to a SQLite database:
- Prompt, framework, model, round number
- Token count, duration, build success
- Bundle size
- All 5 scores + review notes

## Prompt Bank

Six app prompts across three complexity levels:

### Simple
| Prompt | Description |
|---|---|
| **Pomodoro Timer** | Circular progress, start/pause/reset, configurable durations, session counter, Web Audio beep, dark mode |
| **Markdown Notepad** | Split-pane editor, live preview, heading/bold/italic/code/links, word count, localStorage, Cmd+B/I shortcuts |

### Medium
| Prompt | Description |
|---|---|
| **Weather Dashboard** | City search via wttr.in API, current conditions + 3-day forecast, recent searches, loading skeletons, error handling, C/F toggle |
| **Kanban Board** | 3 columns (To Do/In Progress/Done), HTML5 drag-and-drop, inline title editing, delete confirmation, priority labels + filter, localStorage |

### Complex
| Prompt | Description |
|---|---|
| **Expense Tracker** | CRUD expenses, category bar chart (CSS only), date/category filters, monthly comparison, CSV export, form validation, edit/delete transactions |
| **Real-Time Chat UI** | 5 mock conversations, message bubbles (sent/received), typing indicator, emoji picker, unread badges, search, message status checkmarks, responsive sidebar |

All prompts require: Vite build tool, no UI library (plain CSS), dark/light theme, responsive design, localStorage persistence.

## Running the Study

### Prerequisites

- Node.js 22+
- Claude Code CLI (`claude`)
- Playwright MCP plugin (for React/Svelte agents)
- WhatFW MCP server (auto-connected via `.mcp.json`)

### Commands

**Run a single round:**
```bash
# From the what-fw repo root
node comparison-test/benchmark/run.js --prompt expense-tracker --model opus
```

**Run with a specific framework only:**
```bash
node comparison-test/benchmark/run.js --prompt kanban-board --framework whatfw --model opus
```

**View the scoreboard:**
```bash
node comparison-test/benchmark/run.js --scoreboard
```

**Browse all generated apps:**
```bash
node comparison-test/benchmark/viewer/server.js
# Open http://localhost:4000
```

The viewer dashboard shows:
- Scoreboard with averages per framework
- Each round as a section with cards per framework
- Scores, tokens, duration, bundle size, review notes
- "Open App" links to the built dist/ of each app
- "View Source" links to browse source files

### Scheduled Runs

Use Claude Code's cron system to run benchmarks on a schedule:

```
/loop 60m Run the cross-framework benchmark...
```

Or set up a recurring cron:
```js
CronCreate({
  cron: "37 * * * *",
  prompt: "Cross-framework benchmark loop...",
  recurring: true
})
```

### Available Models

| Flag | Agent | Model |
|---|---|---|
| `--model opus` | Claude Code | Claude Opus 4.6 |
| `--model sonnet` | Claude Code | Claude Sonnet 4.6 |
| `--model gpt5` | Codex | GPT-5.4 |
| `--model deepseek` | OpenCode | DeepSeek V3 |
| `--model kimi` | OpenCode | Kimi K2 |

## File Structure

```
comparison-test/benchmark/
├── STUDY.md                          # This file
├── db.js                             # SQLite database (prompts, runs, scores)
├── run.js                            # CLI runner (dispatch, build, score)
├── .env                              # API keys (gitignored)
├── prompts/
│   ├── bank.js                       # 6 app prompts with descriptions
│   ├── whatfw-build-context.md       # WhatFW framework guide for agents
│   ├── react-build-context.md        # React framework guide for agents
│   └── svelte-build-context.md       # Svelte framework guide for agents
├── apps/
│   └── round-N/                      # Generated apps per round (gitignored)
│       ├── {prompt}-whatfw/
│       ├── {prompt}-react/
│       └── {prompt}-svelte/
├── results/
│   └── benchmark.db                  # SQLite database (gitignored)
└── viewer/
    └── server.js                     # Dashboard web server (localhost:4000)
```
