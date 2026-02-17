#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import generateModule from '@babel/generator';
import * as t from '@babel/types';

const traverse = traverseModule.default;
const generate = generateModule.default;

const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ROOT = process.cwd();

function usage() {
  console.log([
    'Usage:',
    '  node scripts/codemods/show-to-ternary.js [--write] [paths...]',
    '',
    'Examples:',
    '  node scripts/codemods/show-to-ternary.js src demo/src',
    '  node scripts/codemods/show-to-ternary.js --write src',
  ].join('\n'));
}

function isCodeFile(path) {
  return CODE_EXTENSIONS.has(extname(path));
}

function collectFiles(inputPath, out) {
  const abs = resolve(ROOT, inputPath);
  let stat;
  try {
    stat = statSync(abs);
  } catch {
    return;
  }

  if (stat.isFile()) {
    if (isCodeFile(abs)) out.push(abs);
    return;
  }

  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(abs)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    collectFiles(join(abs, entry), out);
  }
}

function transformSource(code, filename) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'typescript'],
  });

  let changed = false;

  traverse(ast, {
    ImportDeclaration(path) {
      const source = path.node.source.value;
      if (
        source !== 'what-framework' &&
        source !== '@what/core' &&
        source !== 'what-core'
      ) {
        return;
      }

      const next = path.node.specifiers.filter((specifier) => {
        if (!t.isImportSpecifier(specifier)) return true;
        return !(t.isIdentifier(specifier.imported) && specifier.imported.name === 'show');
      });

      if (next.length !== path.node.specifiers.length) {
        changed = true;
        if (next.length === 0) {
          path.remove();
        } else {
          path.node.specifiers = next;
        }
      }
    },

    CallExpression(path) {
      if (!t.isIdentifier(path.node.callee, { name: 'show' })) return;
      if (path.node.arguments.length === 0) return;

      const [condition, whenTrue, whenFalse] = path.node.arguments;

      const replacement = t.conditionalExpression(
        condition || t.booleanLiteral(false),
        whenTrue || t.nullLiteral(),
        whenFalse || t.nullLiteral(),
      );

      changed = true;
      path.replaceWith(replacement);
    },
  });

  if (!changed) {
    return { changed: false, output: code };
  }

  const output = generate(ast, {
    retainLines: false,
    comments: true,
    compact: false,
    sourceMaps: false,
  }, code).code;

  return { changed: true, output };
}

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  usage();
  process.exit(0);
}

const write = rawArgs.includes('--write');
const targets = rawArgs.filter(arg => arg !== '--write');
const paths = targets.length > 0 ? targets : ['src'];

const files = [];
for (const p of paths) collectFiles(p, files);

if (files.length === 0) {
  console.log('No matching files found.');
  process.exit(0);
}

let changedFiles = 0;
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { changed, output } = transformSource(src, file);
  if (!changed) continue;

  changedFiles++;
  if (write) writeFileSync(file, output + '\n');
  console.log(`${write ? 'updated' : 'would update'} ${file.replace(ROOT + '/', '')}`);
}

console.log(`\n${changedFiles} file(s) ${write ? 'updated' : 'would be updated'}.`);
if (!write) {
  console.log('Run again with --write to apply changes.');
}
