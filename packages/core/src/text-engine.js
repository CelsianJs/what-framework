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

// --- Lazy Pretext loader ---

let pretextModule = null;
let pretextLoadPromise = null;

export function _setPretextForTests(fake) {
  pretextModule = fake;
  pretextLoadPromise = Promise.resolve(fake);
}

export async function ensurePretext() {
  if (pretextModule) return pretextModule;
  if (pretextLoadPromise) return pretextLoadPromise;

  pretextLoadPromise = import('@chenglou/pretext').then((mod) => {
    pretextModule = mod;
    return mod;
  }).catch((err) => {
    pretextLoadPromise = null;
    throw new Error(
      `[what] Failed to load @chenglou/pretext. ` +
      `Make sure it is installed: npm install @chenglou/pretext\n` +
      `Original error: ${err.message}`
    );
  });

  return pretextLoadPromise;
}

// --- Test helpers ---

export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
}
