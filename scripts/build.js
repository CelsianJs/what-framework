#!/usr/bin/env node

// What Framework - Build Script
// Bundles all packages into optimized single-file outputs.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

console.log('\n  Building What Framework...\n');

// --- Build core ---
buildPackage('core', [
  'reactive.js',
  'h.js',
  'dom.js',
  'hooks.js',
  'components.js',
  'store.js',
  'head.js',
  'helpers.js',
], 'index.js');

// --- Build router ---
buildPackage('router', ['index.js']);

// --- Build server ---
buildPackage('server', ['index.js', 'islands.js']);

console.log('  Done!\n');

function buildPackage(name, files, entryFile) {
  const srcDir = join(root, 'packages', name, 'src');
  const distDir = join(root, 'packages', name, 'dist');
  mkdirSync(distDir, { recursive: true });

  let totalOriginal = 0;
  let totalMinified = 0;

  for (const file of files) {
    const src = join(srcDir, file);
    if (!existsSync(src)) continue;

    const code = readFileSync(src, 'utf-8');
    const minified = minify(code);

    totalOriginal += code.length;
    totalMinified += minified.length;

    writeFileSync(join(distDir, file), minified);
  }

  // Generate entry re-export
  if (entryFile && existsSync(join(srcDir, entryFile))) {
    const entry = readFileSync(join(srcDir, entryFile), 'utf-8');
    const minEntry = minify(entry);
    writeFileSync(join(distDir, 'what.js'), minEntry);
  }

  const ratio = ((1 - totalMinified / totalOriginal) * 100).toFixed(0);
  console.log(
    `  @what/${name}  ${formatSize(totalOriginal)} → ${formatSize(totalMinified)} (${ratio}% reduction)`
  );
}

function minify(code) {
  return code
    // Remove block comments (but preserve /*! license */)
    .replace(/\/\*(?!\!)[\s\S]*?\*\//g, '')
    // Remove line comments
    .replace(/(?<![:'"])\/\/[^\n]*/g, '')
    // Collapse whitespace
    .replace(/^\s+/gm, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  return (bytes / 1024).toFixed(1) + ' kB';
}
