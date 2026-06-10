/**
 * Out-of-the-box flat config tests.
 *
 * Uses the REAL ESLint API (not a fake context) to lint a real .jsx fixture
 * with the shipped presets and zero user configuration. This is exactly what
 * a user gets from:
 *
 *   // eslint.config.js
 *   import what from 'eslint-plugin-what';
 *   export default [what.configs.recommended];
 *
 * Guards against the two historical out-of-the-box failures:
 *   1. Missing `files` glob → config never applied (silent no-op)
 *   2. Missing JSX parser options → "Parsing error: Unexpected token <"
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint, Linter } from 'eslint';
import plugin from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, 'fixture');

function makeESLint(config) {
  return new ESLint({
    cwd: FIXTURE_DIR,
    // Don't search for an eslint.config.js — use ONLY the shipped preset,
    // exactly like a user's one-line flat config.
    overrideConfigFile: true,
    overrideConfig: [config],
  });
}

describe('flat configs work out of the box', () => {
  it('recommended config lints a .jsx fixture with zero extra setup', async () => {
    const eslint = makeESLint(plugin.configs.recommended);
    const results = await eslint.lintFiles(['bad-component.jsx']);

    assert.equal(results.length, 1, 'fixture file should be linted (files glob must match .jsx)');
    const [result] = results;

    // 1. JSX must parse — no fatal "Unexpected token <"
    assert.equal(result.fatalErrorCount, 0,
      `JSX failed to parse: ${JSON.stringify(result.messages.filter(m => m.fatal))}`);

    // 2. Rules must actually fire
    const ruleIds = result.messages.map(m => m.ruleId);
    assert.ok(ruleIds.includes('what/signal-call-in-jsx'),
      `expected what/signal-call-in-jsx to fire, got: ${ruleIds.join(', ')}`);
    assert.ok(ruleIds.includes('what/no-camelcase-events'),
      `expected what/no-camelcase-events to fire, got: ${ruleIds.join(', ')}`);
    assert.ok(result.messages.length >= 3,
      `expected at least 3 findings, got ${result.messages.length}`);
  });

  it('recommended config message reflects compiler auto-wrapping (no "[Function]" claim)', async () => {
    const eslint = makeESLint(plugin.configs.recommended);
    const results = await eslint.lintFiles(['bad-component.jsx']);
    const msg = results[0].messages.find(m => m.ruleId === 'what/signal-call-in-jsx');
    assert.ok(msg, 'signal-call-in-jsx finding expected');
    assert.ok(!msg.message.includes('[Function]'),
      'message must not claim bare signals render "[Function]" — the compiler auto-wraps them');
    assert.ok(/auto-wrap/i.test(msg.message),
      `message should mention compiler auto-wrapping, got: ${msg.message}`);
  });

  it('strict config lints the same fixture as errors', async () => {
    const eslint = makeESLint(plugin.configs.strict);
    const results = await eslint.lintFiles(['bad-component.jsx']);
    const [result] = results;
    assert.equal(result.fatalErrorCount, 0);
    assert.ok(result.errorCount >= 2, `strict should report errors, got ${result.errorCount}`);
  });

  it('compiler config still parses JSX and disables signal-call-in-jsx', async () => {
    const eslint = makeESLint(plugin.configs.compiler);
    const results = await eslint.lintFiles(['bad-component.jsx']);
    const [result] = results;
    assert.equal(result.fatalErrorCount, 0);
    const ruleIds = result.messages.map(m => m.ruleId);
    assert.ok(!ruleIds.includes('what/signal-call-in-jsx'),
      'compiler config should turn signal-call-in-jsx off (compiler handles wrapping)');
  });

  it('all presets carry files globs and JSX language options', () => {
    for (const name of ['recommended', 'strict', 'compiler']) {
      const config = plugin.configs[name];
      assert.deepEqual(config.files, ['**/*.{js,jsx,ts,tsx}'], `${name}: files glob`);
      assert.equal(config.languageOptions.parserOptions.ecmaFeatures.jsx, true, `${name}: jsx enabled`);
      assert.equal(config.languageOptions.sourceType, 'module', `${name}: sourceType`);
      assert.equal(config.languageOptions.ecmaVersion, 'latest', `${name}: ecmaVersion`);
    }
  });

  it('plugin meta version matches package.json (no stale hardcoded version)', async () => {
    const { readFile } = await import('node:fs/promises');
    const pkg = JSON.parse(await readFile(join(__dirname, '..', 'package.json'), 'utf8'));
    assert.equal(plugin.meta.version, pkg.version);
  });

  it('plain .js files (no JSX) also lint with the recommended config', () => {
    const linter = new Linter();
    const code = [
      "import { signal, effect } from 'what-framework';",
      "const count = signal(0);",
      "effect(() => { console.log(count()); });",
    ].join('\n');
    const messages = linter.verify(code, [plugin.configs.recommended], { filename: join(FIXTURE_DIR, 'ok.js') });
    const fatal = messages.filter(m => m.fatal);
    assert.equal(fatal.length, 0, `unexpected parse errors: ${JSON.stringify(fatal)}`);
  });
});
