// Bundle a compiled snippet with the workspace packages and run it in a child
// process (runner.mjs), a bounded number at a time.
//
// Each bundle carries its own copy of what-core and of every workspace module
// the snippet reaches, resolved through the packages' `exports` maps the way an
// app's bundler resolves them. Two kinds of module stay external: third-party
// ones, which load from node_modules (which is why bundles are written under
// node_modules/.cache), and workspace modules that locate themselves through
// import.meta.url or __dirname, which load from where they are, because in a
// bundle those would point at the bundle.
//
// Bundles are code-split. Without splitting, esbuild turns every module that
// some code imports dynamically (what-devtools does import('what-core/internal'))
// into a lazily initialized wrapper, and a static re-export of one is read
// before it initializes.

import { fork, spawnSync } from 'node:child_process';
import { builtinModules } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { build } from 'esbuild';
import { splitSpecifier } from './exports.mjs';
import { compileSnippet } from './static-checks.mjs';

const RUNNER = new URL('./runner.mjs', import.meta.url).pathname;
const BUILTINS = new Set(builtinModules);
const SELF_LOCATING_RE = /\bimport\.meta\.(?:url|dirname|filename)\b|\b__dirname\b|\b__filename\b/;

function childEnv() {
  const env = { ...process.env, NODE_ENV: 'development' };
  // Set by `node --test` for the files it runs; a child that inherits it
  // reports to the test runner instead of answering over IPC.
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return env;
}

/** The global names a snippet may use: whatever the runner's environment defines. */
export function environmentGlobals() {
  const out = spawnSync(process.execPath, [RUNNER, '--globals'], { env: childEnv(), encoding: 'utf8', timeout: 30_000 });
  if (out.status !== 0) throw new Error(`snippet runner failed to start: ${out.stderr || out.error}`);
  return new Set(JSON.parse(out.stdout));
}

export class SnippetRunner {
  /**
   * @param {{ repo: string, packages: Map<string, object>, concurrency?: number, timeout?: number }} options
   */
  constructor({ repo, packages, concurrency = Math.max(2, availableParallelism() - 1), timeout = 20_000 }) {
    this.repo = repo;
    this.packages = packages;
    this.selfLocating = new Map();
    this.concurrency = concurrency;
    this.timeout = timeout;
    this.active = 0;
    this.queue = [];
    this.counter = 0;
    this.workDir = join(repo, 'node_modules', '.cache', 'what-snippets', `${process.pid}-${randomBytes(4).toString('hex')}`);
    mkdirSync(this.workDir, { recursive: true });
    writeFileSync(join(this.workDir, 'setup.mjs'), [
      "import { subscribeDiagnostics } from 'what-framework';",
      'export const diagnostics = [];',
      'subscribeDiagnostics((event) => { diagnostics.push(event); });',
      '',
    ].join('\n'));
    const mountHelper = compileSnippet([
      "import { mount } from 'what-framework';",
      "export function mountComponent(Component) { return mount(<Component />, '#app'); }",
    ].join('\n'));
    writeFileSync(join(this.workDir, 'mount.mjs'), mountHelper.code);
  }

  close() {
    rmSync(this.workDir, { recursive: true, force: true });
  }

  /**
   * Run compiled snippet code.
   * @param {string} compiled what-compiler output
   * @param {{ mount: 'default' | 'named' | null, mountName?: string }} options
   */
  run(compiled, options) {
    return new Promise((resolve) => {
      this.queue.push(() => this.runNow(compiled, options).then(resolve));
      this.next();
    });
  }

  next() {
    while (this.active < this.concurrency && this.queue.length) {
      this.active++;
      this.queue.shift()().finally(() => {
        this.active--;
        this.next();
      });
    }
  }

  async runNow(compiled, options) {
    const dir = join(this.workDir, String(++this.counter));
    mkdirSync(dir);
    try {
      const exportLine = options.mount === 'named' ? `\nexport { ${options.mountName} as __snippetMount$ };\n` : '\n';
      writeFileSync(join(dir, 'snippet.mjs'), compiled + exportLine);
      writeFileSync(join(dir, 'entry.mjs'), [
        "export { diagnostics } from '../setup.mjs';",
        "export * as snippet from './snippet.mjs';",
        "export { flushSync } from 'what-framework';",
        "export { mountComponent } from '../mount.mjs';",
        '',
      ].join('\n'));
      try {
        await build({
          entryPoints: [join(dir, 'entry.mjs')],
          outdir: join(dir, 'out'),
          outExtension: { '.js': '.mjs' },
          bundle: true,
          splitting: true,
          platform: 'node',
          format: 'esm',
          target: 'node20',
          logLevel: 'silent',
          plugins: [this.externals()],
        });
      } catch (err) {
        return { bundleError: (err.errors?.[0]?.text) || err.message };
      }
      return await this.spawn(dir, options);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  externals() {
    const { packages } = this;
    const workspace = join(this.repo, 'packages') + sep;
    const selfLocating = (file) => {
      if (!this.selfLocating.has(file)) this.selfLocating.set(file, SELF_LOCATING_RE.test(readFileSync(file, 'utf8')));
      return this.selfLocating.get(file);
    };
    return {
      name: 'what-snippet-externals',
      setup(b) {
        b.onResolve({ filter: /.*/ }, async (args) => {
          if (args.kind === 'entry-point' || args.pluginData?.resolving) return undefined;
          if (args.path.startsWith('node:') || BUILTINS.has(args.path)) return { path: args.path, external: true };
          // A `#` import is its package's own (package.json `imports`), bundled with it.
          const bare = !args.path.startsWith('.') && !args.path.startsWith('/') && !args.path.startsWith('#');
          if (bare && !packages.has(splitSpecifier(args.path).name)) return { path: args.path, external: true };
          const resolved = await b.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { resolving: true } });
          if (resolved.errors.length) return { errors: resolved.errors };
          if (resolved.path.startsWith(workspace) && selfLocating(resolved.path)) return { path: resolved.path, external: true };
          return { path: resolved.path, sideEffects: resolved.sideEffects };
        });
      },
    };
  }

  spawn(dir, options) {
    return new Promise((resolve) => {
      const child = fork(RUNNER, [join(dir, 'out', 'entry.mjs'), JSON.stringify(options)], {
        cwd: dir,
        env: childEnv(),
        execArgv: [],
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      let stderr = '';
      let answer = null;
      child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
      child.on('message', (m) => { answer = m; });
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        answer = answer || { timedOut: true };
      }, this.timeout);
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve(answer || { crashed: `runner exited (${signal || code}) without reporting${stderr ? `: ${stderr.trim().split('\n').slice(-5).join('\n')}` : ''}` });
      });
    });
  }
}
