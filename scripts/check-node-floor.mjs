#!/usr/bin/env node
// The engines floor gate: no file Node runs uses a built-in newer than the
// oldest Node the packages promise (package.json `engines.node`, ">=20").
//
// Two scopes, because they promise different things:
//   shipped   packages' source, bins and entry files: any 20.x runs them, so
//             an API added in a 20 minor (import.meta.dirname, 20.11) is too
//             new as well
//   tooling   tests, test helpers, scripts, smokes and stress tests: CI runs
//             them on the newest 20, so only APIs of a later major are too new
// Browser-only code is not Node's to judge: an API that browsers have and
// Node lacks (navigator, WebSocket) is not listed. A use guarded by feature
// detection is allowed on a line, or the line after one, that carries the
// comment `node-floor: <why>`.
//
// Usage: node scripts/check-node-floor.mjs [--list]   (exit 1 on a use)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Built-ins by the Node version that first has them: [label, since, pattern]. */
export const RULES = [
  ['Promise.withResolvers', '22.0.0', /\bPromise\.withResolvers\b/],
  ['Promise.try', '23.0.0', /\bPromise\.try\b/],
  ['Object.groupBy / Map.groupBy', '21.0.0', /\b(?:Object|Map)\.groupBy\b/],
  ['Array.fromAsync', '22.0.0', /\bArray\.fromAsync\b/],
  ['Set methods', '22.0.0', /\.(?:symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(|(?<!\bz)\.(?:union|intersection|difference)\(/],
  // On what a Map, Set, array or string iterator method returns; Object.keys()
  // and its kin return arrays.
  ['iterator helpers', '22.0.0', /\bIterator\.(?:from|prototype)\b|(?<!\bObject|\.\.)\.(?:values|keys|entries|matchAll)\([^()]*\)\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(/],
  ['`using` declarations', '24.0.0', /^\s*(?:await\s+)?using\s+[\w$]+\s*=/m],
  ['RegExp.escape', '24.0.0', /\bRegExp\.escape\b/],
  ['Error.isError', '24.0.0', /\bError\.isError\b/],
  ['Float16Array / Math.f16round', '24.0.0', /\bFloat16Array\b|\bMath\.f16round\b/],
  ['URL.parse', '22.1.0', /\bURL\.parse\(/],
  ['URLPattern', '24.0.0', /\bURLPattern\b/],
  ['process.getBuiltinModule', '22.3.0', /\bgetBuiltinModule\(/],
  ['node:sqlite', '22.5.0', /['"]node:sqlite['"]/],
  ['fs.glob', '22.0.0', /\b(?:fs|fsp|promises)\.glob\(|\{[^}]*\bglob\b[^}]*\}\s*from\s*['"](?:node:)?fs(?:\/promises)?['"]/],
  ['path.matchesGlob', '22.5.0', /\bmatchesGlob\b/],
  ['test mock.module', '22.3.0', /\bmock\.module\(/],
  ['assert.partialDeepStrictEqual', '22.13.0', /\bpartialDeepStrictEqual\b/],
  ['import.meta.dirname / filename', '20.11.0', /\bimport\.meta\.(?:dirname|filename)\b/],
  ['util.styleText', '20.12.0', /\butil\.styleText\b|\{[^}]*\bstyleText\b[^}]*\}\s*from\s*['"](?:node:)?util['"]/],
  ['process.loadEnvFile', '20.12.0', /\bloadEnvFile\b/],
  ['crypto.hash', '20.12.0', /\bcrypto\.hash\(/],
  ['module.register', '20.6.0', /\bmodule\.register\(|\{[^}]*\bregister\b[^}]*\}\s*from\s*['"](?:node:)?module['"]/],
  ['ReadableStream.from', '20.6.0', /\bReadableStream\.from\(/],
  ['AbortSignal.any', '20.3.0', /\bAbortSignal\.any\(/],
];

const SHIPPED_DIRS = ['src', 'bin'];
const TOOLING_DIRS = ['test-utils', 'scripts', 'smoke', 'stress-tests'];
const SKIP = new Set(['node_modules', 'dist', '.vite', 'fixtures-out']);

function parse(version) {
  return String(version).split('.').map(Number);
}

function newer(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function jsFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(path, out);
    else if (/\.(?:m|c)?js$/.test(entry.name)) out.push(path);
  }
  return out;
}

/** The files of each scope. */
export function scopes(base = root) {
  const shipped = [];
  const tooling = [];
  const packages = join(base, 'packages');
  for (const name of readdirSync(packages)) {
    const dir = join(packages, name);
    if (!statSync(dir).isDirectory()) continue;
    for (const sub of SHIPPED_DIRS) jsFiles(join(dir, sub), shipped);
    for (const file of readdirSync(dir)) if (/\.(?:m|c)?js$/.test(file)) shipped.push(join(dir, file));
    jsFiles(join(dir, 'test'), tooling);
  }
  for (const dir of TOOLING_DIRS) jsFiles(join(base, dir), tooling);
  for (const name of readdirSync(join(base, 'examples'))) jsFiles(join(base, 'examples', name, 'test'), tooling);
  // This gate and its test name every API they look for.
  const own = new Set([fileURLToPath(import.meta.url), join(base, 'scripts/release/test/node-floor.test.mjs')]);
  return { shipped, tooling: tooling.filter((file) => !own.has(file)) };
}

// Comments out, so prose that names an API is not a use of it. Strings stay:
// code built as text (a page script, a generated file) runs too.
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, (line, lead) => lead + ' '.repeat(line.length - lead.length));
}

/**
 * Every use in `source` of a rule newer than `floor`: [{ line, label, since }].
 * @param {string} source
 * @param {string} floor
 */
export function uses(source, floor) {
  const raw = source.split('\n');
  const lines = code(source).split('\n');
  const found = [];
  lines.forEach((text, i) => {
    if (/node-floor:/.test(raw[i]) || (i > 0 && /node-floor:/.test(raw[i - 1]))) return;
    for (const [label, since, pattern] of RULES) {
      if (newer(since, floor) && new RegExp(pattern.source, pattern.flags.replace('m', '')).test(text)) found.push({ line: i + 1, label, since });
    }
  });
  return found;
}

/** The floor package.json promises, as a version: ">=20" is 20.0.0. */
export function enginesFloor(base = root) {
  const range = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')).engines.node;
  const match = /^>=\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(range.trim());
  if (!match) throw new Error(`[check-node-floor] engines.node is "${range}": expected a ">=N" floor`);
  return `${match[1]}.${match[2] || 0}.${match[3] || 0}`;
}

function main() {
  const floor = enginesFloor();
  const latestOfFloor = `${parse(floor)[0]}.999.999`;
  const { shipped, tooling } = scopes();
  const problems = [];
  for (const [files, limit, scope] of [[shipped, floor, 'shipped'], [tooling, latestOfFloor, 'tooling']]) {
    for (const file of files) {
      for (const use of uses(readFileSync(file, 'utf8'), limit)) {
        problems.push(`${relative(root, file)}:${use.line}: ${use.label} needs Node ${use.since}; ${scope} code runs on Node ${scope === 'shipped' ? floor : parse(floor)[0] + '.x'}`);
      }
    }
  }
  if (process.argv.includes('--list')) console.log(`[check-node-floor] ${shipped.length} shipped and ${tooling.length} tooling files, floor ${floor}`);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`[check-node-floor] ${problems.length} use(s) of a Node API newer than engines.node`);
    process.exit(1);
  }
  console.log(`[check-node-floor] ok: ${shipped.length + tooling.length} files use nothing newer than Node ${floor} (tooling: ${parse(floor)[0]}.x)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
