// What's own packages are the framework, never the app.
//
// The compiler's rewrites are written for an app's source: a destructured
// prop read where it is used, a rest element kept live (_$omit), development
// names on signal() and h() calls, server action ids. A package of What's
// that ships its source (what-react, what-router, what-core in development)
// is not that source: what-react's forwardRef() destructures `ref` from props
// to call a render function, and compiled as an app's component it handed
// that function a props object Headless UI could not call hasOwnProperty on.
// So a file is What's own when the nearest package.json with a name above it
// names one of these packages and the file is one the package publishes (its
// `files`): its tests and fixtures, which no install carries, are compiled as
// any app's files are.
//
// It is decided from the package, not the path: an npm or pnpm install puts
// the files under node_modules, but a workspace link (npm, pnpm or yarn
// workspaces, `file:`, `npm link`) resolves to the package's own directory,
// where no path pattern can tell it from the app's source.
//
// Only Node can look: with no `fs` (the compiler running in a browser) no
// file is What's own. Lookups are cached per directory.

const WHAT_PACKAGES = new Set([
  'what-framework', 'what-core', 'what-compiler', 'what-react', 'what-router', 'what-server',
  'what-isr', 'what-devtools', 'what-devtools-mcp', 'what-text', 'what-mcp',
  'eslint-plugin-what', 'what-framework-cli', 'create-what',
]);

/** @type {Map<string, { name: string, root: string, files: RegExp[] | null } | null>} directory → the What package it is in */
const packages = new Map();

function parentOf(dir) {
  const parent = dir.replace(/[\\/][^\\/]*$/, '');
  return parent === dir || parent === '' ? null : parent;
}

// npm's `files` entries as patterns of a path relative to the package: a name
// is the file or the directory of that name, `*` any run of a path segment,
// `**` any number of segments.
function filePattern(entry) {
  const clean = String(entry).replace(/^\.\//, '').replace(/\/+$/, '');
  const body = clean.split(/(\*\*\/|\*\*|\*)/).map((part) => (
    part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
  )).join('');
  return new RegExp(`^${body}(?:/.*)?$`);
}

function packageAt(dir, fs) {
  if (packages.has(dir)) return packages.get(dir);
  /** @type {{ name: string, root: string, files: RegExp[] | null } | null} */
  let found;
  /** @type {any} */
  let pkg = null;
  try {
    const file = `${dir}/package.json`;
    if (fs.existsSync(file)) pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    pkg = null;
  }
  if (pkg !== null && typeof pkg.name === 'string') {
    // The nearest package with a name is the file's package: What's, or not.
    found = WHAT_PACKAGES.has(pkg.name)
      ? { name: pkg.name, root: dir, files: Array.isArray(pkg.files) ? pkg.files.map(filePattern) : null }
      : null;
  } else {
    // A package.json with no name (`{ "type": "module" }` in a directory)
    // belongs to the package around it.
    const parent = parentOf(dir);
    found = parent === null ? null : packageAt(parent, fs);
  }
  packages.set(dir, found);
  return found;
}

/**
 * Whether `file` is one of the files a package of What's publishes (the
 * package named `name`, when given). `fs` is node:fs; without it, false.
 * @param {string | null | undefined} file
 * @param {any} fs
 * @param {string} [name]
 * @returns {boolean}
 */
export function isFrameworkFile(file, fs, name) {
  if (!fs || !file) return false;
  const clean = String(file).replace(/[?#].*$/, '').replace(/\\/g, '/');
  if (clean.startsWith('\0') || !clean.includes('/')) return false;
  const dir = parentOf(clean);
  const found = dir === null ? null : packageAt(dir, fs);
  if (found === null || (name !== undefined && found.name !== name)) return false;
  const rel = clean.slice(found.root.length + 1);
  if (rel.startsWith('node_modules/') || rel.includes('/node_modules/')) return false;
  return found.files === null || found.files.some((pattern) => pattern.test(rel));
}

/**
 * isFrameworkFile() for the module Babel is compiling, with node:fs where the
 * compiler runs in Node, else false.
 * @param {string | null | undefined} filename
 * @returns {boolean}
 */
export function isFrameworkModule(filename) {
  const host = /** @type {any} */ (globalThis).process;
  // node-floor: feature-detected; through what-compiler/vite every Node 20 release is checked
  const fs = typeof host?.getBuiltinModule === 'function' ? host.getBuiltinModule('node:fs') : null;
  return isFrameworkFile(filename, fs);
}
