<script>
  let { isRunning, start, pause, reset, activeColor } = $props();
</script>

<div class="controls">
  {#if isRunning}
    <button
      class="control-btn primary"
      onclick={pause}
      style="background: {activeColor};"
      aria-label="Pause timer"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <rect x="4" y="3" width="4" height="14" rx="1" />
        <rect x="12" y="3" width="4" height="14" rx="1" />
      </svg>
      Pause
    </button>
  {:else}
    <button
      class="control-btn primary"
      onclick={start}
      style="background: {activeColor};"
      aria-label="Start timer"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6 3.5L16 10L6 16.5V3.5Z" />
      </svg>
      Start
    </button>
  {/if}

  <button
    class="control-btn secondary"
    onclick={reset}
    aria-label="Reset timer"
  >
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M1 1v5h5" />
      <path d="M3.51 11a6.5 6.5 0 1 0 1.13-6.5L1 6" />
    </svg>
    Reset
  </button>
</div>

<style>
  .controls {
    display: flex;
    gap: 0.75rem;
    justify-content: center;
  }

  .control-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.5rem;
    border-radius: 14px;
    font-size: 0.9375rem;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .primary {
    color: white;
    box-shadow: var(--shadow);
  }

  .primary:hover {
    opacity: 0.9;
    transform: translateY(-1px);
    box-shadow: var(--shadow-lg);
  }

  .primary:active {
    transform: translateY(0);
  }

  .secondary {
    background: var(--btn-bg);
    color: var(--btn-text);
  }

  .secondary:hover {
    background: var(--btn-hover);
    transform: translateY(-1px);
  }

  .secondary:active {
    transform: translateY(0);
  }
</style>
