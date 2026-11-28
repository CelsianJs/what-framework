// Module state exists once per dist tier, in every package scripts/build.js
// builds. Each dist file is the output of one source module and imports its
// siblings, so two export entries that reach one module share its state: the
// action registry, the caches, the server-context store, the devtools hooks.
// When an entry inlined the modules it reached, `node --conditions=production`
// gave what-server's root and what-server/actions a registry each, and every
// action dispatched across them answered 404.
//
// Checked against the built dist: the production tier as Node resolves it with
// `--conditions=production`, and the bundler tier as an esbuild bundle with its
// default conditions runs it.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packages } from '../../../scripts/build.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const DIST_BUILT = packages.every((name) => existsSync(join(repo, 'packages', name, 'dist')));
const NEEDS_DIST = DIST_BUILT ? false : 'needs the built dist/ (npm run build)';

const manifest = (name) => JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'));
const specifiers = (name, keep = () => true) => {
  const pkg = manifest(name);
  return Object.entries(pkg.exports).filter(([, entry]) => keep(entry)).map(([subpath]) => pkg.name + subpath.slice(1));
};
// The tiers' entries: every export of every built package for production, the
// exports with a `module` target for the bundler tier.
const PRODUCTION = packages.flatMap((name) => specifiers(name));
const BUNDLER = packages.flatMap((name) => specifiers(name, (entry) => 'module' in entry));

const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);

// A module that imports every entry of a tier, then reports each export two
// entries of one package both name but bind differently, and dispatches an
// action registered through one of what-server's entries from another.
function probe(entries, { resolve = false } = {}) {
  return `
${entries.map((specifier, i) => `import * as m${i} from ${JSON.stringify(specifier)};`).join('\n')}
const entries = [${entries.map((specifier, i) => `[${JSON.stringify(specifier)}, m${i}]`).join(', ')}];
const packageOf = (specifier) => specifier.split('/')[0];
const seen = new Map();
const split = [];
for (const [specifier, namespace] of entries) {
  for (const [name, value] of Object.entries(namespace)) {
    if (name === 'default') continue;
    const key = packageOf(specifier) + ' ' + name;
    const first = seen.get(key);
    if (!first) seen.set(key, [specifier, value]);
    else if (first[1] !== value) split.push(name + ': ' + first[0] + ' and ' + specifier);
  }
}
const root = entries.find(([s]) => s === 'what-server')[1];
const subpath = entries.find(([s]) => s === 'what-server/actions')[1];
root.action(() => 'from-root', { id: 'probe-root' });
subpath.action(() => 'from-subpath', { id: 'probe-subpath' });
const req = { headers: { 'x-csrf-token': 'probe' } };
const options = { csrfToken: 'probe' };
const dispatch = [
  await root.handleActionRequest(req, 'probe-subpath', [], options),
  await subpath.handleActionRequest(req, 'probe-root', [], options),
].map(({ status, body }) => [status, body]);
const resolved = ${resolve} ? entries.map(([s]) => import.meta.resolve(s)) : [];
console.log(JSON.stringify({ split, dispatch, registered: subpath.getRegisteredActions(), resolved }));
`;
}

function assertShared(result) {
  assert.deepEqual(result.split, [], 'an export two entries both name is a different binding in each');
  assert.deepEqual(result.dispatch, [[200, 'from-subpath'], [200, 'from-root']], 'an action registered through one entry is not found by the other');
  assert.deepEqual(result.registered, ['probe-root', 'probe-subpath']);
}

describe('dist: one file per source module', { skip: NEEDS_DIST }, () => {
  it('builds every dist file from exactly one source module', () => {
    for (const name of packages) {
      const dist = join(repo, 'packages', name, 'dist');
      for (const map of filesUnder(dist).filter((file) => file.endsWith('.js.map'))) {
        const { sources } = JSON.parse(readFileSync(map, 'utf8'));
        assert.equal(sources.length, 1, `${relative(repo, map)} inlines ${sources.join(', ')}`);
      }
    }
  });
});

describe('dist: module state is shared across entries', { skip: NEEDS_DIST }, () => {
  let tmp;
  before(() => { tmp = mkdtempSync(join(tmpdir(), 'what-shared-state-')); });
  after(() => rmSync(tmp, { recursive: true, force: true }));

  it('the production tier, under node --conditions=production', () => {
    const output = execFileSync(process.execPath, ['--conditions=production', '--input-type=module', '--eval', probe(PRODUCTION, { resolve: true })], { cwd: repo, encoding: 'utf8' });
    const result = JSON.parse(output.trim().split('\n').pop());
    assert.deepEqual(result.resolved.filter((url) => !/\/packages\/[^/]+\/dist\/.+\.min\.js$/.test(url)), [], 'resolved outside the production tier');
    assertShared(result);
  });

  it('the bundler tier, as an esbuild bundle with default conditions', async () => {
    const outfile = join(tmp, 'bundle.mjs');
    const result = await build({
      stdin: { contents: probe(BUNDLER), resolveDir: repo, loader: 'js' },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      external: ['node:*'],
      outfile,
      metafile: true,
      logLevel: 'silent',
    });
    const framework = Object.keys(result.metafile.inputs).filter((input) => input.includes('packages/'));
    assert.deepEqual(framework.filter((input) => !/packages\/(core|router|server)\/dist\/.+\.js$/.test(input) || input.endsWith('.min.js')), [], 'resolved outside the bundler tier');
    assertShared(JSON.parse(execFileSync(process.execPath, [outfile], { encoding: 'utf8' }).trim().split('\n').pop()));
  });
});
