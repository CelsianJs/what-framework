// The documentation snippet gate: every code block that ships to agents and
// users is compiled with what-compiler, its What imports are checked against
// the real exports, and the blocks that can run on their own are bundled,
// mounted and clicked through in a browser-like environment.
//
//   import { collectSnippets, checkSnippets, formatReport } from './snippets.mjs';
//
// A block is held to what can be decided mechanically: it parses, it
// compiles, every `import … from 'what-…'` names a real export, and when it
// has no free identifiers it runs without an uncaught error, a console.error
// or a What diagnostic. A deliberately wrong block says so with a marker on the
// line before it, and is asserted to fail exactly that way:
//
//   <!-- snippet: bad lint=ERR_X -->      eslint-plugin-what's recommended preset reports ERR_X
//   <!-- snippet: bad compile=ERR_X -->   compiling it raises or warns ERR_X
//   <!-- snippet: bad run=ERR_X -->       running it reports or throws ERR_X
//   <!-- snippet: bad import -->          one of its imports does not exist
//
// There is no marker that skips a block.

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRaiseSites } from '../lib/error-raise-sites.mjs';
import { extractHtmlBlocks, extractMarkdownBlocks } from './lib/extract.mjs';
import { Exports } from './lib/exports.mjs';
import { SnippetRunner, environmentGlobals } from './lib/run.mjs';
import { catalogueSources, fileSources, mcpSources, scaffoldSources, GENERATED_FROM_CATALOGUE } from './lib/sources.mjs';
import {
  checkImports, codedWarnings, codesIn, compileSnippet, componentCandidates, freeIdentifiers,
  hasBadComment, lintSnippet, mountsItself, pageLookups, parseSnippet, stripTypes,
} from './lib/static-checks.mjs';

export { extractHtmlBlocks, extractMarkdownBlocks, inferLanguage, parseMarker } from './lib/extract.mjs';
export { Exports } from './lib/exports.mjs';
export { checkImports, compileSnippet, lintSnippet, parseSnippet, stripTypes } from './lib/static-checks.mjs';
export { GENERATED_FROM_CATALOGUE } from './lib/sources.mjs';

export const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));

/**
 * Split a catalogue codeExample at its first `// Good` line. An example with
 * no `// Good` line is all bad half when it says `// Bad`, else all good half.
 * @returns {{ bad: string | null, good: string | null }}
 */
export function splitExample(example) {
  const lines = example.split('\n');
  const at = lines.findIndex((l) => /^\s*\/\/\s*Good\b/i.test(l));
  if (at === -1) return /^\s*\/\/\s*Bad\b/im.test(example) ? { bad: example, good: null } : { bad: null, good: example };
  const bad = lines.slice(0, at).join('\n');
  return { bad: bad.trim() ? bad : null, good: lines.slice(at).join('\n') };
}

/**
 * The snippets of one Markdown or HTML source, and how many of its blocks are
 * in a language that is not checked. A stray marker, a marker on a block that
 * is not code and an unlabelled Markdown fence that imports from What come
 * back as snippets with `problem` set.
 * @param {{ label: string, file: string, kind: 'markdown' | 'html', text: string }} source
 */
export function snippetsOf(source) {
  const snippets = [];
  let blocks = 0;
  let other = 0;
  for (const block of source.kind === 'html' ? extractHtmlBlocks(source.text) : extractMarkdownBlocks(source.text)) {
    const base = { source: source.label, file: source.file, line: block.line };
    if (block.stray) {
      snippets.push({ ...base, code: '', problem: block.marker.error || 'a snippet marker is not followed by a code block' });
      continue;
    }
    blocks++;
    if (!block.lang) {
      other++;
      if (block.marker) {
        snippets.push({ ...base, code: block.code, problem: `a snippet marker on a block that is not js/jsx/ts/tsx${block.info ? ` (${block.info})` : ''}` });
      } else if (source.kind !== 'html' && !block.info && /^\s*import\s[^;]*from\s*['"](?:what(?:[-/][^'"]*)?|create-what|eslint-plugin-what)['"]/m.test(block.code)) {
        snippets.push({ ...base, code: block.code, problem: 'an unlabelled fence that imports from What: label it js, jsx, ts or tsx' });
      }
      continue;
    }
    snippets.push({ ...base, lang: block.lang, code: block.code, marker: block.marker, role: 'block' });
  }
  return { snippets, blocks, other };
}

