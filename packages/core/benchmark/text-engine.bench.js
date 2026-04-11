// Benchmark suite for Pretext integration.
// Run: node packages/core/benchmark/text-engine.bench.js
import { JSDOM } from 'jsdom';
import { performance } from 'node:perf_hooks';

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.window = dom.window;
global.getComputedStyle = dom.window.getComputedStyle;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.queueMicrotask = global.queueMicrotask || ((fn) => Promise.resolve().then(fn));

const { signal, flushSync } = await import('../src/reactive.js');
const { insert } = await import('../src/render.js');
const { configureText, _resetTextEngineForTests, _setPretextForTests } = await import('../src/text-engine.js');

// Stub Pretext (real @chenglou/pretext not installed)
const stubPretext = {
  prepare: (text) => ({ text, segments: text.split(' ') }),
  layout: (prepared, width) => ({
    lines: [{ text: prepared.text, x: 0, y: 16 }],
    width,
  }),
};

function makeContainer() {
  const div = document.createElement('div');
  div.style.width = '400px';
  div.style.fontSize = '16px';
  div.style.fontFamily = 'sans-serif';
  div.style.lineHeight = '20px';
  document.body.appendChild(div);
  return div;
}

function bench(name, fn) {
  const t0 = performance.now();
  fn();
  const elapsed = performance.now() - t0;
  console.log(`  ${name.padEnd(40)} ${elapsed.toFixed(2)}ms`);
  return elapsed;
}

function runScenario(name, setupFn) {
  console.log(`\n=== ${name} ===`);

  _resetTextEngineForTests();
  const offTime = bench('OFF (measure: false)', setupFn);

  _resetTextEngineForTests();
  _setPretextForTests(stubPretext);
  configureText({ measure: true });
  const onTime = bench('ON  (measure: true)', setupFn);

  const delta = ((onTime - offTime) / (offTime || 1) * 100).toFixed(1);
  const verdict = onTime < offTime ? 'WIN' : onTime > offTime * 1.1 ? 'OVERHEAD' : 'neutral';
  console.log(`  delta: ${delta}% (${verdict})`);
  return { name, offTime, onTime, delta: parseFloat(delta), verdict };
}

const results = [];

// Scenario 1: 100 static text nodes
results.push(runScenario('S1: 100 static text nodes', () => {
  const parent = makeContainer();
  for (let i = 0; i < 100; i++) insert(parent, `static ${i}`);
}));

// Scenario 2: 100 dynamic text nodes, 1 update
results.push(runScenario('S2: 100 dynamic, 1 update', () => {
  const parent = makeContainer();
  for (let i = 0; i < 100; i++) {
    const s = signal(`dyn ${i}`);
    insert(parent, () => s());
  }
}));

// Scenario 3: 100 dynamic text nodes, 60 updates each
results.push(runScenario('S3: 100 nodes, 60 updates', () => {
  const parent = makeContainer();
  const sigs = [];
  for (let i = 0; i < 100; i++) {
    const s = signal(`dyn ${i}`);
    sigs.push(s);
    insert(parent, () => s());
  }
  for (let frame = 0; frame < 60; frame++) {
    for (let i = 0; i < 100; i++) sigs[i](`dyn ${i} f${frame}`);
    flushSync();
  }
}));

// Scenario 4: 1000 nodes, simulated resize
results.push(runScenario('S4: 1000 nodes, resize', () => {
  const parent = makeContainer();
  for (let i = 0; i < 1000; i++) insert(parent, `resize-${i}`);
  for (let w = 200; w <= 600; w += 40) parent.style.width = `${w}px`;
}));

// Scenario 5: Rapid signal updates (cache hit rate)
results.push(runScenario('S5: Rapid signal updates', () => {
  const parent = makeContainer();
  const s = signal('initial');
  insert(parent, () => s());
  for (let i = 0; i < 1000; i++) {
    s(`update ${i % 10}`);
    flushSync();
  }
}));

// Scenario 6: Single text node (pathological)
results.push(runScenario('S6: Single text node', () => {
  const parent = makeContainer();
  const s = signal('hello');
  insert(parent, () => s());
}));

// Summary
console.log('\n=== Summary ===');
console.log('Scenario'.padEnd(30) + 'OFF (ms)'.padEnd(12) + 'ON (ms)'.padEnd(12) + 'Delta'.padEnd(10) + 'Verdict');
for (const r of results) {
  console.log(
    r.name.padEnd(30) +
    r.offTime.toFixed(2).padEnd(12) +
    r.onTime.toFixed(2).padEnd(12) +
    (r.delta + '%').padEnd(10) +
    r.verdict
  );
}

console.log('\nNOTE: This run used a STUB. Install @chenglou/pretext and re-run for real numbers.');
