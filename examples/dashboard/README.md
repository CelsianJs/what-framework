# Dashboard — What Framework

A performance stress-test dashboard with 1,000 reactive rows, charts, and settings.

## Features

- Data table with 1,000 rows, sorting, search, and pagination
- SVG bar/line/pie charts generated from reactive data
- Dark/light theme toggle
- Tab-based navigation (Table / Charts / Settings)
- Stat cards with computed aggregates

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
dashboard/
  index.html          Entry HTML
  vite.config.js      Vite + what-compiler plugin
  package.json
  src/
    app.jsx           Main layout with tabs and theme toggle
    store.js          Data generation, signals, and computed state
    stats.jsx         Summary stat cards
    filters.jsx       Search and category filter controls
    data-table.jsx    Sortable, paginated table (1,000 rows)
    chart.jsx         SVG bar, line, and pie charts
    settings.jsx      Configuration panel
    styles.css        Full dashboard stylesheet
```

## Patterns Demonstrated

- **Module-level signals** for shared state across components
- **useComputed** for derived stats, filtered data, and pagination
- **onMount** for data initialization
- **useEffect** for reactive theme class application
- **JSX** with conditional rendering and dynamic class names
