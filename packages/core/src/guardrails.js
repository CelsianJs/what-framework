// What Framework - Agent Guardrails
// Dev-mode runtime checks that catch common mistakes BEFORE they become bugs.
// Designed for AI agents: structured warnings with fix suggestions.

import { __DEV__ } from './reactive.js';
import { IMPORT_CHANGES } from './import-changes.js';
import * as rootEntry from './index.js';

// --- Guardrail Registry ---
// Each guardrail can be enabled/disabled independently.

const guardrails = {
  importValidation: true,
};

export function configureGuardrails(overrides) {
  Object.assign(guardrails, overrides);
}

export function getGuardrailConfig() {
  return { ...guardrails };
}

// --- Import Validation ---
// Verify that all named imports from 'what-framework' are valid exports. A name
// in import-changes.js gets the answer recorded there (where it went, or what
// replaces it), the one what-compiler's Vite plugin and the no-moved-imports
// lint rule give, instead of a guess.

/** @type {{ valid: Set<string>, changed: Map<string, any> } | null} */
let exportIndex = null;

function exportsIndex() {
  if (exportIndex === null) {
    // Keyed by the old name and by the new one, so `useTween` imported from
    // the root entry is pointed at what-framework/motion too.
    const changed = new Map();
    for (const change of IMPORT_CHANGES) {
      changed.set(change.name, change);
      if (change.as) changed.set(change.as, change);
    }
    exportIndex = { valid: new Set(Object.keys(rootEntry)), changed };
  }
  return exportIndex;
}

export function validateImports(importNames) {
  if (!__DEV__ || !guardrails.importValidation) return [];

  const { valid, changed } = exportsIndex();
  const invalid = [];
  for (const name of importNames) {
    if (valid.has(name)) continue;
    const change = changed.get(name);
    if (change) {
      invalid.push({
        name,
        message: `"${name}" is not exported by what-framework.`,
        suggestion: change.answer,
      });
    } else {
      const closest = findClosest(name);
      invalid.push({
        name,
        message: `"${name}" is not a valid export from what-framework.`,
        suggestion: closest ? `Check the API reference. Did you mean ${closest}?` : 'Check the API reference.',
      });
    }
  }
  return invalid;
}

// Simple Levenshtein-based closest match, or null when nothing is close.
function findClosest(input) {
  const lower = input.toLowerCase();
  /** @type {string | null} */
  let best = null;
  let bestDist = Infinity;

  for (const name of exportsIndex().valid) {
    const dist = levenshtein(lower, name.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = name;
    }
  }

  return bestDist <= 3 ? best : null;
}

function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}
