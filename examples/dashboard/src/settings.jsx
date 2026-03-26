// Settings — theme toggle, items per page config
// Demonstrates: signal-driven toggle, CSS class toggling for theme

import { darkMode, itemsPerPage, setPerPage, data, initData } from './store.js';

function Toggle({ value, onToggle, label }) {
  return (
    <button
      class={() => `toggle ${value() ? 'on' : ''}`}
      onClick={() => onToggle(!value())}
      aria-label={label}
    >
      <span class="toggle-knob"></span>
    </button>
  );
}

export default function Settings() {
  return (
    <div class="settings-panel">
      <div class="settings-title">Settings</div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Dark Mode</div>
          <div class="setting-desc">Toggle between dark and light theme</div>
        </div>
        <div class="setting-control">
          <Toggle
            value={darkMode}
            onToggle={(v) => darkMode.set(v)}
            label="Toggle dark mode"
          />
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Rows Per Page</div>
          <div class="setting-desc">Number of rows displayed in the table</div>
        </div>
        <div class="setting-control">
          <select
            class="filter-select"
            value={() => String(itemsPerPage())}
            onChange={e => setPerPage(parseInt(e.target.value, 10))}
          >
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Regenerate Data</div>
          <div class="setting-desc">Generate a fresh set of 1,000 random records</div>
        </div>
        <div class="setting-control">
          <button
            class="page-btn"
            onClick={() => initData()}
          >
            Regenerate
          </button>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Total Records</div>
          <div class="setting-desc">Current dataset size</div>
        </div>
        <div class="setting-control">
          <span class="filter-badge">{() => data().length.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
