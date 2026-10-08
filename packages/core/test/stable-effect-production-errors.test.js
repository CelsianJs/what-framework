import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const reactiveURL = new URL('../src/reactive.js', import.meta.url).href;

describe('stable effects report production update failures', () => {
  for (const batched of [false, true]) {
    it(`${batched ? 'batched' : 'inline'} failures are reported without stopping siblings or later updates`, () => {
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import assert from 'node:assert/strict';
        import { signal, effect, batch, flushSync, __DEV__ } from ${JSON.stringify(reactiveURL)};
        assert.equal(__DEV__, false);
        const errors = [];
        console.error = (...args) => errors.push(args);
        const source = signal(0);
        const seen = [];
        const disposeBroken = effect(() => {
          if (source() === 1 || source() === 3) throw new Error('stable failure');
          seen.push('a:' + source());
        }, { stable: true });
        const disposeSibling = effect(() => seen.push('b:' + source()), { stable: true });
        seen.length = 0;
        assert.doesNotThrow(() => {
          ${batched ? 'batch(() => source.set(1));' : 'source.set(1);'}
          flushSync();
        });
        assert.deepEqual(seen, ['b:1']);
        assert.equal(errors.length, 1, 'report each update failure once');
        assert.equal(errors[0][0], '[what] Uncaught error in effect during update:');
        assert.equal(errors[0][1].message, 'stable failure');
        source.set(2);
        flushSync();
        assert.deepEqual(seen, ['b:1', 'a:2', 'b:2']);
        console.error = () => { throw new Error('console failure'); };
        assert.doesNotThrow(() => {
          ${batched ? 'batch(() => source.set(3));' : 'source.set(3);'}
          flushSync();
        });
        assert.deepEqual(seen, ['b:1', 'a:2', 'b:2', 'b:3']);
        disposeBroken();
        disposeSibling();
      `], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' } });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    });
  }
});
