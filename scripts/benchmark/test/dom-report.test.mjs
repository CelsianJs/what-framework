import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDomReport } from '../../../benchmark/dom-gate.mjs';
import { OPS, captureBrowserProvenance } from '../../../benchmark/krausest/bench.mjs';

const names = ['create1k', 'replace1k', 'partialUpdate', 'selectRow', 'swapRows', 'removeRow', 'create10k', 'append1k', 'clear1k'];

function round(offset = 0, samplesHeavy = 5) {
  return {
    browser: { version: '151.0.7922.34', revision: '@engine-revision', commandLine: ['chrome-headless-shell', '--headless'] },
    results: {
      what: Object.fromEntries(OPS.map((op) => [op.id, {
        samples: Array.from({ length: op.heavy ? samplesHeavy : 10 }, (_, i) => offset + i + 1),
      }])),
    },
  };
}

test('report retains the gate names, pooled p25, spread and thresholds', () => {
  const report = createDomReport([round(), round(10)]);
  assert.deepEqual(report.results.map(({ name }) => name), names);
  for (const row of report.results) {
    assert.equal(row.ms, row.name === 'create10k' ? 3 : 6);
    assert.equal(row.spread, 10);
  }
  assert.equal(report.aggregate, 'p25 of pooled samples');
  assert.equal(report.metric, 'ms');
  assert.equal(report.lowerIsBetter, true);
  assert.equal(report.noiseFloorMs, 0.5);
});

test('actual counts and raw samples distinguish heavy ops from ordinary ops', () => {
  const rounds = [round(), round(10)];
  rounds[0].results.what.create1k.samples.reverse();
  const before = structuredClone(rounds);
  const report = createDomReport(rounds);
  assert.equal(report.rounds, 2);
  assert.equal(report.samplesPerRound.create1k, 10);
  assert.equal(report.samplesPerRound.create10k, 5);
  for (const row of report.results) {
    const op = OPS[names.indexOf(row.name)];
    assert.deepEqual(row.samples, rounds.map((r) => r.results.what[op.id].samples));
    assert.deepEqual(row.sampleCounts, op.heavy ? [5, 5] : [10, 10]);
    assert.equal(row.sampleCount, op.heavy ? 10 : 20);
  }
  assert.deepEqual(rounds, before, 'aggregation must not sort or mutate raw samples');
});

test('reduced heavy sampling is counted from samples, not assumed to be five', () => {
  const report = createDomReport([round(0, 2), round(10, 2)]);
  const heavy = report.results.find(({ name }) => name === 'create10k');
  assert.equal(report.samplesPerRound.create10k, 2);
  assert.deepEqual(heavy.sampleCounts, [2, 2]);
  assert.equal(heavy.sampleCount, 4);
  assert.equal(heavy.ms, 2);
  assert.equal(heavy.spread, 10);
});

test('unequal round sizes retain exact counts instead of claiming a common count', () => {
  const report = createDomReport([round(0, 2), round(10, 5)]);
  assert.equal(report.samplesPerRound.create10k, null);
  assert.deepEqual(report.results.find(({ name }) => name === 'create10k').sampleCounts, [2, 5]);
});

test('every browser run and installed toolchain stay available after JSON serialization', () => {
  const runs = [round(), round()];
  runs[1].browser.revision = '@different-revision';
  const provenance = {
    toolchain: { playwright: '1.62.1', playwrightCore: '1.62.1', expectedChromiumRevision: '1234' },
    buildPerformed: false,
  };
  const report = JSON.parse(JSON.stringify(createDomReport(runs, provenance)));
  assert.equal(report.node, process.version);
  assert.equal(report.nodeExecutable, process.execPath);
  assert.deepEqual(report.toolchain, provenance.toolchain);
  assert.equal(report.buildPerformed, false);
  assert.deepEqual(report.browsers, runs.map((r) => r.browser));
});

test('missing and invalid samples fail report generation rather than hide data loss', () => {
  assert.throws(() => createDomReport([]), /at least one round/i);
  const missing = round();
  delete missing.results.what.create1k;
  assert.throws(() => createDomReport([missing]), /create1k.*round 1/);
  for (const samples of [[], [NaN], [Infinity], [-1]]) {
    const run = round();
    run.results.what.create1k.samples = samples;
    assert.throws(() => createDomReport([run]), /create1k.*round 1/);
  }
});

test('browser provenance uses the launched browser CDP revision and command line', async () => {
  const calls = [];
  const session = {
    async send(method) {
      calls.push(method);
      return method === 'Browser.getVersion'
        ? { product: 'HeadlessChrome/151.0.7922.34', revision: '@actual-revision', protocolVersion: '1.3', userAgent: 'test-UA', jsVersion: '15.1' }
        : { arguments: ['/actual/chrome-headless-shell', '--headless', '--enable-automation'] };
    },
    async detach() { calls.push('detach'); },
  };
  const browser = { version: () => '151.0.7922.34', newBrowserCDPSession: async () => session };
  assert.deepEqual(await captureBrowserProvenance(browser), {
    version: '151.0.7922.34', product: 'HeadlessChrome/151.0.7922.34', revision: '@actual-revision', protocolVersion: '1.3', userAgent: 'test-UA', jsVersion: '15.1',
    commandLine: ['/actual/chrome-headless-shell', '--headless', '--enable-automation'],
    commandLineError: null,
  });
  assert.deepEqual(calls, ['Browser.getVersion', 'Browser.getBrowserCommandLine', 'detach']);
});

test('unavailable command-line metadata is explicit without changing launch flags', async () => {
  let detached = false;
  const browser = {
    version: () => '151.0.7922.34',
    newBrowserCDPSession: async () => ({
      send: async (method) => {
        if (method === 'Browser.getVersion') return { revision: '@actual-revision' };
        throw new Error('Command line not returned because --enable-automation not set.');
      },
      detach: async () => { detached = true; },
    }),
  };
  const provenance = await captureBrowserProvenance(browser);
  assert.equal(provenance.revision, '@actual-revision');
  assert.equal(provenance.commandLine, null);
  assert.match(provenance.commandLineError, /--enable-automation not set/);
  assert.equal(detached, true);
});

test('browser metadata failures detach the CDP session and remain visible', async () => {
  let detached = false;
  const browser = {
    newBrowserCDPSession: async () => ({
      send: async () => { throw new Error('CDP metadata unavailable'); },
      detach: async () => { detached = true; },
    }),
  };
  await assert.rejects(captureBrowserProvenance(browser), /CDP metadata unavailable/);
  assert.equal(detached, true);
});

test('CLI validates options before loading Playwright or starting a benchmark', () => {
  const script = fileURLToPath(new URL('../../../benchmark/dom-gate.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--out', '/unused-dom-report.json', '--rounds', '0'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid --rounds/);
  assert.doesNotMatch(result.stdout, /Building|round 1/);
});
