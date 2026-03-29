// Pomodoro Timer Store — module-scope signals (shared state)
import { signal, computed } from 'what-framework';

// --- Configuration ---
export const workDuration = signal(25, 'workDuration');   // minutes
export const breakDuration = signal(5, 'breakDuration');  // minutes

// --- Timer State ---
export const isRunning = signal(false, 'isRunning');
export const isBreak = signal(false, 'isBreak');
export const timeLeft = signal(25 * 60, 'timeLeft');      // seconds
export const sessionsCompleted = signal(0, 'sessionsCompleted');

// --- Theme ---
export const darkMode = signal(true, 'darkMode');

// --- Derived ---
export const totalSeconds = computed(() =>
  (isBreak() ? breakDuration() : workDuration()) * 60
);

export const progress = computed(() => {
  const total = totalSeconds();
  const left = timeLeft();
  if (total === 0) return 0;
  return (total - left) / total;
});

export const displayMinutes = computed(() =>
  String(Math.floor(timeLeft() / 60)).padStart(2, '0')
);

export const displaySeconds = computed(() =>
  String(timeLeft() % 60).padStart(2, '0')
);

export const phaseLabel = computed(() =>
  isBreak() ? 'Break' : 'Focus'
);

// --- Actions ---
export function resetTimer() {
  isRunning.set(false);
  const duration = isBreak() ? breakDuration() : workDuration();
  timeLeft.set(duration * 60);
}

export function toggleTimer() {
  isRunning.set(r => !r);
}

export function skipToNext() {
  isRunning.set(false);
  if (!isBreak()) {
    sessionsCompleted.set(s => s + 1);
  }
  isBreak.set(b => !b);
  // After toggling, isBreak() now holds the new value
  const duration = isBreak() ? breakDuration() : workDuration();
  timeLeft.set(duration * 60);
}

export function setWorkDuration(mins) {
  workDuration.set(mins);
  if (!isBreak() && !isRunning()) {
    timeLeft.set(mins * 60);
  }
}

export function setBreakDuration(mins) {
  breakDuration.set(mins);
  if (isBreak() && !isRunning()) {
    timeLeft.set(mins * 60);
  }
}

export function toggleDarkMode() {
  darkMode.set(d => !d);
}
