/**
 * Prompt Bank — diverse app concepts for cross-framework benchmarking.
 *
 * Each prompt describes an app that can be built in WhatFW, React, or Svelte.
 * Prompts are framework-agnostic — the benchmark harness adds framework context.
 */

export const prompts = [
  // --- Simple ---
  {
    slug: 'pomodoro-timer',
    title: 'Pomodoro Timer',
    complexity: 'simple',
    description: `Build a Pomodoro timer app with:
- A circular progress indicator showing time remaining
- Start/pause/reset controls
- Configurable work (25min) and break (5min) durations
- Session counter (how many pomodoros completed)
- Sound notification when timer ends (use a simple beep via Web Audio API)
- Dark mode toggle
- Clean, minimal UI with good typography`,
  },
  {
    slug: 'markdown-notepad',
    title: 'Markdown Notepad',
    complexity: 'simple',
    description: `Build a split-pane markdown editor:
- Left pane: textarea for raw markdown input
- Right pane: live rendered preview
- Support: headings, bold, italic, links, code blocks, lists, blockquotes
- Toggle between split view and preview-only view
- Character and word count in the status bar
- Save/load from localStorage
- Dark/light theme toggle
- Keyboard shortcut: Cmd+B for bold, Cmd+I for italic`,
  },

  // --- Medium ---
  {
    slug: 'weather-dashboard',
    title: 'Weather Dashboard',
    complexity: 'medium',
    description: `Build a weather dashboard app:
- Search bar to look up cities (use https://wttr.in/{city}?format=j1 as the API)
- Current conditions card: temperature, humidity, wind, description, icon
- 3-day forecast displayed as cards
- Recent searches list (persisted in localStorage)
- Loading states with skeleton placeholders
- Error handling for invalid cities
- Responsive layout (cards stack on mobile)
- Temperature unit toggle (C/F)
- Dark/light theme
- Subtle CSS animations on card entry`,
  },
  {
    slug: 'kanban-board',
    title: 'Kanban Board',
    complexity: 'medium',
    description: `Build a Kanban task board:
- 3 columns: To Do, In Progress, Done
- Add new tasks with title and optional description
- Drag and drop tasks between columns (HTML5 drag API)
- Edit task title inline (click to edit)
- Delete tasks with confirmation
- Task count per column in the header
- Color-coded priority labels (high=red, medium=yellow, low=green)
- Filter tasks by priority
- Persist board state in localStorage
- Clean card-based UI with shadows and rounded corners`,
  },

  // --- Complex ---
  {
    slug: 'expense-tracker',
    title: 'Expense Tracker',
    complexity: 'complex',
    description: `Build a personal expense tracker:
- Add expenses: amount, category, date, description
- Categories: Food, Transport, Entertainment, Bills, Shopping, Other
- Dashboard with:
  - Total spent this month (large number)
  - Spending by category (horizontal bar chart using CSS, no chart library)
  - Last 10 transactions list
  - Monthly comparison (current vs previous month)
- Filter by date range and category
- Edit and delete transactions
- Export as CSV
- All data persisted in localStorage
- Responsive design
- Dark/light theme with smooth transition
- Form validation (required fields, positive amounts, valid dates)`,
  },
  {
    slug: 'real-time-chat',
    title: 'Real-Time Chat UI',
    complexity: 'complex',
    description: `Build a chat interface (mock data, no real backend):
- Sidebar with conversation list (5 mock conversations)
- Main chat area with message bubbles (sent vs received styling)
- Message input with send button and Enter key support
- Typing indicator animation
- Timestamps on messages (relative: "2m ago", "1h ago")
- Unread message badges on conversations
- Search conversations in sidebar
- Auto-scroll to latest message
- Emoji picker (basic grid of 20 common emojis)
- Message status indicators (sent, delivered, read with checkmarks)
- Responsive: sidebar collapses on mobile
- Dark/light theme
- Smooth transitions between conversations`,
  },
];

export function getRandomPrompt() {
  return prompts[Math.floor(Math.random() * prompts.length)];
}

export function getPromptBySlug(slug) {
  return prompts.find(p => p.slug === slug);
}

export function getPromptsByComplexity(complexity) {
  return prompts.filter(p => p.complexity === complexity);
}
