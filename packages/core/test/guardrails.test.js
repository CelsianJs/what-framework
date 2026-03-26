/**
 * Tests for agent guardrails (packages/core/src/guardrails.js).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureGuardrails,
  getGuardrailConfig,
  checkComponentName,
  validateImports,
} from '../src/guardrails.js';
import { clearCollectedErrors } from '../src/errors.js';

describe('guardrails', () => {
  beforeEach(() => {
    clearCollectedErrors();
    // Reset guardrails to defaults
    configureGuardrails({
      signalReadDetection: true,
      effectCycleDetection: true,
      componentNaming: true,
      importValidation: true,
    });
  });

  describe('configureGuardrails', () => {
    it('returns default config', () => {
      const config = getGuardrailConfig();
      assert.equal(config.signalReadDetection, true);
      assert.equal(config.effectCycleDetection, true);
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
