// What Framework - Text Engine Adapter
// Internal adapter for @chenglou/pretext integration.

// --- Config ---

const KNOWN_KEYS = new Set(['measure', 'cacheSize']);

const DEFAULT_CONFIG = { measure: false, cacheSize: 1000 };

let textConfig = { ...DEFAULT_CONFIG };

export function configureText(overrides) {
  if (hasMounted) {
    console.warn('[what] configureText called after mount. Text config should be set before mounting the app.');
  }
  for (const key of Object.keys(overrides)) {
    if (KNOWN_KEYS.has(key)) {
      textConfig[key] = overrides[key];
    }
  }
}

export function getTextConfig() {
  return { ...textConfig };
}

// --- Timing contract (warn-after-mount) ---

let hasMounted = false;

export function _markMounted() {
  hasMounted = true;
}

// --- Test helpers ---

export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
}
