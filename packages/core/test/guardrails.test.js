/**
 * Tests for agent guardrails (packages/core/src/guardrails.js).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureGuardrails,
  getGuardrailConfig,
  installSignalReadGuardrail,
  checkComponentName,
  validateImports,
} from '../src/guardrails.js';
import { clearCollectedErrors, getCollectedErrors } from '../src/errors.js';

describe('guardrails', () => {
  beforeEach(() => {
    clearCollectedErrors();
    // Reset guardrails to defaults
    configureGuardrails({
      signalReadDetection: true,
      componentNaming: true,
      importValidation: true,
    });
  });

  describe('configureGuardrails', () => {
    it('returns default config', () => {
      const config = getGuardrailConfig();
      assert.equal(config.signalReadDetection, true);
      assert.equal(config.componentNaming, true);
      assert.equal(config.importValidation, true);
    });

    it('allows overriding config', () => {
      configureGuardrails({ componentNaming: false });
      const config = getGuardrailConfig();
      assert.equal(config.componentNaming, false);
      assert.equal(config.signalReadDetection, true); // unchanged
    });
  });

  describe('installSignalReadGuardrail', () => {
    // Use a plain accessor as a stand-in for a signal: the guardrail only
    // needs a callable that returns the current value.
    function fakeSignal(value) {
      const fn = () => value;
      return fn;
    }

    function withMutedWarn(run) {
      const orig = console.warn;
      const warnings = [];
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        run(warnings);
      } finally {
        console.warn = orig;
      }
      return warnings;
    }

    it('returns the same signal function', () => {
      const sig = fakeSignal(1);
      withMutedWarn(() => {
        assert.equal(installSignalReadGuardrail(sig, 'count'), sig);
      });
    });

    it('warns on string coercion and still yields the value', () => {
      const sig = installSignalReadGuardrail(fakeSignal(42), 'count');
      const warnings = withMutedWarn(() => {
        assert.equal(`Total: ${sig}`, 'Total: 42');
      });
      assert.equal(warnings.length, 1);
      assert.ok(warnings[0].includes('count'), `warning should name the signal: ${warnings[0]}`);
      const collected = getCollectedErrors();
      assert.ok(collected.some(e => e.code === 'ERR_MISSING_SIGNAL_READ'),
        'coercion should collect ERR_MISSING_SIGNAL_READ');
    });

    it('warns on numeric coercion and still yields the value', () => {
      const sig = installSignalReadGuardrail(fakeSignal(10), 'count');
      const warnings = withMutedWarn(() => {
        assert.equal(sig + 5, 15);
        assert.equal(sig > 5, true);
      });
      assert.ok(warnings.length >= 2);
      assert.ok(getCollectedErrors().some(e => e.code === 'ERR_MISSING_SIGNAL_READ'));
    });

    it('does not warn on a normal call', () => {
      const sig = installSignalReadGuardrail(fakeSignal(7), 'count');
      const warnings = withMutedWarn(() => {
        assert.equal(sig(), 7);
      });
      assert.equal(warnings.length, 0);
      assert.equal(getCollectedErrors().length, 0);
    });

    it('respects disabled config (signal left untouched)', () => {
      configureGuardrails({ signalReadDetection: false });
      const sig = fakeSignal(3);
      const before = sig.toString;
      installSignalReadGuardrail(sig, 'count');
      assert.equal(sig.toString, before, 'toString must not be overridden when disabled');
    });
  });

  describe('agent context version', () => {
    it('__WHAT_AGENT__.version matches package.json (no stale hardcoded version)', async () => {
      const { installAgentContext } = await import('../src/agent-context.js');
      const { readFile } = await import('node:fs/promises');
      const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      installAgentContext();
      assert.ok(globalThis.__WHAT_AGENT__, 'installAgentContext should set the global in dev');
      assert.equal(globalThis.__WHAT_AGENT__.version, pkg.version);
      delete globalThis.__WHAT_AGENT__;
    });
  });

  describe('checkComponentName', () => {
    it('accepts PascalCase names', () => {
      assert.equal(checkComponentName('MyComponent'), null);
      assert.equal(checkComponentName('App'), null);
      assert.equal(checkComponentName('X'), null);
      assert.equal(checkComponentName('Counter123'), null);
    });

    it('warns on non-PascalCase names', () => {
      const result = checkComponentName('myComponent');
      assert.ok(result);
      assert.equal(result.code, 'WARN_COMPONENT_NAMING');
      assert.ok(result.suggestion.includes('MyComponent'));
    });

    it('warns on lowercase names', () => {
      const result = checkComponentName('counter');
      assert.ok(result);
      assert.ok(result.suggestion.includes('Counter'));
    });

    it('returns null for null/empty names', () => {
      assert.equal(checkComponentName(null), null);
      assert.equal(checkComponentName(''), null);
    });

    it('respects disabled config', () => {
      configureGuardrails({ componentNaming: false });
      const result = checkComponentName('myComponent');
      assert.equal(result, null); // no warning when disabled
    });
  });

  describe('validateImports', () => {
    it('accepts valid imports', () => {
      const invalid = validateImports(['signal', 'computed', 'effect', 'batch']);
      assert.equal(invalid.length, 0);
    });

    it('accepts hooks', () => {
      const invalid = validateImports(['useState', 'useEffect', 'useMemo', 'useRef']);
      assert.equal(invalid.length, 0);
    });

    it('accepts components', () => {
      const invalid = validateImports(['Show', 'For', 'Switch', 'Match', 'Suspense']);
      assert.equal(invalid.length, 0);
    });

    it('accepts data exports', () => {
      const invalid = validateImports(['useSWR', 'useQuery', 'invalidateQueries']);
      assert.equal(invalid.length, 0);
    });

    it('detects invalid imports', () => {
      const invalid = validateImports(['signal', 'nonExistent', 'alsoFake']);
      assert.equal(invalid.length, 2);
      assert.ok(invalid[0].name === 'nonExistent');
      assert.ok(invalid[0].message.includes('not a valid export'));
    });

    it('suggests close matches', () => {
      const invalid = validateImports(['singal']); // typo of 'signal'
      assert.equal(invalid.length, 1);
      assert.ok(invalid[0].suggestion.includes('signal'));
    });

    it('returns empty for empty input', () => {
      const invalid = validateImports([]);
      assert.equal(invalid.length, 0);
    });

    it('respects disabled config', () => {
      configureGuardrails({ importValidation: false });
      const invalid = validateImports(['totallyFake']);
      assert.equal(invalid.length, 0); // no errors when disabled
    });
  });
});
