// Dashboard App — main layout with tab switching
// Demonstrates: signal-based tab switching, conditional rendering,
// CSS class toggling for theme, onMount for data initialization,
// useEffect for reactive theme application

import { mount, useEffect, onMount } from 'what-framework';
import { activeTab, darkMode, initData } from './store.js';
import Stats from './stats.jsx';
import Filters from './filters.jsx';
import DataTable from './data-table.jsx';
import Charts from './chart.jsx';
import Settings from './settings.jsx';

function TabBar() {
  const tabs = [
    { id: 'table', label: 'Table' },
    { id: 'charts', label: 'Charts' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div class="tabs">
      {tabs.map(tab => (
        <button
          class={() => `tab-btn ${activeTab() === tab.id ? 'active' : ''}`}
          onClick={() => activeTab.set(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ThemeToggle() {
  return (
    <button
      class="theme-toggle"
      onClick={() => darkMode.set(d => !d)}
      title={() => darkMode() ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {() => darkMode() ? '\u2600\uFE0F' : '\uD83C\uDF19'}
    </button>
  );
}

function TabContent() {
  return (
    <div>
      {() => {
        const tab = activeTab();
        if (tab === 'table') {
          return (
            <div style="display: flex; flex-direction: column; gap: 16px;">
              <Filters />
              <DataTable />
            </div>
          );
        }
        if (tab === 'charts') {
          return <Charts />;
        }
        if (tab === 'settings') {
          return <Settings />;
        }
        return null;
      }}
    </div>
  );
}

function App() {
  // Generate fake data on mount
  onMount(() => {
    initData();
  });

  // Apply theme class reactively
  useEffect(() => {
    const isDark = darkMode();
    if (isDark) {
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
    }
  });

  return (
    <div class="dashboard">
      <div class="dashboard-header">
        <div>
          <div class="dashboard-title">Dashboard</div>
          <div class="dashboard-subtitle">
            Performance stress-test with 1,000 reactive rows
          </div>
        </div>
        <div class="header-actions">
          <TabBar />
          <ThemeToggle />
        </div>
      </div>

      <Stats />
      <TabContent />
    </div>
  );
}

// ─── Mount ────────────────────────────────────────────────────

mount(<App />, '#app');
