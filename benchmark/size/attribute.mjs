// Rollup's ledger is pre-minifier. Attribute final UTF-8 spans using composed sourcemaps.
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import { decodedMappings, TraceMap } from '@jridgewell/trace-mapping';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

import { bundleMarkers } from './audit.mjs';

const byBytes = (a, b) => b.minifiedBytes - a.minifiedBytes || a.source.localeCompare(b.source);

export function sourceId(repo, id) {
  if (id.startsWith('\0') && !id.startsWith('\0' + path.sep)) return id.slice(1);
  return path.relative(repo, id.replace(/^\0/, ''));
}

function addSpan(sources, id, bytes, line, column) {
  if (!sources.has(id)) sources.set(id, []);
  sources.get(id).push({ bytes, line, column });
}

function mapBytes(code, mapText, file, repo, sources) {
  const map = new TraceMap(mapText);
  const mappings = decodedMappings(map);
  const names = map.sources.map(id => sourceId(repo, path.resolve(path.dirname(file), id)));
  let assigned = 0;
  for (const [line, text] of code.split('\n').entries()) {
    const segments = mappings[line] ?? [];
    for (const [i, [start, source, sourceLine, sourceColumn]] of segments.entries()) {
      if (source === undefined) continue;
      const bytes = Buffer.byteLength(text.slice(start, segments[i + 1]?.[0]));
      if (!bytes) continue;
      addSpan(sources, names[source], bytes, sourceLine + 1, sourceColumn);
      assigned += bytes;
    }
  }
  return assigned;
}

function inside(span, node) {
  const { start, end } = node.loc;
  return (span.line > start.line || (span.line === start.line && span.column >= start.column))
    && (span.line < end.line || (span.line === end.line && span.column < end.column));
}

export async function listExports(repo, sources, modules) {
  const exports = [];
  for (const module of modules.filter(row => row.source.startsWith('packages/core/src/'))) {
    const source = await readFile(path.join(repo, module.source), 'utf8');
    const { program } = parse(source, { sourceType: 'module' });
    const declarations = new Map();
    const names = new Map();
    for (const node of program.body) {
      const isExport = node.type === 'ExportNamedDeclaration';
      if (isExport && node.source) continue;
      if (isExport) {
        for (const { local, exported } of node.specifiers) names.set(exported.name, local.name);
      }
      const decl = isExport ? node.declaration : node;
      if (!decl) continue;
      const bindings = decl.type === 'VariableDeclaration' ? decl.declarations : [decl];
      for (const binding of bindings) {
        if (binding.id?.type !== 'Identifier') continue;
        const name = binding.id.name;
        declarations.set(name, binding);
        if (isExport) names.set(name, name);
      }
    }
    for (const [name, local] of names) {
      const node = declarations.get(local);
      if (!node) continue; // Imported re-exports are attributed to their defining module.
      const minifiedBytes = (sources.get(module.source) ?? [])
        .filter(span => inside(span, node))
        .reduce((sum, span) => sum + span.bytes, 0);
      exports.push({
        name, local, source: module.source, line: node.loc.start.line, minifiedBytes,
        rollupRendered: module.renderedExports.includes(name),
      });
    }
  }
  return exports;
}

const frameworkSources = /^packages\/core\/src\/|\/node_modules\//;

export async function measureBuild(build, repo) {
  const { app, framework, outDir, chunks } = build;
  const files = (await readdir(outDir, { recursive: true }))
    .filter(file => /\.(?:m?js)$/.test(file))
    .sort();
  const sources = new Map();
  const ledger = new Map();
  const assets = [];
  let unmappedBytes = 0;
  const markers = framework.startsWith('what') ? Object.fromEntries(
    Object.entries(bundleMarkers).map(([label, [needle, source]]) => [label, { needle, source, present: false }]),
  ) : null;
  for (const file of files) {
    const absolute = path.join(outDir, file);
    const bytes = await readFile(absolute);
    const code = bytes.toString('utf8');
    for (const marker of Object.values(markers ?? {})) marker.present ||= code.includes(marker.needle);
    const map = await readFile(absolute + '.map', 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
    const assigned = map ? mapBytes(code, map, absolute, repo, sources) : 0;
    unmappedBytes += bytes.length - assigned;
    assets.push({
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      raw: bytes.length,
      gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    });
  }
  if (!assets.length) throw new Error(`No JS output for ${app}/${framework}`);
  for (const chunk of chunks ?? []) {
    for (const [id, rendered] of Object.entries(chunk.modules)) {
      const source = sourceId(repo, id);
      const current = ledger.get(source) ?? { renderedLength: 0, renderedExports: [] };
      current.renderedLength += rendered.renderedLength;
      current.renderedExports = [...new Set([...current.renderedExports, ...rendered.renderedExports])].sort();
      ledger.set(source, current);
    }
  }
  const modules = [...new Set([...ledger.keys(), ...sources.keys()])].map(source => ({
    source,
    minifiedBytes: (sources.get(source) ?? []).reduce((sum, span) => sum + span.bytes, 0),
    ...(ledger.get(source) ?? {}),
  })).sort(byBytes);
  const totals = Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [
    key, assets.reduce((sum, row) => sum + row[key], 0),
  ]));
  const frameworkBytes = sources.size
    ? modules.filter(row => frameworkSources.test(row.source)).reduce((sum, row) => sum + row.minifiedBytes, 0)
    : null;
  return {
    sources,
    result: { app, framework, ...totals, frameworkBytes, unmappedBytes, assets, modules, ...(markers && { markers }) },
  };
}
