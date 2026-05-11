// What Framework - DOM/SSR security helpers
// Shared by runtime render paths to keep URL-attribute handling consistent.

const URL_ATTRS = new Set([
  'href',
  'src',
  'action',
  'formaction',
  'poster',
  'cite',
  'background',
  'xlink:href',
]);

const URL_LIST_ATTRS = new Set(['srcset']);

function normalizeAttrName(name) {
  return String(name).toLowerCase();
}

function normalizeUrlForProtocolCheck(url) {
  return String(url).trim().replace(/[\s\x00-\x1f\x7f]/g, '').toLowerCase();
}

export function isSafeUrlValue(value) {
  if (typeof value !== 'string') return true;
  const normalized = normalizeUrlForProtocolCheck(value);
  return !(
    normalized.startsWith('javascript:') ||
    normalized.startsWith('data:') ||
    normalized.startsWith('vbscript:')
  );
}

function isSafeSrcsetValue(value) {
  if (typeof value !== 'string') return true;
  return value
    .split(',')
    .every(candidate => {
      const url = candidate.trim().split(/\s+/, 1)[0] || '';
      return url === '' || isSafeUrlValue(url);
    });
}

export function isUrlAttribute(name) {
  return URL_ATTRS.has(normalizeAttrName(name));
}

export function isUrlListAttribute(name) {
  return URL_LIST_ATTRS.has(normalizeAttrName(name));
}

export function isSafeUrlAttributeValue(name, value) {
  if (isUrlListAttribute(name)) return isSafeSrcsetValue(value);
  if (isUrlAttribute(name)) return isSafeUrlValue(value);
  return true;
}

export function getDomAttributeName(name) {
  if (name === 'className') return 'class';
  if (name === 'htmlFor') return 'for';
  return normalizeAttrName(name) === 'formaction' ? 'formaction' : name;
}
