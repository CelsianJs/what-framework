import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = new URL('../../../', import.meta.url);
const read = (provider, name) => readFileSync(new URL(`${provider}/workflows/${name}.yml`, root), 'utf8');
const pins = new Map([
  ['actions/checkout', '3d3c42e5aac5ba805825da76410c181273ba90b1'],
  ['actions/setup-node', '949feb2413d6458794dcd2491c4babbbce0c15c1'],
  ['actions/cache', '55cc8345863c7cc4c66a329aec7e433d2d1c52a9'],
  ['actions/upload-artifact', 'cf430e030ddbb5b0abf93d22962f4752f3646cd9'],
]);

// Compare the executable YAML body, allowing only provider runner differences
// and comments/spacing. Syntax is additionally checked with a YAML parser in QA.
function executableBody(source) {
  return source.slice(source.indexOf('\npermissions:')).split('\n')
    .map(line => line.replace('depot-ubuntu-latest', 'ubuntu-latest').replace(/\s+#.*$/, '').trim())
    .filter(line => line && !line.startsWith('#')).join('\n');
}

function job(source, name) {
  const start = source.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `missing job ${name}`);
  const tail = source.slice(start + 1);
  const next = tail.slice(1).search(/^ {2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? tail : tail.slice(0, next + 1);
}

test('Depot is authoritative and every fallback preserves the executable policy', () => {
  for (const name of ['ci', 'size', 'benchmarks']) {
    const depot = read('.depot', name);
    const github = read('.github', name);
    assert.equal(executableBody(github), executableBody(depot), name);
    assert.match(github, /on:\n\s+workflow_dispatch:/);
    assert.doesNotMatch(github, /^ {2}(push|pull_request|schedule):/m);
    assert.match(depot, name === 'benchmarks' ? /^ {2}schedule:/m : /^ {2}pull_request:/m);
  }
});

test('all mirrored actions use the verified immutable official commits', () => {
  for (const provider of ['.depot', '.github']) {
    for (const name of ['ci', 'size', 'benchmarks']) {
      for (const [, action, sha] of read(provider, name).matchAll(/uses: ([\w/-]+)@([^\s]+)/g)) {
        assert.equal(sha, pins.get(action), `${provider}/${name}: ${action}`);
        assert.match(sha, /^[a-f0-9]{40}$/);
      }
    }
  }
});

test('current runtime coverage keeps Node 20 explicitly legacy without changing engines', () => {
  for (const provider of ['.depot', '.github']) {
    const ci = read(provider, 'ci');
    assert.match(ci, /Node 20 is an explicit legacy compatibility lane/);
    assert.match(ci, /node-version: \[20, 22, 24, 26\]/);
    assert.match(job(ci, 'test'), /WHAT_REQUIRE_BROWSER_TESTS: '1'/);
    for (const name of ['ci', 'size', 'benchmarks']) {
      const literalVersions = [...read(provider, name).matchAll(/node-version: (\d+)\b/g)].map(match => Number(match[1]));
      assert.ok(literalVersions.length > 0);
      assert.ok(literalVersions.every(version => version === 24));
    }
  }
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  assert.equal(pkg.engines.node, '>=20');
});

test('documentation metadata, build and Chromium contracts are mandatory; WebKit is native acceptance', () => {
  for (const provider of ['.depot', '.github']) {
    const ci = read(provider, 'ci');
    const docs = job(ci, 'docs-site');
    for (const command of ['check', 'test:templates', 'build', 'test:templates:ui']) {
      assert.ok(docs.includes(`npm run -s ${command} --prefix docs-site`), command);
    }
    assert.match(docs, /playwright install --with-deps chromium/);
    assert.match(docs, /does\n\s+# not claim to verify external starter checkouts/);
    assert.doesNotMatch(docs, /continue-on-error: true/);
    const webkit = job(ci, 'webkit-native');
    assert.match(webkit, /playwright install --with-deps webkit/);
    assert.match(webkit, /node smoke\/native-acceptance\.mjs --browser=webkit/);
    assert.doesNotMatch(webkit, /continue-on-error: true/);
  }
});

test('read-only workflows cancel stale refs and benchmark writes are job-scoped', () => {
  for (const provider of ['.depot', '.github']) {
    for (const name of ['ci', 'size']) {
      const source = read(provider, name);
      assert.match(source, /permissions:\n {2}contents: read/);
      assert.match(source, /group: .*\$\{\{ github.ref \}\}/);
      assert.match(source, /cancel-in-progress: true/);
      assert.doesNotMatch(source, /contents: write|pull-requests: write/);
    }
    const benchmarks = read(provider, 'benchmarks');
    assert.match(benchmarks, /permissions:\n {2}contents: read/);
    assert.match(job(benchmarks, 'update-benchmarks'), /permissions:\n {6}contents: write\n {6}pull-requests: write/);
    assert.match(benchmarks, /cancel-in-progress: false/);
    assert.doesNotMatch(benchmarks, /VERCEL_TOKEN|deploy-vercel|git push\s*$|git push.*(?:origin main|HEAD:main|--force)/m);
    assert.match(benchmarks, /if: always\(\) && steps.diff.outputs.changed == 'true'/);
    assert.match(benchmarks, /if-no-files-found: error/);
  }
});

test('benchmark refresh only pushes a review branch and preserves an actionable denied-PR fallback', () => {
  const source = read('.depot', 'benchmarks');
  const section = source.slice(source.indexOf('      - name: Propose benchmark refresh'));
  const block = section.match(/ {8}run: \|\n([\s\S]*?)(?= {6}- name:)/)?.[1];
  assert.ok(block, 'missing benchmark proposal shell');
  const shell = block.split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
  for (const denied of [false, true]) {
    const fixture = mkdtempSync(join(tmpdir(), 'what-benchmark-pr-contract-'));
    try {
      const summary = join(fixture, 'summary');
      // Shell functions intercept every Git/provider command: this test never
      // contacts GitHub or changes a checkout, even on the success path.
      const result = spawnSync('bash', ['-c', `git() { printf 'MOCK_GIT:%s\\n' "$*"; }\ngh() { printf 'MOCK_GH:%s\\n' "$*"; return ${denied ? 1 : 0}; }\n${shell}`], {
        encoding: 'utf8',
        env: { ...process.env, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'CelsianJs/what-framework', GITHUB_STEP_SUMMARY: summary },
      });
      assert.equal(result.status, denied ? 1 : 0, result.stderr);
      assert.match(result.stdout, /MOCK_GIT:push origin HEAD:refs\/heads\/chore\/benchmark-refresh-123-2/);
      assert.match(result.stdout, /MOCK_GH:pr create .*--base main --head chore\/benchmark-refresh-123-2/);
      assert.match(result.stdout, /Constraint: Main changes require a pull request/);
      const proof = readFileSync(summary, 'utf8');
      assert.match(proof, /Maintainer PR fallback: https:\/\/github.com\/CelsianJs\/what-framework\/compare\/main\.\.\.chore\/benchmark-refresh-123-2\?expand=1/);
      assert.match(proof, /nothing has been published/);
      if (denied) {
        assert.match(result.stdout, /::error::Automatic PR creation was denied or failed/);
        assert.match(proof, /Maintainer action is required; no publication occurred/);
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});
