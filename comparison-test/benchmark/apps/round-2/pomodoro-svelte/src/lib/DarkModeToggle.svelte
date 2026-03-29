<script>
  function getInitialDark() {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('pomodoro-dark-mode');
    if (stored !== null) return stored === 'true';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  let dark = $state(getInitialDark());

  $effect(() => {
    document.documentElement.classList.toggle('dark', dark);
  });

  function toggle() {
    dark = !dark;
    localStorage.setItem('pomodoro-dark-mode', String(dark));
  }
</script>

<button
  class="dark-toggle"
  onclick={toggle}
  aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
  title={dark ? 'Light mode' : 'Dark mode'}
>
  {#if dark}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
      <circle cx="9" cy="9" r="4" />
      <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.34 3.34l1.42 1.42M13.24 13.24l1.42 1.42M3.34 14.66l1.42-1.42M13.24 4.76l1.42-1.42" />
    </svg>
  {:else}
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M16 11.37A7 7 0 1 1 6.63 2 5.5 5.5 0 0 0 16 11.37Z" />
    </svg>
  {/if}
</button>

<style>
  .dark-toggle {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    background: var(--btn-bg);
    color: var(--text-secondary);
  }

  .dark-toggle:hover {
    background: var(--btn-hover);
    color: var(--text-primary);
  }
</style>