/**
 * Every snippet of every source: the code blocks of the documents and both
 * halves of every catalogue example.
 * @returns {Promise<{ snippets: object[], counts: Map<string, { blocks: number, other: number }> }>}
 */
export async function collectSnippets(repo = REPO) {
  const sources = [...await mcpSources(repo), ...scaffoldSources(repo), ...fileSources(repo)];
  const snippets = [];
  const counts = new Map();
  for (const source of sources) {
    const found = snippetsOf(source);
    snippets.push(...found.snippets);
    counts.set(source.label, { blocks: found.blocks, other: found.other });
  }
  for (const entry of await catalogueSources(repo)) {
    const c = counts.get(entry.label) || counts.set(entry.label, { blocks: 0, other: 0 }).get(entry.label);
    const { bad, good } = splitExample(entry.example);
    const base = { source: entry.label, file: entry.file, line: entry.line, lang: 'jsx', errorCode: entry.code, detects: entry.detects };
    if (bad !== null) { c.blocks++; snippets.push({ ...base, code: bad, role: 'catalogue-bad' }); }
    if (good !== null) { c.blocks++; snippets.push({ ...base, code: good, role: 'catalogue-good' }); }
  }
  return { snippets, counts };
}

// Codes what-compiler's Babel plugin raises itself; the others it lists
// (ERR_DUPLICATE_ACTION_ID, ERR_COMPILED_JSX_IN_SSR) come from the Vite
// plugin, which a single-file compile does not run.
function babelPluginCodes(repo) {
  const codes = new Set();
  for (const site of findRaiseSites(join(repo, 'packages'))) {
    if (site.pkg === 'what-compiler' && /[/\\]src[/\\]babel(?:-plugin\.js|[/\\])/.test(site.file)) codes.add(site.code);
  }
  return codes;
}

