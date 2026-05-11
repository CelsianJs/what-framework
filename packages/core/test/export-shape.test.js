import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const core = await import('../src/index.js');
const hooks = await import('../src/hooks.js');

describe('core public export shape', () => {
  it('exports advertised hook runtime functions from the main entrypoint', () => {
    for (const name of ['useState', 'useEffect', 'useMemo', 'useCallback', 'useRef']) {
      assert.equal(typeof core[name], 'function', `${name} should be a runtime export`);
      assert.equal(core[name], hooks[name], `${name} should re-export hooks runtime implementation`);
    }
  });
});
