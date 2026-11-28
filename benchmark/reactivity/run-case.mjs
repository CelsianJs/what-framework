// Run one framework/case in a fresh V8 process. A stalled graph cannot
// interfere with the remaining workloads or leave effects queued between cases.
import { setImmediate as yieldTurn } from "node:timers/promises";
import { frameworks } from "./adapters.mjs";
import { unitChecks } from "./assertions.mjs";
import {
  kairo, cellx, cellxExpected, frameworkTests, sbench,
  makeGraph, makeTitle, perfTests, runGraph,
} from "./.build/upstream.mjs";

const [id, suite, test, mode] = process.argv.slice(2);
const checkOnly = mode === "check";
const quick = mode === "quick";
const info = frameworks[id];
const { framework } = info;
const checks = [];
const rows = [];
let assertionFailures = 0;

function fail(label, expected, actual, detail) {
  assertionFailures++;
  if (checks.length < 10) checks.push({ label, expected, actual, detail });
}

function check(label, expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail(label, expected, actual);
}

// Upstream uses console.assert, which otherwise just logs and keeps running.
console.assert = (value, ...detail) => {
  if (!value) fail("upstream assertion", true, false, {
    args: detail,
    location: new Error().stack?.split("\n")[2]?.trim(),
  });
};

// Some engines report effect failures to console and continue flushing.
console.error = (...args) => fail("reactive update error", "no error", args.map(String));

function counted() {
  let computed = 0;
  let effects = 0;
  return {
    framework: {
      ...framework,
      computed: (fn) => framework.computed(() => { computed++; return fn(); }),
      effect: (fn) => framework.effect(() => { effects++; return fn(); }),
    },
    snapshot: () => ({ computed, effects }),
  };
}

function difference(before, after) {
  return { computed: after.computed - before.computed, effects: after.effects - before.effects };
}

async function timeSamples(repeats, run) {
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    await yieldTurn();
    const before = performance.now();
    run();
    samples.push(performance.now() - before);
  }
  return samples;
}

function phase(message) {
  process.send({ phase: message });
}

function checkDynamic(config, { sum, count }) {
  check("dynamic sum", config.expected.sum, sum);
  if (config.readFraction === 1 || info.testPullCounts) {
    check("dynamic computed count", config.expected.count, count);
  }
}

