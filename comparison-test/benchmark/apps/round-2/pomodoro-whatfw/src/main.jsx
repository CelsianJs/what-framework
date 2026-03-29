import { mount, effect } from 'what-framework';
import {
  isRunning, isBreak, timeLeft, sessionsCompleted,
  workDuration, breakDuration, darkMode,
  progress, displayMinutes, displaySeconds, phaseLabel,
  toggleTimer, resetTimer, skipToNext,
  setWorkDuration, setBreakDuration, toggleDarkMode,
} from './store.js';
import { playBeep } from './audio.js';
import './style.css';

// ---------------------------------------------------------------------------
// Circular Progress Ring
// ---------------------------------------------------------------------------
function ProgressRing() {
  const size = 280;
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <div class="timer-ring-container">
      <svg class="timer-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          class="timer-ring-bg"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke-width={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          class={() => `timer-ring-progress ${isBreak() ? 'break-mode' : ''}`}
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke-width={strokeWidth}
          stroke-linecap="round"
          stroke-dasharray={circumference}
          stroke-dashoffset={() => circumference * (1 - progress())}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div class="timer-display">
        <div class={() => `phase-label ${isBreak() ? 'break' : 'focus'}`}>
          {() => phaseLabel()}
        </div>
        <div class="time-digits">
          {() => `${displayMinutes()}:${displaySeconds()}`}
        </div>
        <div class="session-count">
          {() => {
            const count = sessionsCompleted();
            return count === 1 ? '1 session' : `${count} sessions`;
          }}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timer Controls
// ---------------------------------------------------------------------------
function Controls() {
  return (
    <div class="controls">
      <button
        class="btn btn-secondary"
        onClick={resetTimer}
        title="Reset timer"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 1 9 9 9.75 9.75 0 0 1-6.74-2.74L3 21" />
          <path d="M3 14V21H10" />
        </svg>
      </button>

      <button
        class={() => `btn btn-primary ${isRunning() ? 'running' : ''} ${isBreak() ? 'break-mode' : ''}`}
        onClick={toggleTimer}
      >
        {() => isRunning() ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="6,4 20,12 6,20" />
          </svg>
        )}
      </button>

      <button
        class="btn btn-secondary"
        onClick={skipToNext}
        title="Skip to next phase"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5,4 15,12 5,20" />
          <line x1="19" y1="5" x2="19" y2="19" />
        </svg>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duration Settings
// ---------------------------------------------------------------------------
function Settings() {
  return (
    <div class="settings">
      <div class="setting-group">
        <label class="setting-label">Focus</label>
        <div class="setting-control">
          <button
            class="btn btn-tiny"
            onClick={() => setWorkDuration(Math.max(1, workDuration() - 5))}
          >
            -
          </button>
          <span class="setting-value">{() => `${workDuration()}m`}</span>
          <button
            class="btn btn-tiny"
            onClick={() => setWorkDuration(Math.min(60, workDuration() + 5))}
          >
            +
          </button>
        </div>
      </div>

      <div class="setting-group">
        <label class="setting-label">Break</label>
        <div class="setting-control">
          <button
            class="btn btn-tiny"
            onClick={() => setBreakDuration(Math.max(1, breakDuration() - 1))}
          >
            -
          </button>
          <span class="setting-value">{() => `${breakDuration()}m`}</span>
          <button
            class="btn btn-tiny"
            onClick={() => setBreakDuration(Math.min(30, breakDuration() + 1))}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dark Mode Toggle
// ---------------------------------------------------------------------------
function ThemeToggle() {
  return (
    <button
      class="theme-toggle"
      onClick={toggleDarkMode}
      title={() => darkMode() ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle dark mode"
    >
      {() => darkMode() ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// App Root
// ---------------------------------------------------------------------------
function App() {
  // Timer tick — auto-tracks isRunning(), re-runs with cleanup when it changes
  effect(() => {
    if (!isRunning()) return;

    const id = setInterval(() => {
      timeLeft.set(t => {
        if (t <= 1) {
          // Timer finished
          clearInterval(id);
          isRunning.set(false);
          playBeep();

          // Auto-switch phase
          if (!isBreak()) {
            sessionsCompleted.set(s => s + 1);
          }
          isBreak.set(b => !b);

          // isBreak() now holds the toggled value
          const nextDuration = isBreak() ? breakDuration() : workDuration();
          return nextDuration * 60;
        }
        return t - 1;
      });
    }, 1000);

    // Cleanup: clear interval when effect re-runs or component unmounts
    return () => clearInterval(id);
  });

  // Apply theme class reactively
  effect(() => {
    if (darkMode()) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
    }
  });

  // Update document title reactively
  effect(() => {
    const phase = phaseLabel();
    const mins = displayMinutes();
    const secs = displaySeconds();
    document.title = `${mins}:${secs} - ${phase} | Pomodoro`;
  });

  return (
    <div class="app">
      <header class="header">
        <h1 class="app-title">Pomodoro</h1>
        <ThemeToggle />
      </header>

      <main class="main">
        <ProgressRing />
        <Controls />
        <Settings />
      </main>

      <footer class="footer">
        <p>Built with What Framework</p>
      </footer>
    </div>
  );
}

mount(<App />, '#app');
