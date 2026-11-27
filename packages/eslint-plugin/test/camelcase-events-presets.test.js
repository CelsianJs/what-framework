// What's runtime takes React's event names in every JSX pipeline: h(), the
// automatic runtime the islands template uses (jsxImportSource), and compiled
// JSX all map onClick to `click`, onDoubleClick to `dblclick` and onChange to
// `input` and `change`. So no preset reports onClick, and the rule, kept for a
// codebase that wants the DOM's names, does not say the camelCase name fails.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Linter } from 'eslint';
import plugin from '../src/index.js';

const SOURCE = `import { signal } from 'what-framework';
export function Toggle() {
  const on = signal(false);
  return <button onClick={() => on((v) => !v)} onDoubleClick={() => on(false)} onChange={() => {}}>{() => (on() ? 'on' : 'off')}</button>;
}
`;

const lint = (config) => new Linter().verify(SOURCE, [config], { filename: 'Toggle.jsx' });

describe('no-camelcase-events and the presets', () => {
  for (const name of ['recommended', 'strict', 'compiler']) {
    it(`the ${name} preset reports no camelCase event name`, () => {
      const found = lint(plugin.configs[name]).filter((m) => m.ruleId === 'what/no-camelcase-events' || m.fatal);
      assert.deepEqual(found.map((m) => `${m.line}:${m.column} ${m.message}`), []);
    });
  }

  it('turned on by hand, it asks for the DOM name without saying the camelCase one fails', () => {
    const config = { ...plugin.configs.recommended, rules: { 'what/no-camelcase-events': 'warn' } };
    const found = lint(config).filter((m) => m.ruleId === 'what/no-camelcase-events');
    assert.equal(found.length, 3);
    for (const m of found) assert.doesNotMatch(m.message, /won't work|does not work/, m.message);
    assert.match(found[0].message, /onclick/);
    assert.equal(plugin.rules['no-camelcase-events'].meta.docs.recommended, false);
  });
});
