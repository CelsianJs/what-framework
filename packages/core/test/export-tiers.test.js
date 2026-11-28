// Every export of the packages whose source reads __DEV__ names its tiers by
// condition (docs/ARCHITECTURE.md, "Development and production tiers"):
// `production` the dist/*.min.js with development code removed, `module` the
// bundler tier (dist/*.js, checks read process.env.NODE_ENV), and the source
// for `development`, `node`, `import` and `default`. `development` and
// `production` come first, so a tool that names either never reaches `module`
// (Vite, webpack, Rollup with @rollup/plugin-node-resolve, Bun's development
// build); esbuild and rolldown with their default conditions do reach it, and
// follow the process.env.NODE_ENV they define (`"development"` unless they
// minify). `node` comes before `module`, so a server bundle resolves the
// source as Node does. A bundler resolves the first key it accepts, so the
// order is the behaviour.
//
// The source reads the flag through what-core's `#env` import, which follows
// the same conditions: env-development.js under `development`, so a
// development build reports diagnostics wherever it runs, and env.js
// otherwise, whose runtime probe page markup cannot switch.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { rolldown } from 'rolldown';
import { JSDOM } from 'jsdom';
import { packages as BUILT } from '../../../scripts/build.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const ORDER = ['types', 'development', 'production', 'node', 'module', 'import', 'default'];
const PACKAGES = ['core', 'router', 'server'];
const DIST_BUILT = PACKAGES.every((name) => existsSync(join(repo, 'packages', name, 'dist', 'index.js')));

const manifest = (name) => JSON.parse(readFileSync(join(repo, 'packages', name, 'package.json'), 'utf8'));

// A `files` entry as a pattern over package-relative paths (`**/` any
// directories, `*` within one).
function globPattern(entry) {
  const source = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*');
  return new RegExp(`^${source}(?:/.*)?$`);
}

// The tiers of one export, without a `node` branch that names its own files
// (what-server's root: the Node entry, which only Node-side code resolves).
function tiers(entry) {
  const branch = typeof entry.node === 'object' ? entry.node : null;
  const flat = Object.fromEntries(Object.entries(entry).filter(([key]) => !(branch && key === 'node')));
  return { branch, flat };
}

// The file esbuild resolves `specifier` to from the repo root.
async function resolveWith(specifier, options) {
  let resolved = null;
  await build({
    stdin: { contents: `import ${JSON.stringify(specifier)};`, resolveDir: repo },
    bundle: true,
    write: false,
    logLevel: 'silent',
    ...options,
    plugins: [{
      name: 'capture',
      setup(b) {
        b.onResolve({ filter: /^what-/ }, async (args) => {
          if (args.pluginData) return undefined;
          const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: true });
          resolved = r.path;
          return { path: r.path, external: true };
        });
      },
    }],
  });
  return resolved;
}

