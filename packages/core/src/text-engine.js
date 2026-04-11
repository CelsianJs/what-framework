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

// Synchronous accessor for components that require Pretext at creation time.
// Returns null if Pretext has not yet been loaded.
export function _getPretextSync() {
  return pretextModule;
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

// --- LRU measureText cache ---

const measureCache = new Map();

function cacheGet(key) {
  if (!measureCache.has(key)) return undefined;
  const value = measureCache.get(key);
  // Re-insert to maintain LRU order (most recently used at end)
  measureCache.delete(key);
  measureCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (measureCache.has(key)) {
    measureCache.delete(key);
  } else if (measureCache.size >= textConfig.cacheSize) {
    // Evict oldest (first inserted = first key in Map)
    const oldest = measureCache.keys().next().value;
    measureCache.delete(oldest);
  }
  measureCache.set(key, value);
}

export async function measureText(text, font, containerWidth, lineHeight) {
  await ensureFontsReady();
  const pretext = await ensurePretext();

  const cacheKey = `${font}|${text}`;
  let prepared = cacheGet(cacheKey);
  if (!prepared) {
    prepared = pretext.prepare(text, font);
    cacheSet(cacheKey, prepared);
  }

  return pretext.layout(prepared, containerWidth, lineHeight);
}

export function clearMeasureCache() {
  measureCache.clear();
}

// --- Font resolution ---

const FONT_DEFAULTS = {
  fontFamily: 'sans-serif',
  fontSize: '16px',
  fontWeight: '400',
  fontStyle: 'normal',
  lineHeight: 'normal',
};

export function resolveFontInfo(el) {
  if (typeof getComputedStyle === 'undefined' || !el) {
    return { ...FONT_DEFAULTS };
  }
  const style = getComputedStyle(el);
  return {
    fontFamily: style.fontFamily || FONT_DEFAULTS.fontFamily,
    fontSize: style.fontSize || FONT_DEFAULTS.fontSize,
    fontWeight: style.fontWeight || FONT_DEFAULTS.fontWeight,
    fontStyle: style.fontStyle || FONT_DEFAULTS.fontStyle,
    lineHeight: style.lineHeight || FONT_DEFAULTS.lineHeight,
  };
}

export function fontInfoToString(info) {
  return `${info.fontStyle} ${info.fontWeight} ${info.fontSize} ${info.fontFamily}`;
}

// --- Font-ready gate ---

let fontsReadyPromise = null;

export function ensureFontsReady() {
  if (fontsReadyPromise) return fontsReadyPromise;

  if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) {
    // SSR / Node — resolve immediately
    fontsReadyPromise = Promise.resolve();
    return fontsReadyPromise;
  }

  fontsReadyPromise = document.fonts.ready.then(() => {
    // Clear measure cache whenever fonts finish loading
    document.fonts.addEventListener('loadingdone', () => {
      clearMeasureCache();
    });
  });

  return fontsReadyPromise;
}

// --- Measure hook ---

let _hookInvocationCount = 0;

export function measureTextIfEnabled(parent, text) {
  if (!textConfig.measure) return;
  _hookInvocationCount++;
  queueMicrotask(() => {
    if (!parent || !parent.ownerDocument) return;
    if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return;
    const font = resolveFontInfo(parent);
    const fontStr = fontInfoToString(font);
    const width = parent.clientWidth || 0;
    const lineHeight = parseFloat(font.lineHeight) || parseFloat(font.size) * 1.2;
    if (width === 0) return;
    measureText(text, fontStr, width, lineHeight).catch(() => {});
  });
}

export function _wasMeasureHookInvoked() {
  return _hookInvocationCount > 0;
}

export function _resetMeasureHookInvocation() {
  _hookInvocationCount = 0;
}

// --- Test helpers ---

export function _resetTextEngineForTests() {
  textConfig = { ...DEFAULT_CONFIG };
  hasMounted = false;
  pretextModule = null;
  pretextLoadPromise = null;
  measureCache.clear();
  fontsReadyPromise = null;
  _hookInvocationCount = 0;
}