async function run() {
  if (suite === "adapter") {
    frameworkTests(info);
    for (const { name, run } of unitChecks) {
      try {
        run();
      } catch (err) {
        fail(name, err.expected, err.actual, err.stack);
      } finally {
        framework.cleanup();
      }
    }
    return;
  }

  if (suite === "kairo") {
    const { fn } = kairo.find(({ name }) => name === test);
    const iterations = quick ? 2 : 500;
    let samples = [];
    if (!checkOnly) {
      const iterate = framework.withBuild(() => fn(framework));
      for (let i = 0; i < (quick ? 1 : 3); i++) iterate();
      samples = await timeSamples(quick ? 2 : 10, () => {
        for (let i = 0; i < iterations; i++) iterate();
      });
      framework.cleanup();
    }

    const counter = counted();
    const countIteration = framework.withBuild(() => fn(counter.framework));
    countIteration();
    const before = counter.snapshot();
    countIteration();
    rows.push({ test, samples, iterations, computations: difference(before, counter.snapshot()) });
    return;
  }

  if (suite === "cellx") {
    const depth = Number(test);
    const samples = [];
    let computations;
    phase(`cellx${depth} build and first update`);
    for (let i = checkOnly ? 0 : -1; i <= (checkOnly ? 0 : quick ? 2 : 10); i++) {
      await yieldTurn();
      const counter = i === 0 ? counted() : null;
      const [elapsed, before, after] = cellx(counter?.framework ?? framework, depth, !checkOnly);
      check("cellx before", cellxExpected[depth][0], before);
      check("cellx after", cellxExpected[depth][1], after);
      if (counter) computations = counter.snapshot();
      if (i > 0) samples.push(elapsed);
    }
    rows.push({ test: `cellx${depth}`, samples, computations });
    return;
  }

  if (suite === "dynamic") {
    const config = perfTests[Number(test)];
    const iterations = quick ? Math.min(config.iterations, 50) : config.iterations;
    const buildGraph = () => makeGraph(framework, config.readFraction, config);
    phase("dynamic graph build");
    let { graph, counter } = buildGraph();
    const runOnce = () => {
      counter.count = 0;
      const sum = runGraph(graph, iterations, framework);
      return { sum, count: counter.count };
    };
    if (checkOnly) {
      phase("dynamic graph correctness at upstream iteration count");
      runOnce();
      const verified = runOnce();
      checkDynamic(config, verified);
      rows.push({ test: makeTitle(config), computations: { computed: verified.count } });
      return;
    }
    phase("dynamic graph warmup");
    for (let i = 0; i < (quick ? 1 : 3); i++) runOnce();
    const sampleResults = [];
    const samples = [];
    phase("dynamic graph samples");
    for (let i = 0; i < (quick ? 2 : 5); i++) {
      await yieldTurn();
      // When the prefix is narrower than the graph, replaying on the same
      // sources would leave their values unchanged and measure no propagation.
      if (quick) {
        framework.cleanup();
        ({ graph, counter } = buildGraph());
      }
      const start = performance.now();
      sampleResults.push(runOnce());
      samples.push(performance.now() - start);
    }
    rows.push({
      test: makeTitle(config), samples, iterations, sampleResults,
      computations: { computed: sampleResults.at(-1).count },
    });

    process.send({ partialRows: rows });
    phase("dynamic graph correctness at upstream iteration count");
    // Upstream expected counts refer to a steady-state replay on a warm graph.
    let verified = sampleResults.at(-1);
    if (quick) {
      runGraph(graph, config.iterations, framework);
      counter.count = 0;
      const sum = runGraph(graph, config.iterations, framework);
      verified = { sum, count: counter.count };
    }
    checkDynamic(config, verified);
    rows[0].verification = { expected: config.expected, actual: verified };
    return;
  }

  if (suite === "s") {
    const size = (quick || checkOnly) ? 1000 : 100000;
    const raw = {};
    const counts = {};
    let subcases = [];
    if (!checkOnly) {
      phase("S.js samples");
      await sbench(framework, (result) => {
        raw[result.test] = { ...result, subcases };
        subcases = [];
      }, {
        size,
        repeats: quick ? 2 : 10,
        onSample(name, time) {
          const previous = subcases.at(-1);
          if (previous?.name === name) previous.samples.push(time);
          else subcases.push({ name, samples: [time] });
        },
      });
    }
    phase("S.js untimed computation counts");
    const counter = counted();
    const recordCounts = (name, _time, before, after) => {
      const computations = difference(before, after);
      counts[name] = computations;
      if (checkOnly) subcases.push({ name, computations });
    };
    await sbench(counter.framework, ({ test }) => {
      if (!checkOnly) return;
      if (!subcases.length) throw new Error(`S.js reported ${test} without any subcases`);
      const computations = subcases.reduce((total, { computations }) => ({
        computed: total.computed + computations.computed,
        effects: total.effects + computations.effects,
      }), { computed: 0, effects: 0 });
      rows.push({ test, computations, subcases });
      subcases = [];
    }, {
      size,
      repeats: 1,
      measure: false,
      snapshot: counter.snapshot,
      onSample: recordCounts,
    });
    for (const { test, time, subcases } of Object.values(raw)) {
      const computations = { computed: 0, effects: 0 };
      for (const subcase of subcases) {
        subcase.computations = counts[subcase.name];
        computations.computed += subcase.computations.computed;
        computations.effects += subcase.computations.effects;
      }
      rows.push({ test, time, size, subcases, computations });
    }
    return;
  }

  throw new Error(`Unknown suite ${suite}`);
}

try {
  await run();
} catch (err) {
  fail("workload exception", "completion", err.message, err.stack);
} finally {
  try {
    framework.cleanup();
  } catch (err) {
    fail("cleanup exception", "completion", err.message, err.stack);
  }
  await yieldTurn();
  process.send({ rows, checks, assertionFailures }, () => process.disconnect());
}
