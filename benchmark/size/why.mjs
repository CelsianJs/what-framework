#!/usr/bin/env node
// Why is it in the bundle? Per-declaration attribution of a scripts/check-size.mjs
// scenario, with the reason the bundler keeps each declaration.
//
//   node benchmark/size/why.mjs compiled-counter            table, largest first
//   node benchmark/size/why.mjs hooks-app --json out.json   machine-readable
//   node benchmark/size/why.mjs compiled-counter --min 40   hide rows under 40 B
//   node benchmark/size/why.mjs compiled-counter --text     also dump the readable bundle
//
//   node benchmark/size/why.mjs react-counter               a what-react scenario
//   node benchmark/size/why.mjs mixed-recharts              the framework chunk only
//
// Two builds of the scenario from packages/*/src, both a production `vite build`
// with the plugins check-size uses for it (what-compiler/vite, what-react's
// reactCompat(), or both), as check-size's "(vite, source)" builds do:
//
//   1. minified with a source map: every output byte is traced to a source
//      position and charged to the top-level declaration that encloses it
//      (module-scope statements that are not declarations are charged to
//      "<module scope>", the code a bundler can never shake);
//   2. unminified: the bundle is parsed and each kept top-level binding's
//      referrers are read from scope analysis. A binding only referenced from
//      module scope is kept by a side effect; a binding referenced from a
//      function is kept because that function is.
//
// gzip bytes per row are the row's share of the minified bytes times the
// bundle's ratio: an estimate, good for ranking. A cut's real saving is the
// difference between two check-size runs.
//
// Uses the repo root's vite and Babel, and benchmark/size's trace-mapping.

import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const repo = resolve(import.meta.dirname, '../..');
const require = createRequire(join(repo, 'package.json'));
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { TraceMap, decodedMappings } = require('@jridgewell/trace-mapping');

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--')) ?? 'compiled-counter';
const flag = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : (args[i + 1] ?? true); };
const minRow = Number(flag('--min') ?? 0);

// The scenario sources are check-size's own: read from its text so the two
// cannot drift.
const checkSize = readFileSync(join(repo, 'scripts/check-size.mjs'), 'utf8');
const sourceOf = (constName) => {
  const m = new RegExp(`const ${constName} = \`([\\s\\S]*?)\`;`).exec(checkSize);
  if (!m) throw new Error(`check-size.mjs has no template literal named ${constName}`);
  return m[1].replace(/\\`/g, '`').replace(/\\\$/g, '$').replace(/\\\\/g, '\\');
};
const constString = (name) => /'([^']*)'/.exec(new RegExp(`const ${name} = ('[^']*');`).exec(checkSize)?.[1] ?? '')?.[1];
// Three kinds of scenario, built as check-size builds them:
//   what   viteBundle: what-compiler/vite alone
//   react  reactCompatBundle: what-react's plugin alone, every JSX file React code
//   mixed  mixedBundle: what-compiler/vite and what-react's plugin (mixed mode);
//          `framework: true` attributes the chunk that holds what-core and
//          what-react, apart from the React package's own code.
const scenarioSpec = () => {
  let m = new RegExp(`'${scenario}': \\(\\) => viteBundle\\('[^']+', \\{ source: (\\w+)(, hydratable: true)? \\}\\)`).exec(checkSize);
  if (m) return { kind: 'what', files: { [`${scenario}.jsx`]: sourceOf(m[1]) }, hydratable: !!m[2], dir: '' };
  m = new RegExp(`'${scenario}': \\(\\) => reactCompatBundle\\('[^']+', (\\w+)\\)`).exec(checkSize);
  if (m) return { kind: 'react', files: { [`${scenario}.jsx`]: sourceOf(m[1]) }, hydratable: false, dir: '' };
  m = new RegExp(`mixedBundle\\('${scenario}', \\{ ([^}]*) \\}(?:, \\{ (.*) \\})?\\)[;,]?$`, 'm').exec(checkSize);
  if (m) {
    const files = {};
    for (const [, file, constName] of m[1].matchAll(/'([^']+)': (\w+)/g)) files[file] = sourceOf(constName);
    const opts = m[2] ?? '';
    const dir = /dir: `\$\{(\w+)\}([^`]*)`/.exec(opts);
    return {
      kind: 'mixed', files,
      hydratable: !/hydratable: false/.test(opts),
      framework: /framework: true/.test(opts),
      dir: dir ? constString(dir[1]) + dir[2] : '',
    };
  }
  throw new Error(`${scenario} is not a viteBundle, reactCompatBundle or mixedBundle scenario of check-size.mjs`);
};

// what-core and what-framework from packages/*/src, every export of each
// package mapped to the file its `import` condition names.
const sourceAliases = () => {
  const alias = [];
  for (const [pkg, dir] of [['what-core', 'packages/core'], ['what-framework', 'packages/what']]) {
    const { exports } = JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8'));
    for (const [key, target] of Object.entries(exports)) {
      const file = typeof target === 'string' ? target : target.import ?? target.default;
      if (typeof file !== 'string' || !file.endsWith('.js')) continue;
      const specifier = pkg + key.slice(1);
      alias.push({ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`), replacement: join(repo, dir, file) });
    }
  }
  return alias;
};

