/**
 * Tests for agent guardrails (packages/core/src/guardrails.js).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureGuardrails,
  getGuardrailConfig,
  validateImports,
} from '../src/guardrails.js';
import { clearDiagnostics } from '../src/diagnostics.js';

describe('guardrails', () => {
  beforeEach(() => {
    clearDiagnostics();
    // Reset guardrails to defaults
    configureGuardrails({
      importValidation: true,
    });
  });

  describe('configureGuardrails', () => {
    it('returns default config', () => {
      assert.deepEqual(getGuardrailConfig(), { importValidation: true });
    });

    it('allows overriding config', () => {
      configureGuardrails({ importValidation: false });
      assert.deepEqual(getGuardrailConfig(), { importValidation: false });
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

    it('points a name the root entry dropped at the module that exports it now', () => {
      const [swr, tween, transition, each] = validateImports(['useSWR', 'useTween', 'transition', 'each']);
      assert.equal(swr.message, '"useSWR" is not exported by what-framework.');
      assert.match(swr.suggestion, /Import it with: import \{ useSWR \} from 'what-framework\/data'\.$/);
      assert.match(tween.suggestion, /^The animation helper formerly named useTransition is useTween\. useTransition and startTransition on the root entry are React's transition API.* import \{ useTween \} from 'what-framework\/motion'\.$/);
      assert.equal(transition.message, '"transition" is not exported by what-framework.');
      assert.match(transition.suggestion, /import \{ transitionClass \} from 'what-framework\/motion'\.$/);
      assert.equal(each.message, '"each" is not exported by what-framework.');
      assert.match(each.suggestion, /^It was removed in 0\.15\. .*\.map\(\) and a key prop/);
    });

    it('accepts React\'s async names, which the root entry exports with React\'s meaning', () => {
      assert.deepEqual(validateImports(['useTransition', 'startTransition', 'useOptimistic', 'use', 'Suspense']), []);
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
