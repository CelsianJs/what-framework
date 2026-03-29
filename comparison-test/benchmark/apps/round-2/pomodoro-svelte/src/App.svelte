<script>
  import Timer from './lib/Timer.svelte';
  import Controls from './lib/Controls.svelte';
  import Settings from './lib/Settings.svelte';
  import DarkModeToggle from './lib/DarkModeToggle.svelte';

  let mode = $state('work');
  let workDuration = $state(25);
  let breakDuration = $state(5);
  let timeLeft = $state(25 * 60);
  let isRunning = $state(false);
  let completedSessions = $state(0);
  let intervalId = $state(null);

  let totalSeconds = $derived(mode === 'work' ? workDuration * 60 : breakDuration * 60);
  let progress = $derived(1 - timeLeft / totalSeconds);
  let activeColor = $derived(mode === 'work' ? 'var(--color-work)' : 'var(--color-break)');

  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.connect(gain);
      gain.connect(ctx.destination);

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(800, ctx.currentTime);
      oscillator.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
      oscillator.frequency.setValueAtTime(800, ctx.currentTime + 0.2);

      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
      // Web Audio API not available
    }
  }

  function tick() {
    if (timeLeft <= 0) {
      clearInterval(intervalId);
      intervalId = null;
      isRunning = false;
      playBeep();

      if (mode === 'work') {
        completedSessions++;
        mode = 'break';
        timeLeft = breakDuration * 60;
      } else {
        mode = 'work';
        timeLeft = workDuration * 60;
      }
      return;
    }
    timeLeft--;
  }

  function start() {
    if (isRunning) return;
    isRunning = true;
    intervalId = setInterval(tick, 1000);
  }

  function pause() {
    if (!isRunning) return;
    isRunning = false;
    clearInterval(intervalId);
    intervalId = null;
  }

  function reset() {
    pause();
    timeLeft = mode === 'work' ? workDuration * 60 : breakDuration * 60;
  }

  function switchMode(newMode) {
    pause();
    mode = newMode;
    timeLeft = newMode === 'work' ? workDuration * 60 : breakDuration * 60;
  }

  function updateWorkDuration(val) {
    workDuration = val;
    if (mode === 'work' && !isRunning) {
      timeLeft = val * 60;
    }
  }

  function updateBreakDuration(val) {
    breakDuration = val;
    if (mode === 'break' && !isRunning) {
      timeLeft = val * 60;
    }
  }
</script>

<main class="container">
  <header>
    <h1>Pomodoro</h1>
    <DarkModeToggle />
  </header>

  <div class="mode-switcher">
    <button
      class="mode-btn"
      class:active={mode === 'work'}
      onclick={() => switchMode('work')}
      style={mode === 'work' ? `background: var(--color-work-soft); color: var(--color-work);` : ''}
    >
      Work
    </button>
    <button
      class="mode-btn"
      class:active={mode === 'break'}
      onclick={() => switchMode('break')}
      style={mode === 'break' ? `background: var(--color-break-soft); color: var(--color-break);` : ''}
    >
      Break
    </button>
  </div>

  <Timer {timeLeft} {progress} {activeColor} {mode} />

  <Controls {isRunning} {start} {pause} {reset} {activeColor} />

  <div class="session-counter">
    <span class="session-label">Sessions completed</span>
    <span class="session-count" style="color: var(--color-work);">{completedSessions}</span>
  </div>

  <Settings
    {workDuration}
    {breakDuration}
    {isRunning}
    onWorkChange={updateWorkDuration}
    onBreakChange={updateBreakDuration}
  />
</main>

<style>
  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
  }

  header {
    width: 100%;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text-primary);
  }

  .mode-switcher {
    display: flex;
    gap: 0.5rem;
    background: var(--btn-bg);
    padding: 4px;
    border-radius: 12px;
  }

  .mode-btn {
    padding: 0.5rem 1.25rem;
    border-radius: 9px;
    font-size: 0.875rem;
    font-weight: 600;
    background: transparent;
    color: var(--text-muted);
    letter-spacing: -0.01em;
  }

  .mode-btn:hover {
    color: var(--text-secondary);
  }

  .mode-btn.active {
    box-shadow: var(--shadow);
  }

  .session-counter {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .session-label {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .session-count {
    font-size: 1.75rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