for (const name of PACKAGES) {
  const pkg = manifest(name);
  describe(pkg.name, () => {
    it('lists every export in tier order, each tier at its file', () => {
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const { branch, flat } = tiers(entry);
        const keys = Object.keys(flat);
        assert.deepEqual(keys, ORDER.filter((key) => key in flat && !(branch && key === 'node')), `${subpath}: condition order`);
        assert.deepEqual(keys.filter((key) => key !== 'types'), ORDER.filter((key) => key !== 'types' && !(branch && key === 'node')), `${subpath}: every tier named`);
        assert.equal(flat.development, flat.import, `${subpath}: development is the source`);
        if (!branch) assert.equal(flat.node, flat.import, `${subpath}: node is the source`);
        assert.equal(flat.default, flat.import, `${subpath}: default is the source`);
        assert.match(flat.production, /^\.\/dist\/.+\.min\.js$/, `${subpath}: production`);
        assert.equal(flat.module, flat.production.replace(/\.min\.js$/, '.js'), `${subpath}: module is the bundler tier beside it`);
        if (branch) assert.ok(!('module' in branch), `${subpath}: the node branch has no bundler tier`);
      }
    });

    it('publishes every file an export names', () => {
      const published = pkg.files.map(globPattern);
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const { branch, flat } = tiers(entry);
        for (const target of [flat.production, flat.module, ...(branch ? [branch.production] : [])]) {
          assert.ok(published.some((pattern) => pattern.test(target.slice(2))), `${subpath}: ${target} is not in files`);
        }
      }
    });

    it('resolves each tier by condition', { skip: DIST_BUILT ? false : 'needs the built dist/ (npm run build)' }, async () => {
      for (const [subpath, entry] of Object.entries(pkg.exports)) {
        const specifier = pkg.name + subpath.slice(1);
        const { branch, flat } = tiers(entry);
        const file = (target) => join(repo, 'packages', name, target);
        assert.equal(await resolveWith(specifier, { platform: 'browser' }), file(flat.module), `${specifier}: esbuild's defaults`);
        assert.equal(await resolveWith(specifier, { platform: 'browser', conditions: ['production'] }), file(flat.production), `${specifier}: production`);
        assert.equal(await resolveWith(specifier, { platform: 'browser', conditions: ['development'] }), file(flat.development), `${specifier}: development`);
        assert.equal(await resolveWith(specifier, { platform: 'node' }), file(branch ? branch.import : flat.node), `${specifier}: a server bundle`);
        assert.equal(import.meta.resolve(specifier), `file://${file(branch ? branch.import : flat.import)}`, `${specifier}: Node`);
      }
    });
  });
}

// The build writes only the modules an export reaches, each of which another
// published file imports, so every file it writes must be published.
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)]);

describe('every built package', () => {
  for (const name of BUILT) {
    const dist = join(repo, 'packages', name, 'dist');
    it(`${manifest(name).name} publishes every module the build writes`, { skip: existsSync(dist) ? false : 'needs the built dist/ (npm run build)' }, () => {
      const published = manifest(name).files.map(globPattern);
      const unpublished = filesUnder(dist)
        .filter((file) => file.endsWith('.js'))
        .map((file) => relative(join(repo, 'packages', name), file))
        .filter((file) => !published.some((pattern) => pattern.test(file)));
      assert.deepEqual(unpublished, [], `${name}: built but not in files`);
    });
  }
});

// --- The development flag in a browser ---------------------------------------
// Each bundle runs in a jsdom page, as a classic script: no `process`, no
// import.meta.env, only what the page itself defines. It reports `__DEV__`
// and whether reading a signal without calling it was reported
// (ERR_MISSING_SIGNAL_READ, a development diagnostic).
const PROBE = "import { signal } from 'what-core';\nimport { __DEV__ } from 'what-core/internal';\nString(signal(7));\nglobalThis.__probe = __DEV__;\n";

function runInPage(code, body = '') {
  const dom = new JSDOM(`<!doctype html><body>${body}</body>`, { runScripts: 'outside-only' });
  const reported = [];
  for (const level of ['warn', 'error', 'info', 'log']) dom.window.console[level] = (...args) => reported.push(args.join(' '));
  dom.window.eval(code);
  const result = { dev: dom.window.__probe, diagnostic: reported.some((line) => line.includes('ERR_MISSING_SIGNAL_READ')) };
  dom.window.close();
  return result;
}

const esbuildIife = async (options) => (await build({
  stdin: { contents: PROBE, resolveDir: repo, loader: 'js' },
  bundle: true, write: false, format: 'iife', logLevel: 'silent', ...options,
})).outputFiles[0].text;

