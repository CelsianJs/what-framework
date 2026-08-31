#!/usr/bin/env node
// Drive tsc on a handful of files and parse the diagnostics.
//
// TypeScript 7 (the native compiler) no longer ships the JS `createProgram`
// API on the `typescript` package export. The `tsc` CLI is the supported
// way to typecheck, so tests and hygiene:types go through it instead of
// the old compiler host.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscJs = join(dirname(require.resolve('typescript/package.json')), 'lib', 'tsc.js');

const ERR = /^(.+?)\((\d+),(\d+)\): error TS(\d+): (.*)$/;

/**
 * @param {object} opts
 * @param {Record<string, string>} [opts.files] virtual relative path -> source
 * @param {string[]} [opts.existingFiles] absolute paths of files already on disk
 * @param {Record<string, unknown>} [opts.compilerOptions]
 * @param {string} [opts.writeRoot] directory under which virtual files are
 *   written so package resolution walks into the repo's node_modules.
 *   Required when `files` is non-empty.
 * @returns {{ file: string, line: number, character: number, code: number, message: string }[]}
 */
export function tscDiagnose({
  files = {},
  existingFiles = [],
  compilerOptions = {},
  writeRoot,
} = {}) {
  const names = Object.keys(files);
  if (names.length && !writeRoot) {
    throw new Error('tscDiagnose: writeRoot is required when compiling virtual files');
  }
  const dir = mkdtempSync(join(names.length ? writeRoot : tmpdir(), '.what-tsc-'));
  try {
    const written = [];
    for (const [name, src] of Object.entries(files)) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, src);
      written.push(p);
    }
    const tsconfig = {
      compilerOptions: {
        strict: true,
        noEmit: true,
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler',
        skipLibCheck: true,
        types: [],
        ...compilerOptions,
      },
      files: [...written, ...existingFiles],
    };
    const cfg = join(dir, 'tsconfig.json');
    writeFileSync(cfg, JSON.stringify(tsconfig));
    const result = spawnSync(process.execPath, [tscJs, '-p', cfg, '--pretty', 'false'], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    const text = `${result.stdout || ''}\n${result.stderr || ''}`;
    const diags = [];
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(ERR);
      if (!m) continue;
      diags.push({
        file: m[1],
        line: Number(m[2]),
        character: Number(m[3]),
        code: Number(m[4]),
        message: m[5],
      });
    }
    return diags;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
