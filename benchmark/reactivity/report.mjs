import { writeFile } from "node:fs/promises";

function table(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return (sorted[mid] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2;
}

export async function writeResults(root, { metadata, ids, tests, results }) {
  const byTest = Object.fromEntries(tests.map((test) => [test, {}]));
  for (const result of results) {
    for (const test of result.names) {
      const row = result.rows?.find((row) => row.test === test);
      byTest[test][result.id] = {
        status: result.status,
        time: row?.time ?? (row?.samples ? median(row.samples) : undefined),
        computations: row?.computations,
      };
    }
  }
  const common = tests.filter((test) => ids.every((id) => byTest[test][id].status === "passed"));
  const bestTime = (test) => Math.min(...ids.map((id) => byTest[test][id].time));
  const relative = (id) => common.length
    ? Math.exp(common.reduce((sum, test) => sum + Math.log(byTest[test][id].time / bestTime(test)), 0) / common.length)
    : null;
  const suiteStatus = Object.fromEntries(ids.map((id) => [
    id, results.find((result) => result.id === id && result.suite === "adapter").status,
  ]));

  const labels = ["what", "Solid 1.9", "Solid 2.0 signals", "Alien", "Preact"];
  const lines = [
    "# Signal-engine benchmark",
    "",
    metadata.mode === "smoke" ? "**Smoke run.** Concurrent machine load and reduced samples make these timings unsuitable for baseline comparisons." : "**Full-size run.**",
    "",
    `- ${metadata.at} · ${metadata.elapsedSeconds.toFixed(1)} s wall time`,
    `- Node ${metadata.node}, V8 ${metadata.v8}`,
    `- ${metadata.machine}`,
    `- Upstream commit \`${metadata.upstream}\``,
    `- Working-tree What reactive.js SHA-256 \`${metadata.versions.what}\``,
    `- Solid ${metadata.versions.solid1}, @solidjs/signals ${metadata.versions.solid2}, Alien ${metadata.versions.alien}, Preact ${metadata.versions.preact}`,
    `- Case limit ${metadata.timeoutMs / 1000} s, V8 old-space limit ${metadata.heapMiB} MiB per child process`,
    "",
    "## Elapsed milliseconds",
    "",
    "Each cell is the median of raw samples. The S.js rows retain the upstream sum of fastest per-subcase samples. Failed and incomplete runs have no ranked timing.",
    "",
    table(["Workload", ...labels], [
      ...tests.map((test) => [test, ...ids.map((id) => {
        const { time, status } = byTest[test][id];
        return status === "passed" ? time.toFixed(3) : status;
      })]),
      [`Geometric mean vs row fastest (${common.length}/${tests.length} shared passes)`, ...ids.map((id) => {
        const ratio = relative(id);
        return ratio === null ? "—" : `${ratio.toFixed(2)}×`;
      })],
      ["Upstream adapter checks", ...ids.map((id) => suiteStatus[id])],
    ]),
    "",
    "## Executed callbacks",
    "",
    "Computed / effect callbacks. Kairo counts cover one warmed invocation, cellx covers graph creation plus one update, S.js totals aggregate one sample per subcase, and dynamic rows show the built-in computed count for the last timed replay. Dynamic effect counts are unavailable. The JSON includes the full-size dynamic verification counts and S.js subcases.",
    "",
    table(["Workload", ...labels], tests.map((test) => [test, ...ids.map((id) => {
      const count = byTest[test][id].computations;
      return count ? `${count.computed.toLocaleString("en-US")} / ${count.effects?.toLocaleString("en-US") ?? "—"}` : "—";
    })])),
    "",
    "## Failed or incomplete cases",
    "",
  ];
  const issues = results.filter(({ status }) => status !== "passed");
  if (!issues.length) lines.push("None.");
  for (const { id, names, status, phase, checks, assertionFailures } of issues) {
    const caseName = names.join(", ") || "adapter checks";
    lines.push(`- **${id} / ${caseName}** — ${status} during ${phase}.`);
    for (const { label, expected, actual } of checks ?? []) {
      lines.push(`  - ${label}. Expected \`${JSON.stringify(expected)}\`, observed \`${JSON.stringify(actual)}\`.`);
    }
    if (assertionFailures > checks?.length) lines.push(`  - ${assertionFailures} failures total. The first 10 are in the JSON.`);
  }
  lines.push(
    "",
    "See results.json for sample arrays, per-case exit status and assertion details. These synthetic graph workloads measure different work across engines when callbacks are skipped or retried. Ratios apply only to the shared passing workload set.",
    "",
  );
  await writeFile(new URL("RESULTS.md", root), lines.join("\n"));
  await writeFile(new URL("results.json", root), JSON.stringify({
    metadata, tests, commonPassingTests: common, geometricMean: Object.fromEntries(ids.map((id) => [id, relative(id)])), results,
  }, null, 2) + "\n");
}
