// Fail the build when the docs import something the framework does not export.
//
//   node docs-site/scripts/check-api-refs.mjs
//
// The docs went stale the way docs always go stale: silently, one export at a
// time, with nothing to notice. A page taught `<Portal mount={...}>` for as long
// as the prop had been called `target`, and the sample looked perfectly
// reasonable, because a wrong name and a right name read identically. The only
// durable fix is to stop trusting prose and check the names against the runtime.
//
// This is the same idea as the .d.ts parity gate added in 0.12.0: derive the
// truth from the code, then assert the docs agree. It deliberately checks only
// what it can check MECHANICALLY and with certainty (does this import resolve to
// a real export?), because a check that guesses produces noise, and a noisy gate
// gets switched off.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPO = dirname(ROOT);

// Published import specifier -> workspace file, derived from each package's own
// `exports` map rather than hand-listed. A hand-written list is the same kind of
// second source of truth this script exists to eliminate: the first version of
// it omitted what-react entirely, so a page importing the real, published
// `what-react/vite` was reported as a broken import. A gate that cries wolf is
// worse than no gate, because it teaches everyone to ignore it.
function discoverEntryPoints() {
  const map = {};
  const pkgsDir = join(REPO, 'packages');
  for (const dir of readdirSync(pkgsDir)) {
    const manifestPath = join(pkgsDir, dir, 'package.json');
    let manifest;
    try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); } catch { continue; }
    if (!manifest.name || manifest.private) continue;

    // A package with a `bin` is a program, not an API surface a doc sample
    // imports from. It also must not be imported: doing so RUNS it. The first
    // version of this script imported all of them and, as a side effect of
    // checking documentation, started an MCP server on stdio, opened a devtools
    // WebSocket bridge on port 9229, and dropped create-what into an interactive
    // "Project name:" prompt. A lint that leaves a listening socket behind is a
    // worse problem than the one it was written to find.
    if (manifest.bin) continue;

    for (const [subpath, target] of Object.entries(manifest.exports || { '.': manifest.main })) {
      if (!target) continue;
      // Prefer the source condition; `production` points at a built artifact
      // that may not exist in a clean checkout.
      const file = typeof target === 'string' ? target : (target.import || target.default);
      if (typeof file !== 'string' || !file.endsWith('.js')) continue;
      const spec = subpath === '.' ? manifest.name : `${manifest.name}/${subpath.replace(/^\.\//, '')}`;
      map[spec] = join(pkgsDir, dir, file);
    }
  }
  return map;
}

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith('.html')) out.push(full);
  }
  return out;
}

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&amp;': '&' };

/** Plain source text of every <pre><code> block, with the highlight spans stripped. */
function codeBlocks(html) {
  const blocks = [];
  const re = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g;
  let m;
  while ((m = re.exec(html))) {
    const text = m[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;|&gt;|&quot;|&#39;|&apos;|&nbsp;|&amp;/g, (e) => ENTITIES[e]);
    blocks.push({ text, index: m.index });
  }
  return blocks;
}

function lineOf(html, index) {
  return html.slice(0, index).split('\n').length;
}

const ENTRY_POINTS = discoverEntryPoints();

const exportsBySpec = new Map();
for (const [spec, file] of Object.entries(ENTRY_POINTS)) {
  try {
    const mod = await import(file);
    exportsBySpec.set(spec, new Set(Object.keys(mod)));
  } catch {
    // An entry point that cannot be imported in plain Node (a browser-only or
    // build-tool module) still counts as a REAL specifier, so record it with no
    // export set. Named-import checking is skipped for it rather than every
    // import from it being reported as broken.
    exportsBySpec.set(spec, null);
  }
}

// `import { a, b as c } from 'spec'` and `import x, { y } from 'spec'`.
const IMPORT_RE = /import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

const problems = [];
let checkedImports = 0;
let checkedFiles = 0;

for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, 'utf8');
  const rel = relative(REPO, file);
  checkedFiles++;

  for (const block of codeBlocks(html)) {
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(block.text))) {
      const [, names, spec] = m;

      if (!(spec in ENTRY_POINTS)) {
        // Only flag specs that are clearly meant to be ours. A sample importing
        // 'zod' or './db.js' is not this check's business.
        if (/^what[-/]/.test(spec)) {
          problems.push({ file: rel, line: lineOf(html, block.index), kind: 'unknown-module', detail: spec });
        }
        continue;
      }

      const available = exportsBySpec.get(spec);
      if (!available) continue;

      for (const raw of names.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name || name === 'type') continue;
        checkedImports++;
        if (!available.has(name)) {
          problems.push({ file: rel, line: lineOf(html, block.index), kind: 'missing-export', detail: `${name} from '${spec}'` });
        }
      }
    }
  }
}

console.log(`[check-api-refs] ${checkedFiles} pages, ${checkedImports} imported names checked against the real runtime`);

if (problems.length === 0) {
  console.log('[check-api-refs] OK: every documented import resolves to a real export.');
  process.exit(process.exitCode || 0);
}

console.error(`\n[check-api-refs] ${problems.length} problem(s):\n`);
for (const p of problems) {
  const what = p.kind === 'missing-export'
    ? `imports ${p.detail}, which is not exported`
    : `imports from '${p.detail}', which is not a real entry point`;
  console.error(`  ${p.file}:${p.line}  ${what}`);
}
console.error('\nEither the docs are wrong, or the export was removed without updating them.');
process.exit(1);