const rolldownIife = async (options) => {
  const dir = mkdtempSync(join(repo, 'node_modules', '.what-tier-probe-'));
  try {
    writeFileSync(join(dir, 'app.js'), PROBE);
    const bundle = await rolldown({ input: join(dir, 'app.js'), logLevel: 'silent', ...options });
    const { output } = await bundle.generate({ format: 'iife' });
    await bundle.close();
    return output[0].code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const BUN = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0;
const bunIife = (args) => {
  const dir = mkdtempSync(join(tmpdir(), 'what-tier-bun-'));
  try {
    const app = join(repo, 'node_modules', `.what-tier-probe-${process.pid}.js`);
    writeFileSync(app, PROBE);
    try {
      const out = spawnSync('bun', ['build', app, '--format=iife', `--outfile=${join(dir, 'out.js')}`, ...args], { encoding: 'utf8' });
      assert.equal(out.status, 0, out.stderr);
    } finally {
      rmSync(app, { force: true });
    }
    return readFileSync(join(dir, 'out.js'), 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe('the development flag in a browser bundle', { skip: DIST_BUILT ? false : 'needs the built dist/ (npm run build)' }, () => {
  // A tool that passes `development` the way Vite's dev server, webpack's
  // development mode, Rollup with node-resolve and NODE_ENV=development, and
  // `bun build` do.
  it('a development build reports diagnostics with no process in the page: esbuild given `development`', async () => {
    assert.deepEqual(runInPage(await esbuildIife({ conditions: ['development'] })), { dev: true, diagnostic: true });
  });

  it('a development build reports diagnostics: rolldown given `development`', async () => {
    assert.deepEqual(runInPage(await rolldownIife({ resolve: { conditionNames: ['development', 'import'] } })), { dev: true, diagnostic: true });
  });

  it('a development build reports diagnostics: `bun build` with its defaults', { skip: BUN ? false : 'bun is not installed' }, () => {
    assert.deepEqual(runInPage(bunIife([])), { dev: true, diagnostic: true });
  });

  it('production builds run none of it: the production condition, and `bun build --production`', async () => {
    assert.deepEqual(runInPage(await esbuildIife({ conditions: ['production'], minify: true })), { dev: false, diagnostic: false });
    if (BUN) assert.deepEqual(runInPage(bunIife(['--production'])), { dev: false, diagnostic: false });
  });

  // esbuild and rolldown with their default conditions resolve `module` and
  // define process.env.NODE_ENV themselves: "development" unless they minify.
  it('the bundler tier follows the bundler\'s NODE_ENV: development unminified, production minified', async () => {
    assert.deepEqual(runInPage(await esbuildIife({})), { dev: true, diagnostic: true });
    assert.deepEqual(runInPage(await esbuildIife({ minify: true })), { dev: false, diagnostic: false });
    assert.deepEqual(runInPage(await rolldownIife({})), { dev: true, diagnostic: true });
    assert.deepEqual(runInPage(await rolldownIife({ transform: { define: { 'process.env.NODE_ENV': '"production"' } } })), { dev: false, diagnostic: false });
  });

  // The source tier without `development`: an import map, or a bundler given
  // custom conditions. Page markup can name a global `process` and its `env`
  // (`<form id="process"><input name="env">` in a browser; two elements with
  // the id, one named `env`, in jsdom too), and a probe that trusted it read
  // `process.env.NODE_ENV` as undefined and switched development on.
  it('the source tier\'s runtime probe is not switched by markup that names `process`', async () => {
    const code = await esbuildIife({ conditions: ['browser'] });
    assert.deepEqual(runInPage(code), { dev: false, diagnostic: false });
    assert.deepEqual(runInPage(code, '<a id="process"></a><a id="process" name="env"></a>'), { dev: false, diagnostic: false });
    assert.deepEqual(runInPage(code, '<a id="process"></a><a id="process" name="env"></a><a id="process" name="versions"></a>'), { dev: false, diagnostic: false });
    assert.deepEqual(runInPage(`globalThis.__WHAT_DEV__ = true;\n${code}`), { dev: true, diagnostic: true }, 'the page\'s own script still switches it');
  });
});
