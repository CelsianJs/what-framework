<script>
  let { workDuration, breakDuration, isRunning, onWorkChange, onBreakChange } = $props();

  let isOpen = $state(false);
</script>

<div class="settings-section">
  <button
    class="settings-toggle"
    onclick={() => isOpen = !isOpen}
    aria-expanded={isOpen}
    aria-controls="settings-panel"
  >
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1v1.5M8 13.5V15M14.5 8H13M3 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" />
    </svg>
    Settings
    <svg
      class="chevron"
      class:open={isOpen}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M3 4.5L6 7.5L9 4.5" />
    </svg>
  </button>

  {#if isOpen}
    <div class="settings-panel" id="settings-panel">
      <div class="setting-row">
        <label for="work-input">
          <span class="setting-label">Work</span>
          <span class="setting-unit">minutes</span>
        </label>
        <div class="stepper">
          <button
            class="step-btn"
            onclick={() => onWorkChange(Math.max(1, workDuration - 1))}
            disabled={isRunning || workDuration <= 1}
            aria-label="Decrease work duration"
          >-</button>
          <input
            id="work-input"
            type="number"
            min="1"
            max="120"
            value={workDuration}
            oninput={(e) => {
              const val = parseInt(e.target.value);
              if (val >= 1 && val <= 120) onWorkChange(val);
            }}
            disabled={isRunning}
          />
          <button
            class="step-btn"
            onclick={() => onWorkChange(Math.min(120, workDuration + 1))}
            disabled={isRunning || workDuration >= 120}
            aria-label="Increase work duration"
          >+</button>
        </div>
      </div>

      <div class="setting-row">
        <label for="break-input">
          <span class="setting-label">Break</span>
          <span class="setting-unit">minutes</span>
        </label>
        <div class="stepper">
          <button
            class="step-btn"
            onclick={() => onBreakChange(Math.max(1, breakDuration - 1))}
            disabled={isRunning || breakDuration <= 1}
            aria-label="Decrease break duration"
          >-</button>
          <input
            id="break-input"
            type="number"
            min="1"
            max="60"
            value={breakDuration}
            oninput={(e) => {
              const val = parseInt(e.target.value);
              if (val >= 1 && val <= 60) onBreakChange(val);
            }}
            disabled={isRunning}
          />
          <button
            class="step-btn"
            onclick={() => onBreakChange(Math.min(60, breakDuration + 1))}
            disabled={isRunning || breakDuration >= 60}
            aria-label="Increase break duration"
          >+</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .settings-section {
    width: 100%;
    max-width: 320px;
  }

  .settings-toggle {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 auto;
    padding: 0.5rem 1rem;
    border-radius: 10px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .settings-toggle:hover {
    color: var(--text-secondary);
    background: var(--btn-bg);
  }

  .chevron {
    transition: transform 0.2s ease;
  }

  .chevron.open {
    transform: rotate(180deg);
  }

  .settings-panel {
    margin-top: 0.75rem;
    padding: 1rem;
    background: var(--settings-bg);
    border-radius: 14px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  label {
    display: flex;
    flex-direction: column;
  }

  .setting-label {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .setting-unit {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--btn-bg);
    border-radius: 10px;
    overflow: hidden;
  }

  .step-btn {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--text-primary);
    font-size: 1.125rem;
    font-weight: 500;
  }

  .step-btn:hover:not(:disabled) {
    background: var(--btn-hover);
  }

  .step-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  input[type='number'] {
    width: 48px;
    text-align: center;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-family: inherit;
    font-size: 0.9375rem;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    outline: none;
    -moz-appearance: textfield;
  }

  input[type='number']::-webkit-inner-spin-button,
  input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
