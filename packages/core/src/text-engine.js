// What Framework - Text Engine Adapter
// Internal adapter for @chenglou/pretext integration.

// --- Config ---

const KNOWN_KEYS = new Set(['measure', 'cacheSize']);

const DEFAULT_CONFIG = { measure: false, cacheSize: 1000 };

let textConfig = { ...DEFAULT_CONFIG };

export function configureText(overrides) {
  for (const key of Object.keys(overrides)) {
    if (KNOWN_KEYS.has(key)) {
      textConfig[key] = overrides[key];
    }
  }
}

export function getTextConfig() {
  return { ...textConfig };
}

// --- Test helpers ---

export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
}
