// The quote draft: every step's answers in one signal, saved to localStorage
// as the visitor types (debounced) and read back on a reload, so a reload in
// the middle of a step comes back to that step with every answer, field
// arrays included. A page hide saves at once, so a reload inside the
// debounce window loses nothing.

import { computed, signal } from 'what-framework';

import { emptyDraft, stepsFor } from './data.js';
import { probes } from './probes.js';

export const KEY = 'harbor:quote';
export const DEBOUNCE_MS = 300;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyDraft(), ...JSON.parse(raw) };
  } catch {}
  return emptyDraft();
}

export const draft = signal(read(), 'draft');
export const saving = signal(false, 'saving');
// Errors the server found on submit, by step, until the visitor edits them.
export const serverErrors = signal([], 'server-errors');
// The license photo chosen this session. A file cannot be stored or put back
// into a file input, so a reload asks for it again.
export const licenseFile = signal(null, 'license-file');

export const steps = computed(() => stepsFor(draft()));

let timer = null;

export function flush() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
  localStorage.setItem(KEY, JSON.stringify(draft.peek()));
  probes.saves++;
  saving(false);
}

// A section's answers changed: keep them, and save once typing pauses.
export function patch(section, value) {
  const now = draft.peek();
  if (JSON.stringify(now[section]) === JSON.stringify(value)) return;
  draft({ ...now, [section]: value });
  saving(true);
  clearTimeout(timer);
  timer = setTimeout(() => { timer = 0; flush(); }, DEBOUNCE_MS);
}

export function markDone(id) {
  const now = draft.peek();
  if (!now.done[id]) patch('done', { ...now.done, [id]: true });
  flush();
}

export function startOver() {
  clearTimeout(timer);
  timer = null;
  localStorage.removeItem(KEY);
  serverErrors([]);
  licenseFile(null);
  draft(emptyDraft());
  saving(false);
}

addEventListener('pagehide', flush);
