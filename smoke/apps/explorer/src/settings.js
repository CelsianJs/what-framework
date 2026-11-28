// The publishing settings of 50 packages: six fields each, 300 in all, plus
// the organisation scope the packages publish under.
//
// Every rule is wrapped in a counter (`ruleRuns`), so the smoke check can
// tell which fields' rules a keystroke ran. The scope is checked against a
// simulated registry that answers slowly for a name that is taken (it looks
// up the owner) and quickly for a free one, so the answers for a name typed
// quickly past a taken one arrive out of order.

import { rules, simpleResolver } from 'what-framework/form';

import { PACKAGE_COUNT, TAKEN_SCOPES } from './settings-data.js';

export { FIELDS_PER_PACKAGE, LICENSES, PACKAGE_COUNT, defaultSettings } from './settings-data.js';

export const ruleRuns = Object.create(null);
const counted = (field, list) => list.map((rule) => (value, values) => {
  ruleRuns[field] = (ruleRuns[field] || 0) + 1;
  return rule(value, values);
});

const RULES = { scope: counted('scope', [rules.required(), rules.minLength(3), rules.pattern(/^[a-z][a-z-]*$/, 'Lowercase letters and dashes')]) };
for (let i = 0; i < PACKAGE_COUNT; i++) {
  RULES[`name${i}`] = counted(`name${i}`, [rules.required(), rules.pattern(/^[a-z][a-z0-9-]{1,30}$/, 'Lowercase, digits and dashes')]);
  RULES[`version${i}`] = counted(`version${i}`, [rules.required(), rules.pattern(/^\d+\.\d+\.\d+$/, 'major.minor.patch')]);
  RULES[`license${i}`] = counted(`license${i}`, [rules.required()]);
  RULES[`budget${i}`] = counted(`budget${i}`, [rules.required(), rules.min(1, 'At least 1 KB'), rules.max(500, 'At most 500 KB')]);
  RULES[`owner${i}`] = counted(`owner${i}`, [rules.required(), rules.email()]);
  RULES[`notes${i}`] = counted(`notes${i}`, [rules.maxLength(140)]);
}

// The registry: 400 ms to answer for a taken name, 30 ms for a free one.
export const registry = { lookups: 0, pending: 0 };
function lookupScope(scope) {
  registry.lookups++;
  registry.pending++;
  const latency = TAKEN_SCOPES.includes(scope) ? 400 : 30;
  return new Promise((resolve) => setTimeout(() => {
    registry.pending--;
    resolve(TAKEN_SCOPES.includes(scope));
  }, latency));
}

const simple = simpleResolver(RULES);

// The rule map for every field, then the registry for the scope. A resolver
// is told which fields a validation is for (`options.names`), and asks the
// registry only when the scope is one of them.
export async function settingsResolver(values, context, options) {
  const result = await simple(values, context, options);
  const names = options?.names;
  if (!result.errors.scope && (!names || names.includes('scope'))) {
    if (await lookupScope(values.scope)) result.errors.scope = { type: 'taken', message: `@${values.scope} is taken` };
  }
  return result;
}

if (typeof window !== 'undefined') window.__form = { ruleRuns, registry, renders: Object.create(null) };
