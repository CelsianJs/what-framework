import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAMEWORK_LABELS, parseArgs, verifyBundledPackages } from '../../../benchmark/krausest/bench.mjs';

test('default and quick profiles select the documented CPU rates', () => {
  const frameworks = Object.keys(FRAMEWORK_LABELS);
  assert.deepEqual(parseArgs([]), { quick: false, throttle: [1, 4], frameworks });
  assert.deepEqual(parseArgs(['--quick']), { quick: true, throttle: [1], frameworks });
});

test('throttle rates and frameworks are deduplicated in their documented order', () => {
  assert.deepEqual(parseArgs(['solid2', '--throttle=4,1,4', 'what', 'solid2']), {
    quick: false, throttle: [4, 1], frameworks: ['what', 'solid2'],
  });
  assert.deepEqual(parseArgs(['--throttle', '2.5', '--quick', 'what']).throttle, [2.5]);
});

test('invalid throttle rates, options and framework names fail', () => {
  for (const args of [['--throttle'], ['--throttle='], ['--throttle=1,'], ['--throttle', '0'], ['--throttle=Infinity'], ['--throttle=fast']]) {
    assert.throws(() => parseArgs(args), /Invalid --throttle/);
  }
  assert.throws(() => parseArgs(['--timing']), /Unknown option --timing/);
  assert.throws(() => parseArgs(['solid3']), /Unknown framework solid3/);
});

test('component-per-row variants run only when named, each after the app it is a variant of', () => {
  assert.deepEqual(parseArgs(['what']).frameworks, ['what']);
  assert.deepEqual(parseArgs(['solid2-rows', 'what-rows', 'what', 'solid2']).frameworks, ['what', 'what-rows', 'solid2', 'solid2-rows']);
  assert.deepEqual(parseArgs(['solid-rows']).frameworks, ['solid-rows']);
  assert.throws(() => parseArgs(['react-rows']), /Unknown framework react-rows/);
});

const pkg = (name, version) => ({ name, version });

test('bundle labels accept exactly the required major or minor versions', () => {
  verifyBundledPackages('what', null);
  verifyBundledPackages('vanilla', null);
  verifyBundledPackages('react', [pkg('react', '19.2.4'), pkg('react-dom', '19.2.4')]);
  verifyBundledPackages('solid', [pkg('solid-js', '1.9.20')]);
  verifyBundledPackages('solid2', [
    pkg('solid-js', '2.0.0-beta.15'), pkg('@solidjs/web', '2.0.0-beta.15'), pkg('@solidjs/signals', '2.0.3'),
  ]);
});

test('a component-per-row variant must bundle the Solid major its label names', () => {
  verifyBundledPackages('what-rows', null);
  verifyBundledPackages('solid-rows', [pkg('solid-js', '1.9.20')]);
  assert.throws(() => verifyBundledPackages('solid-rows', [pkg('solid-js', '2.0.3')]), /solid-js@1.9/);
  assert.throws(() => verifyBundledPackages('solid2-rows', [pkg('solid-js', '1.9.20')]), /solid-js@2.0/);
});

test('bundle labels reject missing manifests, incorrect versions and duplicate versions', () => {
  assert.throws(() => verifyBundledPackages('react', null), /packages.json missing/);
  assert.throws(() => verifyBundledPackages('react', [pkg('react', '19.0.0')]), /react-dom@19.*found none/);
  assert.throws(() => verifyBundledPackages('solid', [pkg('solid-js', '1.90.0')]), /solid-js@1.9.*found 1.90.0/);
  assert.throws(() => verifyBundledPackages('solid', [
    pkg('solid-js', '1.9.1'), pkg('solid-js', '1.9.2'),
  ]), /solid-js@1.9.*found 1.9.1, 1.9.2/);
});

test('Solid 1.9 fails verification when its bundle includes a Solid 2.0 package', () => {
  for (const name of ['@solidjs/signals', '@solidjs/web']) {
    assert.throws(() => verifyBundledPackages('solid', [
      pkg('solid-js', '1.9.20'), pkg(name, '2.0.0'),
    ]), /must not bundle/);
  }
});
