// Upstream graphs and assertions, production Node builds, and per-case process
// isolation. Warmup, setup (except the S.js creation cases), and count-only
// passes are outside the timed samples.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { fileURLToPath } from "node:url";
import { buildUpstream } from "./upstream.mjs";
import { writeResults } from "./report.mjs";

const args = process.argv.slice(2);
if (args.length > 1 || args.some((arg) => !["--quick", "--check"].includes(arg))) {
  throw new Error("Usage: npm run bench -- [--quick | --check]");
}
const checkOnly = args.includes("--check");
const quick = args.includes("--quick");
const root = new URL("./", import.meta.url);
const build = new URL(".build/upstream.mjs", root);
await mkdir(new URL(".build/", root), { recursive: true });
await buildUpstream(fileURLToPath(build));
const { kairo, cellxExpected, makeTitle, perfTests } = await import(build.href);
const lock = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const versions = Object.fromEntries([
  ["solid1", "solid-js"], ["solid2", "@solidjs/signals"],
  ["alien", "alien-signals"], ["preact", "@preact/signals-core"],
].map(([id, name]) => [id, lock.packages[`node_modules/${name}`].version]));
versions.what = createHash("sha256").update(await readFile(
  new URL("../../packages/core/src/reactive.js", root),
)).digest("hex");

const ids = checkOnly ? ["what"] : ["what", "solid1", "solid2", "alien", "preact"];
const jobs = [
  { suite: "adapter", input: "", names: [] },
  ...kairo.map(({ name }) => ({ suite: "kairo", input: name, names: [name] })),
  { suite: "s", input: "", names: ["createSignals", "createComputations", "updateSignals"] },
  ...Object.keys(cellxExpected).map((depth) => ({ suite: "cellx", input: depth, names: [`cellx${depth}`] })),
  ...perfTests.map((config, i) => ({ suite: "dynamic", input: String(i), names: [makeTitle(config)] })),
];
const timeoutMs = (quick || checkOnly) ? 20000 : 180000;
const heapMiB = 768;

function runCase(id, { suite, input, names }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      `--max-old-space-size=${heapMiB}`, "--enable-source-maps", fileURLToPath(new URL("run-case.mjs", root)),
      id, suite, input, checkOnly ? "check" : quick ? "quick" : "full",
    ], {
      env: { ...process.env, NODE_ENV: "production", NODE_OPTIONS: "" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      cwd: fileURLToPath(root),
    });
    let result;
    let phase = suite;
    let partialRows;
    let stderr = "";
    let timedOut = false;
    child.stdout.resume();
    child.stderr.on("data", (data) => { stderr = (stderr + data).slice(0, 8000); });
    child.on("message", (message) => {
      if (message.phase) phase = message.phase;
      else if (message.partialRows) partialRows = message.partialRows;
      else result = message;
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const complete = Array.isArray(result?.rows) && result.rows.length === names.length && names.every((name) =>
        result.rows.some((row) => row.test === name && row.computations
          && Object.values(row.computations).length > 0
          && Object.values(row.computations).every((count) => Number.isSafeInteger(count) && count >= 0)));
      const status = timedOut ? "timeout"
        : /heap out of memory|heap limit/i.test(stderr) ? "heap limit"
        : code !== 0 ? "crash"
        : !result ? "no result"
        : result.assertionFailures ? "failed"
        : checkOnly && !complete ? "incomplete"
        : "passed";
      resolve({ id, suite, names, status, phase, code, signal, stderr, rows: partialRows, ...result });
    });
  });
}

const start = checkOnly ? null : performance.now();
const results = [];
for (const [i, job] of jobs.entries()) {
  // Rotate first position by test while keeping all workloads serial.
  for (let offset = 0; offset < ids.length; offset++) {
    const id = ids[(i + offset) % ids.length];
    const outcome = await runCase(id, job);
    results.push(outcome);
    console.log(`${id.padEnd(7)} ${(job.names[0] ?? "adapter checks").padEnd(28)} ${outcome.status}`);
  }
}

if (checkOnly) {
  const failures = results.filter(({ status }) => status !== "passed");
  for (const outcome of results) {
    for (const row of outcome.rows ?? []) {
      console.log(`  ${row.test}: ${JSON.stringify(row.computations)}`);
    }
    for (const check of outcome.checks ?? []) console.error(check);
    if (outcome.status !== "passed") {
      console.error(`${outcome.status} during ${outcome.phase}`);
      if (outcome.status === "crash" && outcome.stderr) console.error(outcome.stderr);
    }
  }
  console.log(`Reactivity correctness: ${results.length - failures.length}/${jobs.length} workloads passed`);
  process.exit(failures.length || results.length !== jobs.length ? 1 : 0);
}

const metadata = {
  mode: quick ? "smoke" : "full",
  at: new Date().toISOString(),
  upstream: lock.packages["node_modules/js-reactivity-benchmark-root"].resolved.split("#")[1],
  node: process.version,
  v8: process.versions.v8,
  machine: `${cpus()[0]?.model} (${cpus().length} logical CPUs, ${Math.round(totalmem() / 2 ** 30)} GiB), ${platform()} ${release()} ${arch()}`,
  elapsedSeconds: (performance.now() - start) / 1000,
  timeoutMs,
  heapMiB,
  versions,
};
await writeResults(root, { metadata, ids, tests: jobs.flatMap(({ names }) => names), results });