function head(code) {
  const line = code.split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function expectationOf(snippet, babelCodes) {
  if (snippet.role === 'catalogue-bad') {
    const channels = [];
    if (snippet.detects.includes('lint')) channels.push('lint');
    if (snippet.detects.includes('compile') && babelCodes.has(snippet.errorCode)) channels.push('compile');
    if (snippet.detects.includes('reported') || snippet.detects.includes('thrown')) channels.push('run');
    return { code: snippet.errorCode, channels, catalogue: true };
  }
  if (snippet.marker && !snippet.marker.error) return { code: snippet.marker.code, channels: [snippet.marker.channel], catalogue: false };
  return null;
}

/** What went wrong in a run, as failure lines, and the codes it raised. */
function runOutcome(run) {
  if (run.bundleError) return { lines: [`bundling failed: ${run.bundleError}`], codes: [] };
  if (run.timedOut) return { lines: ['did not finish in time (an endless synchronous loop?)'], codes: [] };
  if (run.crashed) return { lines: [run.crashed], codes: [] };
  const lines = [];
  const codes = [];
  for (const d of run.diagnostics) {
    lines.push(`reports ${d.code}: ${d.message}`);
    codes.push(d.code);
  }
  for (const p of run.problems) {
    const first = p.message.split('\n')[0];
    lines.push(`${p.kind}: ${first}`);
    codes.push(...codesIn(`${p.code || ''} ${p.message}`));
  }
  return { lines, codes: [...new Set(codes)] };
}

/**
 * Check snippets. Static checks run here; runnable snippets are bundled and
 * run in child processes, `concurrency` at a time.
 * @returns {Promise<object[]>} one result per snippet, in input order
 */
export async function checkSnippets(snippets, { repo = REPO, concurrency, timeout } = {}) {
  const exportsIndex = new Exports(repo);
  const globals = environmentGlobals();
  const babelCodes = babelPluginCodes(repo);
  const runner = new SnippetRunner({ repo, packages: exportsIndex.packages, concurrency, timeout });
  const cache = new Map();
  try {
    return await Promise.all(snippets.map((snippet) => {
      if (snippet.problem) return { snippet, failures: [snippet.problem], counts: {} };
      const expectation = expectationOf(snippet, babelCodes);
      const key = createHash('sha1').update(JSON.stringify([snippet.lang, snippet.code, snippet.role, expectation])).digest('hex');
      if (!cache.has(key)) cache.set(key, checkOne(snippet, expectation, { exportsIndex, globals, runner }));
      return cache.get(key).then((r) => ({ snippet, ...r, failures: r.failures.map((f) => located(snippet, f)) }));
    }));
  } finally {
    runner.close();
  }
}

// A failure's line is counted within the snippet, so identical snippets share
// one check; it is reported as a line of the source file, or of the catalogue
// example.
function located(snippet, { line, message }) {
  if (!line) return message;
  return snippet.role === 'block' ? `line ${snippet.line + line - 1}: ${message}` : `example line ${line}: ${message}`;
}

async function checkOne(snippet, expectation, { exportsIndex, globals, runner }) {
  const failures = [];
  const notes = [];
  const counts = { compiled: false, imports: 0, unchecked: 0, ran: false, mounted: false, badAsserted: false, compileOnly: false };
  const fail = (line, message) => failures.push({ line, message });
  const want = (channel) => expectation?.channels.includes(channel);

  if (snippet.marker?.error) fail(null, snippet.marker.error);

  const parsed = parseSnippet(snippet.code, snippet.lang);
  if (snippet.role === 'block' && !snippet.marker && hasBadComment(snippet.code, parsed.ast)) {
    fail(null, 'a comment calls this code bad: split the bad half into its own block and mark it (<!-- snippet: bad … -->)');
  }
  if (parsed.error) {
    fail(parsed.line, `does not parse: ${parsed.error}`);
    if (parsed.recovered) {
      const imports = checkImports(parsed.recovered, exportsIndex);
      counts.imports = imports.checked;
      for (const p of imports.problems) if (!want('import')) fail(p.line, p.message);
    }
    return { failures, notes, counts };
  }
  const stripped = stripTypes(snippet.code, snippet.lang);
  if (stripped.error) {
    fail(stripped.line, `does not parse: ${stripped.error}`);
    return { failures, notes, counts };
  }

  const imports = checkImports(parsed.ast, exportsIndex);
  counts.imports = imports.checked;
  counts.unchecked = imports.unchecked.length;
  for (const u of imports.unchecked) notes.push(`unchecked: ${u}`);

  const compiled = compileSnippet(stripped.code);
  const warned = codedWarnings(compiled.warnings);
  const compileCodes = [...new Set([...(compiled.codes || []), ...warned.flatMap(codesIn)])];
  // A code the server target raises (static markup it refuses to render, say)
  // is a compile failure too: what-compiler/vite compiles server transforms
  // with that target by default.
  if (want('compile') && !compileCodes.includes(expectation.code)) {
    const server = compileSnippet(stripped.code, { generate: 'ssr' });
    for (const c of [...(server.codes || []), ...codedWarnings(server.warnings).flatMap(codesIn)]) if (!compileCodes.includes(c)) compileCodes.push(c);
  }
  const compileCaught = want('compile') && compileCodes.includes(expectation.code);
  if (compiled.error) {
    if (!compileCaught) fail(compiled.line, `does not compile: ${compiled.error}`);
  } else {
    counts.compiled = true;
  }
  for (const w of warned) {
    if (!(compileCaught && codesIn(w).includes(expectation.code))) fail(null, `compile warning: ${w.replace(/\s*\(?[^\s]*snippet-[0-9a-f]+-\d+\.jsx[^\s]*\)?/g, '').trim()}`);
  }

  let lintCaught = false;
  let lintFound = null;
  let lintLines = new Set();
  if (want('lint')) {
    const lint = lintSnippet(stripped.code);
    if (lint.error) fail(null, `eslint could not parse it: ${lint.error}`);
    else {
      lintCaught = lint.codes.includes(expectation.code);
      lintFound = lint.codes;
      lintLines = new Set(lint.found.filter((f) => f.code === expectation.code).map((f) => f.line));
    }
  }

  // An import the expected lint report points at (ERR_MOVED_IMPORT's bad
  // half) is the deliberate mistake, not a second one.
  if (want('import')) {
    if (imports.problems.length) counts.badAsserted = true;
    else fail(null, 'marked bad import, but every import resolves to a real export');
  } else {
    for (const p of imports.problems) if (!lintLines.has(p.line)) fail(p.line, p.message);
  }

  let runCaught = false;
  let runFound = null;
  let runnable = false;
  let notRunnable = null;
  if (!compiled.error) {
    const free = freeIdentifiers(compiled.code, globals);
    const outside = imports.external;
    const tools = imports.ours.filter((i) => i.pkg.bin).map((i) => i.source);
    const files = imports.ours.flatMap((i) => i.names.filter((n) => !n.type && exportsIndex.readsFiles(i.source, n.imported)).map((n) => n.imported));
    const lookups = pageLookups(parsed.ast);
    if (free.length) notRunnable = `free identifiers: ${free.slice(0, 6).join(', ')}${free.length > 6 ? ', …' : ''}`;
    else if (outside.length) notRunnable = `imports outside What: ${[...new Set(outside)].join(', ')}`;
    else if (tools.length) notRunnable = `imports a package with a bin: ${tools.join(', ')}`;
    else if (imports.problems.length) notRunnable = 'an import does not resolve';
    else if (files.length) notRunnable = `uses ${files.join(', ')}, which read${files.length === 1 ? 's' : ''} or write${files.length === 1 ? 's' : ''} the project's files`;
    else if (lookups.length) notRunnable = `looks up page markup it does not create: ${lookups.join(', ')}`;
    runnable = notRunnable === null;
  }
  const shouldRun = runnable && (!expectation || want('run'));
  if (shouldRun) {
    const { defaultExport, candidates } = componentCandidates(compiled.code);
    let mount = { mount: null };
    const loaderData = imports.ours.some((i) => i.names.some((n) => n.imported === 'useLoaderData'));
    if (loaderData) notes.push('not mounted: it reads useLoaderData(), which only a server render provides');
    else if (!mountsItself(parsed.ast)) {
      const roots = candidates.filter((c) => c.root);
      const pick = defaultExport?.params === 0 ? { ...defaultExport, isDefault: true } : (roots.at(-1) || candidates.at(-1));
      if (pick && pick.params === 0) mount = pick.isDefault ? { mount: 'default', mountName: pick.name || 'default export' } : { mount: 'named', mountName: pick.name };
      else if (pick) notes.push(`not mounted: <${pick.name}> takes props`);
    }
    const run = await runner.run(compiled.code, mount);
    counts.ran = true;
    counts.mounted = Boolean(run.mounted);
    if (run.pending) notes.push('top-level await still pending after 3 s (network is stubbed)');
    const outcome = runOutcome(run);
    if (want('run')) {
      runCaught = outcome.codes.includes(expectation.code);
      runFound = outcome.lines;
      if (runCaught && !expectation.catalogue) {
        for (const line of outcome.lines) if (!codesIn(line).includes(expectation.code)) fail(null, `besides ${expectation.code}: ${line}`);
      }
    } else {
      for (const line of outcome.lines) fail(null, line);
    }
  }

  if (expectation && !want('import')) {
    const checkable = expectation.channels.filter((ch) => ch !== 'run' || runnable);
    const caught = compileCaught || lintCaught || runCaught;
    if (caught) counts.badAsserted = true;
    else if (expectation.catalogue && checkable.length === 0) counts.compileOnly = true;
    else {
      const said = [];
      if (want('lint') && lintFound) said.push(`eslint-plugin-what reports ${lintFound.length ? lintFound.join(', ') : 'nothing'}`);
      if (want('compile')) said.push(`compiling reports ${compileCodes.length ? compileCodes.join(', ') : 'nothing'}`);
      if (want('run') && !runnable && !expectation.catalogue) said.push(`it cannot run on its own (${notRunnable || 'it does not compile'})`);
      if (want('run') && runFound) said.push(`running it reports ${runFound.length ? runFound.join('; ') : 'nothing'}`);
      const what = expectation.catalogue ? `the bad half of ${expectation.code}'s example is not caught` : `marked bad ${expectation.channels[0]}=${expectation.code}, but it does not fail that way`;
      fail(null, `${what}: ${said.join('; ') || 'no channel reports it'}`);
    }
  }
  if (!runnable && notRunnable) notes.push(`not run: ${notRunnable}`);
  return { failures, notes, counts };
}

/** Totals per source label and overall. */
export function summarize(results, counts) {
  const per = new Map();
  const empty = (label) => ({ label, blocks: 0, other: 0, code: 0, compiled: 0, imports: 0, unchecked: 0, ran: 0, mounted: 0, bad: 0, compileOnly: 0, failing: 0, failures: 0 });
  for (const [label, c] of counts) per.set(label, { ...empty(label), blocks: c.blocks, other: c.other });
  for (const r of results) {
    const row = per.get(r.snippet.source) || per.set(r.snippet.source, empty(r.snippet.source)).get(r.snippet.source);
    if (!r.snippet.problem) row.code++;
    if (r.counts.compiled) row.compiled++;
    row.imports += r.counts.imports || 0;
    row.unchecked += r.counts.unchecked || 0;
    if (r.counts.ran) row.ran++;
    if (r.counts.mounted) row.mounted++;
    if (r.counts.badAsserted) row.bad++;
    if (r.counts.compileOnly) row.compileOnly++;
    if (r.failures.length) { row.failing++; row.failures += r.failures.length; }
  }
  const total = empty('total');
  for (const row of per.values()) for (const k of Object.keys(total)) if (k !== 'label') total[k] += row[k];
  return { rows: [...per.values()].sort((a, b) => a.label.localeCompare(b.label)), total };
}

/** Failing snippets as readable lines: where, the snippet's first line, each failure. */
export function formatFailures(results, { notes = false } = {}) {
  const out = [];
  for (const r of results.filter((x) => x.failures.length)) {
    const where = r.snippet.file === r.snippet.source ? `${r.snippet.file}:${r.snippet.line}` : `${r.snippet.source} line ${r.snippet.line}`;
    const role = r.snippet.role === 'catalogue-bad' ? ` ${r.snippet.errorCode} (bad half)` : r.snippet.role === 'catalogue-good' ? ` ${r.snippet.errorCode} (good half)` : '';
    out.push(`  ${where}${role}  ${head(r.snippet.code)}`);
    for (const f of r.failures) out.push(`    - ${f}`);
    if (notes) for (const n of r.notes) out.push(`      (${n})`);
  }
  return out;
}

/** The readable report: failures grouped by source, then the counts. */
export function formatReport(results, counts, { notes = false } = {}) {
  const out = [];
  const failing = results.filter((r) => r.failures.length);
  const bySource = new Map();
  for (const r of failing) {
    if (!bySource.has(r.snippet.source)) bySource.set(r.snippet.source, []);
    bySource.get(r.snippet.source).push(r);
  }
  if (failing.length) {
    out.push(`${failing.length} snippet(s) failing:`, '');
    for (const [label, list] of [...bySource].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`${label} (${list.length})`, ...formatFailures(list, { notes }), '');
    }
  }
  const { rows, total } = summarize(results, counts);
  out.push('Snippets per source (blocks: all code blocks; code: js/jsx/ts/tsx checked; imports: What imports checked; ran: run in jsdom; bad: bad halves asserted):');
  const cols = ['blocks', 'code', 'compiled', 'imports', 'ran', 'mounted', 'bad', 'failing'];
  const width = Math.max(...rows.map((r) => r.label.length), 5);
  out.push(`  ${'source'.padEnd(width)}  ${cols.map((c) => c.padStart(8)).join('')}`);
  for (const row of [...rows, total]) out.push(`  ${row.label.padEnd(width)}  ${cols.map((c) => String(row[c]).padStart(8)).join('')}`);
  out.push('');
  out.push(`Catalogue bad halves only compile-checked (their channel cannot be exercised by a single file): ${total.compileOnly}`);
  out.push(`Imported names that could not be checked (exports or declarations not readable): ${total.unchecked}`);
  out.push(`Skipped as renderings of the catalogue: ${GENERATED_FROM_CATALOGUE.join(', ')}`);
  out.push(failing.length ? `FAIL: ${failing.length} of ${total.code} snippets` : `OK: ${total.code} snippets`);
  return out.join('\n');
}
