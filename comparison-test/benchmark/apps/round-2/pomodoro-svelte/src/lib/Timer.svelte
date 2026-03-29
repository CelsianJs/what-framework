<script>
  let { timeLeft, progress, activeColor, mode } = $props();

  let minutes = $derived(Math.floor(timeLeft / 60));
  let seconds = $derived(timeLeft % 60);
  let displayTime = $derived(
    `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  );

  const RADIUS = 120;
  const STROKE = 8;
  const CENTER = RADIUS + STROKE;
  const SIZE = CENTER * 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
  let dashOffset = $derived(CIRCUMFERENCE * (1 - progress));
</script>

<div class="timer-wrapper">
  <svg
    class="timer-ring"
    width={SIZE}
    height={SIZE}
    viewBox="0 0 {SIZE} {SIZE}"
  >
    <!-- Track -->
    <circle
      cx={CENTER}
      cy={CENTER}
      r={RADIUS}
      fill="none"
      stroke="var(--ring-track)"
      stroke-width={STROKE}
    />
    <!-- Progress -->
    <circle
      class="progress-ring"
      cx={CENTER}
      cy={CENTER}
      r={RADIUS}
      fill="none"
      stroke={activeColor}
      stroke-width={STROKE}
      stroke-linecap="round"
      stroke-dasharray={CIRCUMFERENCE}
      stroke-dashoffset={dashOffset}
      transform="rotate(-90 {CENTER} {CENTER})"
    />
  </svg>

  <div class="timer-content">
    <span class="timer-display">{displayTime}</span>
    <span class="timer-label" style="color: {activeColor};">
      {mode === 'work' ? 'Focus Time' : 'Break Time'}
    </span>
  </div>
</div>

<style>
  .timer-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .timer-ring {
    filter: drop-shadow(0 0 20px var(--color-work-glow));
    transform: scaleX(1);
  }

  .progress-ring {
    transition: stroke-dashoffset 0.5s ease;
  }

  .timer-content {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }

  .timer-display {
    font-size: 3.5rem;
    font-weight: 300;
    letter-spacing: -0.04em;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    line-height: 1;
  }

  .timer-label {
    font-size: 0.8125rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  @media (max-width: 380px) {
    .timer-display {
      font-size: 2.5rem;
    }
  }
</style>
