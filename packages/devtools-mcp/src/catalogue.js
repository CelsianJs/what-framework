/**
 * The error catalogue as the MCP tools see it: what-core's ERROR_CODES, the
 * same entries the runtime reports with and docs/ERRORS.md is generated from.
 *
 * Lookup never guesses. A code, a message containing a code, or a message
 * that matches exactly one catalogue template resolves; anything else returns
 * the closest codes and lets the agent choose. A keyword table would guess:
 * it would send "render" to ERR_SIGNAL_WRITE_IN_RENDER, so ERR_HOOK_OUTSIDE_RENDER
 * would come back with the wrong fix.
 */

import { getErrorDefinition } from 'what-core';
import { ERROR_CODES } from 'what-core/internal';

const DEFINITIONS = Object.values(ERROR_CODES);

function templatePattern(template) {
  const parts = template.split(/\{\{\w+\}\}/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(parts.join('[\\s\\S]+?'), 'i');
}

// A template that is only a placeholder ('{{message}}') matches everything.
/** @type {Array<[import('what-core').ErrorCodeDefinition, RegExp]>} */
const TEMPLATE_PATTERNS = DEFINITIONS
  .filter((def) => def.template.replace(/\{\{\w+\}\}/g, '').replace(/\W/g, '').length >= 12)
  .map((def) => [def, templatePattern(def.template.replace(/^\[[\w-]+\]\s*/, ''))]);

function words(text) {
  return new Set(text.toLowerCase().replace(/^err_/, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2));
}

/** The three codes whose names share the most words with the input. */
function closestCodes(input, count = 3) {
  const wanted = words(input);
  return DEFINITIONS
    .map((def) => {
      const name = words(def.code);
      let shared = 0;
      for (const w of name) if (wanted.has(w)) shared++;
      return { code: def.code, score: shared / Math.max(name.size, 1) };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
    .slice(0, count)
    .map((c) => c.code);
}

/**
 * Resolve a code or an error message to one catalogue entry.
 * @param {string} input
 * @returns {{ def: import('what-core').ErrorCodeDefinition, via: 'code' | 'message' } | { def: null, closest: string[] }}
 */
export function lookup(input) {
  const text = String(input).trim();
  const upper = text.toUpperCase();
  const direct = getErrorDefinition(upper) || getErrorDefinition(`ERR_${upper}`) || ERROR_CODES[upper];
  if (direct) return { def: direct, via: 'code' };

  const mentioned = [...new Set(text.match(/ERR_[A-Z0-9_]+/g) || [])].flatMap((code) => getErrorDefinition(code) ?? []);
  if (mentioned.length === 1) return { def: mentioned[0], via: 'code' };

  const matches = TEMPLATE_PATTERNS.filter(([, re]) => re.test(text)).map(([def]) => def);
  if (matches.length === 1) return { def: matches[0], via: 'message' };

  return { def: null, closest: closestCodes(text) };
}

export { ERROR_CODES, getErrorDefinition };
