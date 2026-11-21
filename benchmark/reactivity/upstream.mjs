// Load the pinned upstream workloads without executing upstream package scripts.
// Expose case selection and sample hooks for isolated processes and raw results.
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const src = fileURLToPath(new URL(
  "./node_modules/js-reactivity-benchmark-root/packages/core/src/",
  import.meta.url,
));

function replaceOnce(source, old, next) {
  const first = source.indexOf(old);
  if (first < 0 || source.indexOf(old, first + old.length) >= 0) {
    throw new Error(`Upstream source changed around ${JSON.stringify(old)}`);
  }
  return source.replace(old, next);
}

export function buildUpstream(outfile) {
  return build({
    stdin: {
      contents: [
        'export { cases as kairo } from "./benches/kairoBench";',
        'export { cellx, expected as cellxExpected } from "./benches/cellxBench";',
        'export { sbench } from "./benches/sBench";',
        'export { makeGraph, runGraph } from "./benches/reactively/dependencyGraph";',
        'export { makeTitle } from "./benches/reactively/dynamicBench";',
        'export { perfTests } from "./config";',
        'export { frameworkTests } from "./frameworks.test";',
      ].join("\n"),
      resolveDir: src,
    },
    bundle: true,
    platform: "node",
    format: "esm",
    sourcemap: "linked",
    outfile,
    plugins: [{
      name: "benchmark-hooks",
      setup(build) {
        build.onResolve({ filter: /^vitest$/ }, () => ({
          path: "../assertions.mjs",
          external: true,
        }));
        build.onLoad({ filter: /(?:kairoBench|sBench|cellxBench|frameworks\.test)\.ts$/ }, async ({ path }) => {
          let source = await readFile(path, "utf8");
          if (path.endsWith("/kairoBench.ts")) {
            source = replaceOnce(source, "const cases =", "export const cases =");
          } else if (path.endsWith("/cellxBench.ts")) {
            source = replaceOnce(source, "const cellx =", "export const cellx =");
            source = replaceOnce(source, "layers: number) =>", "layers: number, measure = true) =>");
            source = replaceOnce(source, "const startTime = performance.now();", "const startTime = measure ? performance.now() : 0;");
            source = replaceOnce(source, "const endTime = performance.now();", "const endTime = measure ? performance.now() : 0;");
            // Lift the original reference arrays out of the unused runner.
            const start = source.indexOf("  const expected: Record<");
            const end = source.indexOf("\n  };", start) + "\n  };".length;
            if (start < 0 || end <= start) throw new Error("Cellx reference arrays moved");
            const expected = source.slice(start, end);
            source = source.slice(0, start) + source.slice(end) + "\nexport " + expected.trim();
          } else if (path.endsWith("/sBench.ts")) {
            source = replaceOnce(source, "const COUNT = 1e5;", "");
            source = replaceOnce(source, "  logPerfResult: PerfResultCallback,",
              "  logPerfResult: PerfResultCallback,\n  { size: COUNT, repeats, onSample, snapshot, measure = true },");
            source = replaceOnce(source, "i < 10; i++", "i < repeats; i++");
            source = replaceOnce(source, "      let start = 0;", "      let before;\n      let start = 0;");
            source = replaceOnce(source, "        start = performance.now();",
              "        before = snapshot?.();\n        start = measure ? performance.now() : 0;");
            source = replaceOnce(source, "      end = performance.now();",
              "      end = measure ? performance.now() : 0;\n      onSample(fn.name, end - start, before, snapshot?.());");
          } else {
            source = replaceOnce(source, 'import { frameworkInfo } from "./frameworksList";', "");
            source = replaceOnce(source, "frameworkInfo.forEach((frameworkInfo) => frameworkTests(frameworkInfo));", "");
            source = replaceOnce(source, "function frameworkTests(", "export function frameworkTests(");
          }
          return { contents: source, loader: "ts", resolveDir: dirname(path) };
        });
      },
    }],
  });
}
