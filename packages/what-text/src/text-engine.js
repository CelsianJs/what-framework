// What Text — Optional text engine for What Framework
// Powered by @chenglou/pretext. Registers a text insertion hook with what-core.
// All Pretext access flows through this module.

import { _setTextInsertHook } from 'what-core';
import { isHydrating } from 'what-core/render';

// --- Configuration ---

const KNOWN_KEYS = new Set(['measure', 'cacheSize']);
const DEFAULT_CONFIG = { measure: false, cacheSize: 1000 };
let textConfig = { ...DEFAULT_CONFIG };

export function configureText(overrides) {
  if (!overrides || typeof overrides !== 'object') return;
  for (const key of Object.keys(overrides)) {
    if (KNOWN_KEYS.has(key)) {
      textConfig[key] = overrides[key];
    }
  }
  // Register or unregister the hook with what-core's render.js
  if (textConfig.measure) {
    _setTextInsertHook(measureTextIfEnabled);
  } else {
    _setTextInsertHook(null);
  }
}

export function getTextConfig() {
  return { ...textConfig };
}

// --- Lazy Pretext loader ---

let pretextModule = null;
let pretextLoadPromise = null;

export async function ensurePretext() {
  if (pretextModule) return pretextModule;
  if (pretextLoadPromise) return pretextLoadPromise;
  pretextLoadPromise = import('@chenglou/pretext').then((mod) => {
    pretextModule = mod;
    return mod;
  }).catch((err) => {
    pretextLoadPromise = null;
    throw new Error(
      `[what-text] Failed to load @chenglou/pretext. ` +
      `Install it with: npm install @chenglou/pretext\n` +
      `Original error: ${err.message}`
    );
  });
  return pretextLoadPromise;
}

export function _setPretextForTests(fake) {
  pretextModule = fake;
  pretextLoadPromise = Promise.resolve(fake);
}

export function _getPretextSync() {
  return pretextModule;
}

// --- LRU measure cache ---

const measureCache = new Map();

function cacheGet(key) {
  if (!measureCache.has(key)) return undefined;
  const value = measureCache.get(key);
  measureCache.delete(key);
  measureCache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (measureCache.has(key)) {
    measureCache.delete(key);
  } else if (measureCache.size >= textConfig.cacheSize) {
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
    prepared = pretext.prepareWithSegments(text, font);
    cacheSet(cacheKey, prepared);
  }
  return pretext.layoutWithLines(prepared, containerWidth, lineHeight);
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

// --- Font size parsing (fixes parseFloat bug) ---
// parseFloat('700 14px Inter') returns 700, not 14.
// This extracts the actual font size from a CSS font shorthand.

function parseFontSize(fontStr) {
  const match = fontStr.match(/(\d+(?:\.\d+)?)\s*px/i);
  return match ? parseFloat(match[1]) : 16;
}

// --- Font-ready gate ---

let fontsReadyPromise = null;

export function ensureFontsReady() {
  if (fontsReadyPromise) return fontsReadyPromise;
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.ready) {
    fontsReadyPromise = Promise.resolve();
    return fontsReadyPromise;
  }
  fontsReadyPromise = document.fonts.ready.then(() => {
    document.fonts.addEventListener('loadingdone', () => {
      clearMeasureCache();
    });
  });
  return fontsReadyPromise;
}

// --- Measure hook (registered with what-core via _setTextInsertHook) ---

let _hookInvocationCount = 0;

export function measureTextIfEnabled(parent, text) {
  if (!textConfig.measure) return;
  if (isHydrating()) return;
  _hookInvocationCount++;
  queueMicrotask(() => {
    if (!parent || !parent.ownerDocument) return;
    if (typeof parent.isConnected === 'boolean' && !parent.isConnected) return;
    const font = resolveFontInfo(parent);
    const fontStr = fontInfoToString(font);
    const width = parent.clientWidth || 0;
    const lh = parseFloat(font.lineHeight) || parseFontSize(font.fontSize) * 1.2;
    if (width === 0) return;
    measureText(text, fontStr, width, lh).catch(() => {});
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
  pretextModule = null;
  pretextLoadPromise = null;
  measureCache.clear();
  fontsReadyPromise = null;
  _hookInvocationCount = 0;
  _setTextInsertHook(null);
}
