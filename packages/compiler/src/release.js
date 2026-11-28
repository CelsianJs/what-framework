// One release of compiler and runtime per build.
//
// what-compiler's output imports the runtime helpers of its own release (from
// what-framework/render, or what-core/render in a module that imports
// what-core). npm refuses an install that mixes releases, because the packages
// declare each other as peers at the release caret. An install that skips peer
// checks (--legacy-peer-deps, --force, a package manager that only warns) does
// not, and the app then fails to build with a bundler's `is not exported`, or
// builds and renders SVG as HTML in production. So the entry points that build
// compare the installed packages with their own release first, and stop with
// ERR_COMPILER_RUNTIME_MISMATCH.
//
// Only Node can look: with no `fs` (the compiler running in a browser) there
// is nothing to check. Lookups are cached per directory. The check can only run
// if the compiler itself loads beside any what-core, so it imports none: the
// tables it shares with the runtime are copies under tables/.

let ownVersion;
const verdicts = new Map();

function numbers(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  return match ? match.slice(1, 4).map(Number) : null;
}

// Whether `version` satisfies `^base`, the range each release's packages
// declare on one another. Prerelease tags are not compared.
export function satisfiesRelease(version, base) {
  const v = numbers(version);
  const b = numbers(base);
  if (!v || !b) return false;
  if (v[0] !== b[0] || (b[0] === 0 && v[1] !== b[1])) return false;
  for (let i = 1; i < 3; i++) if (v[i] !== b[i]) return v[i] > b[i];
  return true;
}

function compilerVersion(fs) {
  if (ownVersion === undefined) {
    ownVersion = null;
    try {
      ownVersion = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
    } catch {
      // A copy bundled away from its package.json has no release to compare.
    }
  }
  return ownVersion;
}

// The package.json Node finds for the bare specifier `name` from `fromDir`.
function installed(name, fromDir, fs) {
  let dir = String(fromDir).replace(/[\\/]+$/, '');
  while (dir) {
    const file = `${dir}/node_modules/${name}/package.json`;
    if (fs.existsSync(file)) {
      try {
        return { file, version: JSON.parse(fs.readFileSync(file, 'utf8')).version };
      } catch {
        return null;
      }
    }
    const parent = dir.replace(/[\\/][^\\/]*$/, '');
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// The later of two versions.
function later(a, b) {
  const x = numbers(a) || [0, 0, 0];
  const y = numbers(b) || [0, 0, 0];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a;
}

function mismatch(compiler, name, found) {
  const target = later(compiler, found.version);
  return Object.assign(
    new Error(
      `[what-compiler] ERR_COMPILER_RUNTIME_MISMATCH: what-compiler ${compiler} cannot build for ${name} ${found.version} ` +
      `(${found.file}): compiled output runs only on the runtime of its own release. Install every What package at one ` +
      `release in one install (npm install what-framework@${target} what-compiler@${target} and each other what-* package ` +
      'you use at the same version), as step 1 of "Before you start" in UPGRADING.md says.',
    ),
    { code: 'ERR_COMPILER_RUNTIME_MISMATCH', compiler, runtime: { name, version: found.version, file: found.file } },
  );
}

/**
 * The error for a what-framework or what-core of another release than this
 * compiler where a module in `fromDir` imports it, or null.
 * `fs` is node:fs; without it, null.
 * @param {string} fromDir
 * @param {any} fs
 * @returns {Error | null}
 */
export function runtimeMismatch(fromDir, fs) {
  if (!fs || !fromDir) return null;
  if (verdicts.has(fromDir)) return verdicts.get(fromDir);
  const compiler = compilerVersion(fs);
  /** @type {Error | null} */
  let verdict = null;
  for (const name of compiler ? ['what-framework', 'what-core'] : []) {
    const found = installed(name, fromDir, fs);
    if (found && !satisfiesRelease(found.version, compiler)) {
      verdict = mismatch(compiler, name, found);
      break;
    }
  }
  verdicts.set(fromDir, verdict);
  return verdict;
}

/**
 * runtimeMismatch() for the module `filename`, with node:fs where the compiler
 * runs in Node (20.16+, 22.3+), else null. The Babel plugin's check: Babel
 * hands it the file being compiled and nothing else.
 * @param {string | null | undefined} filename
 * @returns {Error | null}
 */
export function fileRuntimeMismatch(filename) {
  if (!filename) return null;
  const host = /** @type {any} */ (globalThis).process;
  // node-floor: feature-detected; through what-compiler/vite every Node 20 release is checked
  const fs = typeof host?.getBuiltinModule === 'function' ? host.getBuiltinModule('node:fs') : null;
  return runtimeMismatch(String(filename).replace(/[\\/][^\\/]*$/, ''), fs);
}