async function bundle({ kind, files, hydratable, dir, framework }, { minify }) {
  const { build } = await import(require.resolve('vite').replace(/dist[\\/]node[\\/].*$/, 'dist/node/index.js'));
  const { default: what } = await import(join(repo, 'packages/compiler/src/vite-plugin.js'));
  const { reactCompat } = await import(join(repo, 'packages/react-compat/src/vite-plugin.js'));
  // As check-size's mixedBundle: the files are written out (the mixed plugin
  // reads an imported file to tell React files from native ones), unless they
  // sit in `dir`.
  const onDisk = kind === 'mixed' && !dir;
  const base = dir ? join(repo, dir) : onDisk ? join(repo, 'benchmark/size/.scenarios', scenario) : repo;
  if (onDisk) {
    mkdirSync(base, { recursive: true });
    writeFileSync(join(repo, 'benchmark/size/.scenarios/.gitignore'), '*\n');
  }
  const sources = new Map(Object.entries(files).map(([file, text]) => [join(base, file), text]));
  if (onDisk) for (const [file, text] of sources) writeFileSync(file, text);
  const entry = join(base, `${scenario}.jsx`);
  const plugins = [
    { name: 'size-entry', enforce: 'pre', resolveId: (id, importer) => { const file = id.startsWith('./') && importer ? join(dirname(importer), id) : id; return sources.has(file) ? file : null; }, load: (id) => sources.get(id) ?? null },
    ...(kind !== 'react' ? [what({ prodBundles: false, hydratable })] : []),
    ...(kind !== 'what' ? [reactCompat()] : []),
  ];
  const log = console.log;
  console.log = () => {}; // what-react's plugin announces itself
  let output;
  try {
    output = await build({
      configFile: false,
      root: repo,
      logLevel: 'silent',
      mode: 'production',
      plugins,
      // what-compiler/vite defines it in a production build; what-react's
      // plugin alone leaves what-core's production dist to fold it.
      define: { __WHAT_DEV__: 'false' },
      resolve: { alias: sourceAliases() },
      build: {
        write: false, minify, sourcemap: 'hidden', target: 'es2022', modulePreload: false,
        rollupOptions: {
          input: entry,
          ...(framework ? { output: { codeSplitting: { groups: [
            { name: 'framework', test: /\/packages\/(core|what|react-compat)\/(src|dist)\//, priority: 2 },
            { name: 'package', test: /\/node_modules\//, priority: 1 },
          ] } } } : {}),
        },
      },
    });
  } finally {
    console.log = log;
  }
  const outs = (Array.isArray(output) ? output : [output]).flatMap((o) => o.output);
  const chunks = outs.filter((o) => o.type === 'chunk');
  const picked = framework ? chunks.filter((c) => c.name === 'framework') : chunks;
  if (picked.length !== 1) throw new Error(`expected one ${framework ? 'framework ' : ''}chunk, got ${picked.length}`);
  const others = framework ? chunks.filter((c) => c !== picked[0]).map((c) => ({ name: c.name, minBytes: Buffer.byteLength(c.code), gzipBytes: gzipSync(c.code, { level: 9 }).length })) : [];
  return { code: picked[0].code, map: picked[0].map, others };
}

// --- top-level declarations of a source module ------------------------------
const declCache = new Map();
function declarationsOf(file) {
  if (declCache.has(file)) return declCache.get(file);
  let rows = [];
  try {
    const { program } = parse(readFileSync(file, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    for (const node of program.body) {
      const decl = node.type === 'ExportNamedDeclaration' || node.type === 'ExportDefaultDeclaration' ? (node.declaration ?? node) : node;
      let name = '<module scope>';
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') name = decl.id?.name ?? '<default>';
      else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
          rows.push({ name: d.id.type === 'Identifier' ? d.id.name : '<pattern>', start: d.loc.start, end: d.loc.end });
        }
        continue;
      } else if (decl.type === 'ImportDeclaration') continue;
      rows.push({ name, start: node.loc.start, end: node.loc.end });
    }
  } catch { rows = []; }
  declCache.set(file, rows);
  return rows;
}
const before = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
function ownerOf(file, line, column) {
  const pos = { line, column };
  for (const row of declarationsOf(file)) {
    if (before(row.start, pos) && before(pos, row.end)) return row.name;
  }
  return '<module scope>';
}

// --- 1. bytes ---------------------------------------------------------------
const spec = scenarioSpec();
const min = await bundle(spec, { minify: true });
const minBytes = Buffer.byteLength(min.code);
const gzipBytes = gzipSync(min.code, { level: 9 }).length;
const map = new TraceMap(min.map);
const mappings = decodedMappings(map);
const bytes = new Map(); // "file\0name" -> bytes
let unmapped = 0;
const lineBytes = new Map();
for (const [lineNo, text] of min.code.split('\n').entries()) {
  const segments = mappings[lineNo] ?? [];
  let cursor = 0;
  for (const [i, seg] of segments.entries()) {
    const end = segments[i + 1]?.[0] ?? text.length;
    if (seg[0] > cursor) unmapped += Buffer.byteLength(text.slice(cursor, seg[0]));
    cursor = end;
    const size = Buffer.byteLength(text.slice(seg[0], end));
    if (!size) continue;
    if (seg.length < 4) { unmapped += size; continue; }
    const file = resolve(repo, map.sources[seg[1]].replace(/^(\.\.\/)+/, ''));
    const src = map.resolvedSources?.[seg[1]] ?? map.sources[seg[1]];
    const abs = src.startsWith('/') ? src : file;
    const owner = ownerOf(abs, seg[2] + 1, seg[3]);
    const key = `${relative(repo, abs)}\0${owner}`;
    if (process.env.WHY_LINES && owner === '<module scope>') { const k = `${relative(repo, abs)}:${seg[2] + 1}`; lineBytes.set(k, (lineBytes.get(k) ?? 0) + size); }
    bytes.set(key, (bytes.get(key) ?? 0) + size);
  }
  if (!segments.length) unmapped += Buffer.byteLength(text);
  unmapped += 1; // newline
}

// --- 2. referrers -----------------------------------------------------------
const readable = await bundle(spec, { minify: false });
const ast = parse(readable.code, { sourceType: 'module' });
const referrers = new Map(); // name -> Set of referring top-level names or '<module scope>'
traverse(ast, {
  Program(path) {
    for (const [name, binding] of Object.entries(path.scope.bindings)) {
      const set = new Set();
      for (const ref of [...binding.referencePaths, ...binding.constantViolations]) {
        // The top-level statement the reference sits in, and whether it is
        // inside a function there (deferred) or runs at module scope.
        let p = ref, inFunction = false, top = null;
        while (p && p.parentPath) {
          if (p.isFunction() || p.isClassMethod?.()) inFunction = true;
          if (p.parentPath.isProgram()) { top = p; break; }
          p = p.parentPath;
        }
        if (!top) continue;
        let owner = '<module scope>';
        const node = top.node.type.startsWith('Export') ? (top.node.declaration ?? top.node) : top.node;
        if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') owner = node.id?.name ?? owner;
        else if (node.type === 'VariableDeclaration') {
          // the declarator whose init holds the reference
          let q = ref;
          while (q && !q.isVariableDeclarator()) q = q.parentPath;
          const id = q?.node.id;
          owner = id?.type === 'Identifier' ? id.name : owner;
          if (!inFunction) owner += ' (at module scope)';
        } else if (!inFunction) owner = '<module scope>';
        if (owner !== name) set.add(owner);
      }
      referrers.set(name, set);
    }
    path.stop();
  },
});
// Rollup renames colliding names with a `$1` suffix; the source name is the stem.
const refs = (name) => referrers.get(name) ?? referrers.get(`${name}$1`) ?? referrers.get(`${name}$2`);

// --- report -----------------------------------------------------------------
const ratio = gzipBytes / minBytes;
const rows = [...bytes].map(([key, size]) => {
  const [file, name] = key.split('\0');
  const by = name === '<module scope>' ? null : refs(name);
  return { file: file.replace(/^packages\//, ''), name, min: size, gzip: Math.round(size * ratio), keptBy: by ? [...by].sort() : null };
}).sort((a, b) => b.min - a.min);
const modules = new Map();
for (const r of rows) modules.set(r.file, (modules.get(r.file) ?? 0) + r.min);

if (process.env.WHY_LINES) for (const [k, v] of [...lineBytes].sort((a, b) => b[1] - a[1]).slice(0, 60)) console.log('module-scope line', k, v);
const out = flag('--json');
if (typeof out === 'string') {
  writeFileSync(out, JSON.stringify({ scenario, minBytes, gzipBytes, unmapped, modules: Object.fromEntries(modules), rows }, null, 2));
}
if (flag('--text')) writeFileSync(typeof flag('--text') === 'string' ? flag('--text') : `${scenario}.bundle.js`, readable.code);

console.log(`${scenario} (vite, source${spec.framework ? ', framework chunk' : ''}): min ${minBytes} B, gzip ${gzipBytes} B, unmapped ${unmapped} B\n`);
for (const o of min.others) console.log(`  not attributed: chunk ${o.name}, min ${o.minBytes} B, gzip ${o.gzipBytes} B`);
if (min.others.length) console.log('');
console.log('by module (min B, est. gzip B):');
for (const [file, size] of [...modules].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(size).padStart(6)} ${String(Math.round(size * ratio)).padStart(6)}  ${file}`);
}
console.log('\nby declaration (min B, est. gzip B, module, name, kept by):');
for (const r of rows) {
  if (r.min < minRow) continue;
  const by = r.keptBy === null ? 'runs at module scope' : r.keptBy.length ? r.keptBy.slice(0, 8).join(', ') + (r.keptBy.length > 8 ? `, +${r.keptBy.length - 8}` : '') : '(no referrer found: exported entry or renamed)';
  console.log(`  ${String(r.min).padStart(6)} ${String(r.gzip).padStart(6)}  ${r.file.replace(/^core\/src\//, '')}  ${r.name}  <- ${by}`);
}
