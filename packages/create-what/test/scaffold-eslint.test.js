// Every template's `npm run lint` parses TypeScript: the scaffold's
// eslint.config.js layers typescript-eslint's parser over .ts and .tsx and
// reports unused variables, and the scaffold installs what that config
// imports. The real lint of a .tsx file, over a registry install, is
// scripts/smoke-scaffold.mjs's (lintTypeScript).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createWhat = resolve(repoRoot, 'packages/create-what/index.js');
const plugin = JSON.parse(await readFile(resolve(repoRoot, 'packages/eslint-plugin/package.json'), 'utf8'));

async function scaffold(name, args, input) {
  const cwd = await mkdtemp(join(tmpdir(), 'create-what-eslint-'));
  const result = spawnSync(process.execPath, [createWhat, name, ...args], { cwd, input, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { cwd, root: join(cwd, name) };
}

for (const [label, args, input, preset] of [
  ['spa', ['--template=spa'], 'n\n1\n', 'compiler'],
  ['fullstack', ['--fullstack', '--yes'], undefined, 'recommended'],
  ['islands', ['--template=islands', '--yes'], undefined, 'recommended'],
]) {
  test(`the ${label} scaffold lints TypeScript and unused variables`, async () => {
    const { cwd, root } = await scaffold(`lint-${label}`, args, input);
    try {
      const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
      const dev = pkg.devDependencies;
      assert.equal(pkg.scripts.lint, 'eslint .');
      assert.equal(dev.eslint, '^10.0.0', 'the current ESLint major, which npm does not call unsupported');
      assert.equal(plugin.peerDependencies.eslint, '>=9.0.0', 'eslint-plugin-what peers on it');
      assert.match(dev['typescript-eslint'], /^\^8\./, 'the config\'s TypeScript parser is installed');
      const config = await readFile(join(root, 'eslint.config.js'), 'utf8');
      assert.match(config, /^import tseslint from 'typescript-eslint';$/m);
      assert.match(config, new RegExp(`what\\.configs\\.${preset},`));
      assert.match(config, /files: \['\*\*\/\*\.\{ts,tsx,mts,cts\}'\],\n\s+languageOptions: \{ parser: tseslint\.parser \}/);
      assert.match(config, /'no-unused-vars': \['warn'/, 'JavaScript reports unused variables');
      assert.match(config, /'@typescript-eslint\/no-unused-vars': \['warn'/, 'and TypeScript with the rule that knows types');
      // The config is a module ESLint can load: it parses.
      const check = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: config, encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
