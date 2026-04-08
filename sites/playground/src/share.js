// What Framework Playground — URL Hash Sharing

/**
 * Encode code into a URL-safe hash.
 * Uses base64 encoding with compression-friendly approach.
 */
export function encodeCode(code) {
  try {
    // Use TextEncoder + btoa with URI encoding for Unicode safety
    const encoded = btoa(unescape(encodeURIComponent(code)));
    return encoded;
  } catch (e) {
    console.warn('Failed to encode code for sharing:', e);
    return '';
  }
}

/**
 * Decode code from a URL hash.
 */
export function decodeCode(hash) {
  try {
    if (!hash) return null;
    const code = decodeURIComponent(escape(atob(hash)));
    return code;
  } catch (e) {
    console.warn('Failed to decode shared code:', e);
    return null;
  }
}

/**
 * Update the URL hash with the current code and example ID.
 */
export function updateHash(code, exampleId) {
  const encoded = encodeCode(code);
  if (encoded) {
    const hashStr = exampleId ? `${exampleId}|${encoded}` : encoded;
    history.replaceState(null, '', `#${hashStr}`);
  }
}

/**
 * Read the current hash and return decoded data.
 * @returns {{ code: string|null, exampleId: string|null }}
 */
export function readHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return { code: null, exampleId: null };

  const pipeIdx = hash.indexOf('|');
  if (pipeIdx > 0 && pipeIdx < 40) {
    // Has example ID prefix
    const exampleId = hash.slice(0, pipeIdx);
    const code = decodeCode(hash.slice(pipeIdx + 1));
    return { code, exampleId };
  }

  // Just encoded code, no example ID
  const code = decodeCode(hash);
  return { code, exampleId: null };
}

/**
 * Generate a shareable URL.
 */
export function getShareURL(code, exampleId) {
  const encoded = encodeCode(code);
  const hashStr = exampleId ? `${exampleId}|${encoded}` : encoded;
  return `${window.location.origin}${window.location.pathname}#${hashStr}`;
}

/**
 * Copy text to clipboard.
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  }
}
