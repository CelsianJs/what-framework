/**
 * what-react Vite Plugin — One-line React → What Framework migration
 *
 * Usage:
 *   import { reactCompat } from 'what-react/vite';
 *   export default defineConfig({ plugins: [reactCompat()] });
 *
 * The plugin aliases every React import to what-react, configures JSX, and
 * keeps one what-react in the page and in a server render: in the dev
 * server, in a production build and in a server build (see REPLACED_PACKAGES,
 * the `ssr` options it returns and commonJsToEsm below).
 */
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { mixedJsx, isReactPackage } from './mixed-plugin.js';

// What the plugin itself replaces, and so keeps out of Vite's dependency
// pre-bundling in development. No list of React libraries is kept: every
// other dependency is pre-bundled by Vite as in any app (which is what turns
// a CommonJS dependency into ES modules for the browser), and inside those
// bundles `react` stays an import, because it is excluded here. The browser
// then asks the dev server for `react`, the alias below answers with
// `what-react`, and the app, what-react/mixed and every library share one
// module. (A library that is excluded instead is served file by file, and
// its CommonJS dependencies with it: react-router's `cookie`, antd's
// `is-mobile`, react-markdown's `debug` then fail with "does not provide an
// export named ...".)
//
// - react, react-dom: aliased to what-react. Excluded so that a pre-bundled
//   library's `import 'react'` is left as an import instead of being resolved
//   and inlined into each bundle.
// - use-sync-external-store: its shim entries are aliased to what-react too
//   (React 18 has the hook built in). Excluded for the same reason: a bundle
//   that inlined the alias's target would carry a second what-react.
// - what-react and the framework packages (FRAMEWORK_PACKAGES): ES modules
//   served as they are, so there is one what-core and one what-react.
const REPLACED_PACKAGES = ['react', 'react-dom', 'use-sync-external-store'];

/**
 * Resolve the directory of a package from the user's project
 */
function resolvePackageDir(packageName, fromDir) {
  try {
    const require = createRequire(fromDir + '/');
    const resolved = require.resolve(packageName);
    // Walk up from the resolved file to find the package root
    let dir = path.dirname(resolved);
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json'))) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        if (pkg.name === packageName) return dir;
      }
      dir = path.dirname(dir);
    }
    return path.dirname(resolved);
  } catch {
    return null;
  }
}

/**
 * The React packages a server render has to bundle (Vite's ssr.noExternal):
 * an external package is loaded by Node, where its `import 'react'` reaches
 * React itself instead of what-react, so a React island could not render on
 * the server. Found from the app's dependencies, and the dependencies of each
 * React package found, so a library's own React dependencies (react-redux
 * under recharts) come too.
 *
 * The two options are what a production server build adds, where the bundler
 * converts CommonJS:
 * - `commonjs`: also the React packages that ship CommonJS only. The dev
 *   server cannot run a whole CommonJS package inline, so there they stay
 *   external and an island that uses one renders in the browser.
 * - `dependencies`: also everything a React package depends on, React or not.
 *   A bundled package's imports are written into the bundle as they are, for
 *   Node to resolve, and Node refuses what bundlers accept (a directory:
 *   react-transition-group's `dom-helpers/addClass`). The dev server resolves
 *   such an import itself and needs none of this.
 */
export function detectSsrReactPackages(projectRoot, { commonjs = false, dependencies = false } = {}) {
  const found = new Set();
  const seen = new Set();
  const readPkg = (name, fromDir) => {
    for (let dir = fromDir; ; dir = path.dirname(dir)) {
      const file = path.join(dir, 'node_modules', name, 'package.json');
      if (fs.existsSync(file)) {
        try { return { pkg: JSON.parse(fs.readFileSync(file, 'utf8')), dir: path.dirname(fs.realpathSync(file)) }; } catch { return null; }
      }
      if (dir === path.dirname(dir)) return null;
    }
  };
  let app;
  try { app = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); } catch { return []; }
  // [name, where to look from, whether a React package depends on it]
  const queue = Object.keys({ ...app.dependencies, ...app.optionalDependencies }).map((name) => [name, projectRoot, false]);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const [name, fromDir, under] = next;
    if (REPLACED_PACKAGES.includes(name) || FRAMEWORK_PACKAGES.includes(name) || name === 'what-react') continue;
    // Seen as an app dependency, a package is looked at again when a React
    // package turns out to depend on it.
    const key = (under ? 'dep:' : '') + name;
    if (seen.has(key) || seen.has('dep:' + name)) continue;
    seen.add(key);
    const hit = readPkg(name, fromDir);
    if (hit === null) continue;
    const react = isReactPackage(hit.pkg);
    // A dependency that Node and a bundler load differently (no exports map,
    // a CommonJS main, an ES module build): Node takes the main, where a
    // default import is the whole exports object, so one whose main sets
    // __esModule has no callable default there (@emotion/hash 0.8, under
    // @ant-design/cssinjs: every antd island rendered empty in the dev
    // server). A bundler takes the module build, and so does Vite for a
    // bundled package: bundled in the dev server too, it is the same file
    // as in a production server build.
    const split = under && !react && hit.pkg.exports === undefined && typeof hit.pkg.module === 'string' && hit.pkg.type !== 'module';
    if (!react && !(under && dependencies) && !split) continue;
    const esm = hit.pkg.type === 'module' || Boolean(hit.pkg.module) || JSON.stringify(hit.pkg.exports ?? '').includes('"import"');
    if (esm || commonjs) found.add(name);
    const deps = react ? { ...hit.pkg.dependencies, ...hit.pkg.peerDependencies } : { ...hit.pkg.dependencies };
    for (const dep of Object.keys(deps)) queue.push([dep, hit.dir, true]);
  }
  return [...found];
}

// The packages an app reaches the engine through: what-framework's entries
// re-export what-core, what-router and what-server. They are served as ES
// modules rather than pre-bundled, so all of them share one what-core.
const FRAMEWORK_PACKAGES = ['what-framework', 'what-core', 'what-router', 'what-server'];

// Vite matches a string alias as a prefix, so 'react-dom' would also capture
// 'react-dom/server' and rewrite it to `<dir>/dom.js/server`. Each alias here
// names one module.
function exactAlias(specifier, replacement) {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { find: new RegExp(`^${escaped}$`), replacement };
}

// The major version of the Vite running the plugin: from the hook's context
// (Vite 5.1 and later), else from the Vite the project resolves.
function viteMajor(root, context) {
  const version = context && context.meta && context.meta.viteVersion;
  if (typeof version === 'string') return parseInt(version, 10) || 0;
  try {
    return parseInt(createRequire(root + '/')('vite/package.json').version, 10) || 0;
  } catch {
    return 0;
  }
}

// Whether the app's config also uses what-compiler's plugin (what()).
function usesWhatCompiler(plugins) {
  const list = Array.isArray(plugins) ? plugins.flat(Infinity) : [];
  return list.some((p) => p && typeof p === 'object' && p.name === 'vite-plugin-what');
}

// =====================================================================
// CommonJS in a dev-server render
// =====================================================================

// Vite's dev server runs the modules of a bundled package (ssr.noExternal) as
// ES modules, one by one, and does not convert CommonJS: a CommonJS file
// among them throws "exports is not defined" and takes the page's render
// with it. Bundled React packages do hold such files: @mui/material imports
// `react-transition-group/cjs/TransitionGroupContext.js` by path. Leaving the
// file to Node is not an answer, because its `require('react')` would then be
// React itself.
//
// So a CommonJS module that reaches the dev server's render is wrapped as an
// ES module: Node's module function around the code, with each
// `require('literal')` that Vite would bundle (the `react` alias, a file of
// the same package, another bundled package) turned into an import, and every
// other require left to Node's own. `module.exports` is the default export
// (its `default` when the module is a transpiled ES module), and the names
// the code assigns on `exports` are named exports. Not covered: a require
// cycle that reads the other module while it loads, and names re-exported
// with `__exportStar` or Babel's `Object.keys(...).forEach` loop.
const CJS_HINT = /\b(?:module\.exports|exports\.[\w$]|exports\[|require\s*\()/;
const ESM_HINT = /(?:^|[\n;])\s*(?:import\s*[\w$*{'"]|export\s*(?:default\b|const\b|let\b|var\b|function\b|class\b|async\b|\{|\*))/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;
const CJS_EXPORTS = '__whatReactCjsExports';

function walkAst(node, visit) {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const child of node) walkAst(child, visit); return; }
  if (typeof node.type !== 'string') return;
  visit(node);
  for (const key in node) {
    const value = node[key];
    if (value !== null && typeof value === 'object') walkAst(value, visit);
  }
}

const stringOf = (node) => (node && (node.type === 'Literal' || node.type === 'StringLiteral') && typeof node.value === 'string' ? node.value : null);
const isName = (node, name) => node != null && node.type === 'Identifier' && node.name === name;
// `exports` or `module.exports`
const isExportsObject = (node) => isName(node, 'exports')
  || (node != null && node.type === 'MemberExpression' && !node.computed && isName(node.object, 'module') && isName(node.property, 'exports'));

/**
 * What a CommonJS module's code requires by a literal name, and the names it
 * exports, read from its parse. Null when the code is an ES module.
 */
function commonJsFacts(ast) {
  const requires = new Set();
  const names = new Set();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' || node.type.startsWith('Export')) return null;
  }
  walkAst(ast, (node) => {
    if (node.type === 'ImportExpression' || node.type === 'MetaProperty') return;
    if (node.type === 'CallExpression') {
      if (isName(node.callee, 'require') && node.arguments.length === 1) {
        const source = stringOf(node.arguments[0]);
        if (source !== null) requires.add(source);
      }
      // Object.defineProperty(exports, "name", ...)
      const callee = node.callee;
      if (callee.type === 'MemberExpression' && isName(callee.object, 'Object') && isName(callee.property, 'defineProperty')
        && isExportsObject(node.arguments[0]) && stringOf(node.arguments[1]) !== null) names.add(stringOf(node.arguments[1]));
      return;
    }
    if (node.type !== 'AssignmentExpression') return;
    const left = node.left;
    if (left.type === 'MemberExpression' && isExportsObject(left.object)) {
      // exports.name = ..., exports["name"] = ...
      const name = left.computed ? stringOf(left.property) : left.property.name;
      if (typeof name === 'string') names.add(name);
    } else if (isExportsObject(left) && node.right.type === 'ObjectExpression') {
      // module.exports = { name: ..., other }
      for (const prop of node.right.properties) {
        if (prop.type !== 'Property' || prop.computed) continue;
        const name = prop.key.type === 'Identifier' ? prop.key.name : stringOf(prop.key);
        if (typeof name === 'string') names.add(name);
      }
    }
  });
  names.delete('default');
  names.delete('__esModule');
  return { requires: [...requires], names: [...names].filter((n) => IDENT_RE.test(n) && n !== CJS_EXPORTS) };
}

/**
 * The ES module that runs `code` (a CommonJS module). `inlined`: the required
 * names that become imports; every other require goes to Node. The code keeps
 * its lines, so a stack trace names the line of the file.
 */
function commonJsToEsm(code, { inlined, names }) {
  const imports = inlined.map((source, i) => `import * as __cjs${i} from ${JSON.stringify(source)};`).join(' ');
  const table = inlined.map((source, i) => `${JSON.stringify(source)}: __cjs${i}`).join(', ');
  const head = `${imports} import { createRequire as __cjsCreateRequire } from 'node:module'; import { fileURLToPath as __cjsPath } from 'node:url'; import { dirname as __cjsDir } from 'node:path';`
    + ' var __cjsModule;'
    // A function declaration: a module of a require cycle can ask for the
    // exports object before this module's code has run.
    + ` export function ${CJS_EXPORTS}() { return (__cjsModule ??= { exports: {} }).exports; }`
    + ` const __cjsInlined = { ${table} }; const __cjsNode = __cjsCreateRequire(import.meta.url);`
    + ` const __cjsRequire = (id) => { if (!Object.prototype.hasOwnProperty.call(__cjsInlined, id)) return __cjsNode(id); const m = __cjsInlined[id]; return typeof m.${CJS_EXPORTS} === 'function' ? m.${CJS_EXPORTS}() : m; };`
    + ` ${CJS_EXPORTS}(); const __cjsFile = __cjsPath(import.meta.url);`
    + ' (function (module, exports, require, __filename, __dirname) { ';
  const tail = '\n}).call(__cjsModule.exports, __cjsModule, __cjsModule.exports, __cjsRequire, __cjsFile, __cjsDir(__cjsFile));\n'
    + 'const __cjsOut = __cjsModule.exports;\n'
    + "export default (__cjsOut != null && __cjsOut.__esModule === true && 'default' in __cjsOut ? __cjsOut.default : __cjsOut);\n"
    + names.map((name, i) => `const __cjsName${i} = __cjsOut == null ? undefined : __cjsOut[${JSON.stringify(name)}]; export { __cjsName${i} as ${name} };\n`).join('');
  return head + code + tail;
}

// The package a file under node_modules belongs to.
function packageOfFile(file) {
  const at = file.lastIndexOf('/node_modules/');
  if (at === -1) return null;
  const parts = file.slice(at + '/node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Whether Vite bundles the package `name` into a server render (ssr.noExternal).
function isNoExternal(noExternal, name) {
  if (noExternal === true) return true;
  const list = Array.isArray(noExternal) ? noExternal : noExternal == null ? [] : [noExternal];
  return list.some((entry) => (entry instanceof RegExp ? entry.test(name) : entry === name));
}

/**
 * @param {object} [options]
 * @param {string[]} [options.exclude] - Additional packages to exclude from pre-bundling
 * @param {boolean} [options.autoDetect=true] - Find the React packages a server render has to
 *   bundle from the app's package.json (Vite's ssr.noExternal). Off, list them yourself.
 * @param {boolean | 'auto'} [options.mixed='auto'] - Native What files and React files in one app
 *   (MIXED.md). 'auto' turns it on when the config also has what-compiler's what() plugin.
 *   Off, every JSX file is React code.
 * @param {string | RegExp | ((file: string) => boolean) | Array<string | RegExp | ((file: string) => boolean)>} [options.react]
 *   Mixed mode: files (paths relative to the root) that are React files whatever they import.
 * @param {boolean} [options.hydrateIslands=true] - Mixed mode: a page the server rendered
 *   hydrates its React islands by adopting the server's HTML (MIXED.md, Server rendering).
 *   The plugin installs it in the modules what-compiler compiles for hydration; off, an
 *   island renders in the browser and replaces the server's HTML.
 * @returns {import('vite').Plugin[]}
 */
export function reactCompat(options = {}) {
  const { exclude = [], autoDetect = true, mixed = 'auto', hydrateIslands = true } = options;
  let mixedOn = false;
  const mixedPlugin = mixedJsx({ react: options.react });
  const mixedTransform = mixedPlugin.transform;
  const mixedHot = mixedPlugin.handleHotUpdate;
  mixedPlugin.transform = async function (code, id) {
    return mixedOn ? mixedTransform.call(this, code, id) : null;
  };
  mixedPlugin.handleHotUpdate = function (ctx) {
    return mixedOn ? mixedHot.call(this, ctx) : undefined;
  };

  // The what-react this plugin file belongs to: what `what-react` means in an
  // app whose root cannot resolve the package (the plugin was imported by
  // path).
  const ownDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  /** @type {Record<string, string> | null} `what-react` specifier → file, when the root cannot resolve it */
  let ownEntries = null;
  /** The directory of the what-react the app uses. */
  let compatDir = ownDir;
  let serving = false;
  let ssrBuild = false;
  let building = false;
  /** @type {unknown} */
  let noExternal = [];

  return [{
    name: 'what-react-compat',
    enforce: 'pre',

    config(config, env) {
      const root = path.resolve(config.root || process.cwd());
      mixedOn = mixed === true || (mixed === 'auto' && usesWhatCompiler(config.plugins));

      const installed = resolvePackageDir('what-react', root);
      compatDir = installed || ownDir;
      if (installed === null) {
        ownEntries = {};
        try {
          const { exports } = JSON.parse(fs.readFileSync(path.join(ownDir, 'package.json'), 'utf8'));
          for (const [key, target] of Object.entries(exports)) {
            const file = target && typeof target === 'object' ? target.import ?? target.default : target;
            if (typeof file === 'string') ownEntries['what-react' + key.slice(1)] = path.join(ownDir, file);
          }
        } catch { /* no package.json beside the plugin: nothing to map */ }
      }

      // `react` is the package `what-react`, by name: an import that Vite
      // leaves in a pre-bundled dependency, a file of the app and
      // what-react/mixed then all resolve to the same module. `what-react` is
      // deduped below, so the name resolves from the root whichever package
      // imports `react` (under pnpm a library cannot see what-react itself).
      const withSelector = path.join(compatDir, 'src', 'use-sync-external-store-with-selector.js');
      const alias = [
        exactAlias('react/jsx-runtime', 'what-react/jsx-runtime'),
        exactAlias('react/jsx-dev-runtime', 'what-react/jsx-dev-runtime'),
        exactAlias('react/compiler-runtime', 'what-react/compiler-runtime'),
        exactAlias('react-dom/client', 'what-react/dom'),
        exactAlias('react-dom', 'what-react/dom'),
        exactAlias('react', 'what-react'),
        // use-sync-external-store shims (needed by react-redux, zustand
        // internals). with-selector is a file of what-react that no export
        // names; it imports the package's index.js as a sibling, which is the
        // module `what-react` resolves to.
        exactAlias('use-sync-external-store/with-selector.js', withSelector),
        exactAlias('use-sync-external-store/with-selector', withSelector),
        exactAlias('use-sync-external-store/shim/with-selector.js', withSelector),
        exactAlias('use-sync-external-store/shim/with-selector', withSelector),
        exactAlias('use-sync-external-store/shim/index.js', 'what-react'),
        exactAlias('use-sync-external-store/shim', 'what-react'),
      ];

      // The automatic JSX runtime, importing from `react` (aliased to
      // what-react): Vite 8 transforms with Oxc and warns about the `esbuild`
      // option, earlier Vites only know that one.
      /** @type {import('vite').UserConfig} */
      const jsx = viteMajor(root, this) >= 8
        ? { oxc: { jsx: { runtime: 'automatic', importSource: 'react' } } }
        : { esbuild: { jsx: 'automatic', jsxImportSource: 'react' } };

      // A server render bundles what-react and the React packages, so every
      // `react` in it is one what-react. what-react always: left external,
      // Node would load a second copy beside the one the `react` alias
      // bundles, and every island would render empty (generateBundle below
      // refuses such a build).
      const building = env != null && env.command === 'build';
      const ssrPackages = autoDetect ? detectSsrReactPackages(root, { commonjs: building, dependencies: building }) : [];

      return {
        // Mixed mode: what-compiler keeps JSX for itself, and React files are
        // lowered by the mixed plugin; otherwise every file is React code.
        ...(mixedOn ? {} : jsx),
        resolve: {
          alias,
          // what-framework and what-core are not aliased: each import,
          // subpaths included, resolves through the package's own exports
          // under the active conditions (`production` in a build). Deduping
          // what-core gives the app, what-react and every kit one engine. A
          // deduped package is resolved from the root, so this applies only
          // when the root can resolve it (under pnpm an indirect what-core is
          // reachable only from the packages that depend on it).
          dedupe: [
            ...(resolvePackageDir('what-core', root) ? ['what-core'] : []),
            ...(installed !== null ? ['what-react'] : []),
          ],
        },
        optimizeDeps: {
          exclude: [...new Set([...FRAMEWORK_PACKAGES, 'what-react', ...REPLACED_PACKAGES, ...exclude])],
        },
        ssr: { noExternal: ['what-react', ...ssrPackages] },
      };
    },

    configResolved(config) {
      serving = config.command === 'serve';
      building = config.command === 'build';
      ssrBuild = building && Boolean(config.build && config.build.ssr);
      noExternal = config.ssr ? config.ssr.noExternal : [];
      console.log(`\n  ⚡ what-react compat active${mixedOn ? ' (mixed: native What files and React files)' : ''}\n`);
    },

    resolveId(id, importer, opts) {
      // A client build has no use for an island's server render: mixed.js
      // reaches server.js only where what-core renders on the server, so a
      // build for the browser gets a stand-in, and its bundle does not carry
      // the server's renderer (the dev server, and tests run through Vite,
      // keep the file).
      if (id === './server.js' && building && importer !== undefined && !isServerResolve(this, opts) && isWhatReactMixed(importer)) return SERVER_STUB;
      // An app whose root cannot resolve `what-react`: the name is this
      // plugin's own package.
      if (ownEntries === null || !Object.prototype.hasOwnProperty.call(ownEntries, id)) return null;
      return this.resolve(ownEntries[id], importer, { ...opts, skipSelf: true });
    },

    load(id) {
      return id === SERVER_STUB ? SERVER_STUB_CODE : null;
    },

    // A CommonJS module in a dev-server render (see commonJsToEsm).
    async transform(code, id, opts) {
      if (!serving || !opts || !opts.ssr) return null;
      const file = id.split('?')[0];
      if (!file.includes('/node_modules/') || !/\.c?js$/.test(file)) return null;
      if (!CJS_HINT.test(code) || ESM_HINT.test(code)) return null;
      let facts;
      try { facts = commonJsFacts(this.parse(code)); } catch { return null; }
      if (facts === null) return null;
      const inlined = [];
      for (const source of facts.requires) {
        const resolved = await this.resolve(source, id, { skipSelf: true }).catch(() => null);
        if (!resolved || resolved.external) continue;
        const target = resolved.id.split('?')[0];
        if (!path.isAbsolute(target)) continue;
        // What Vite runs inline: a file reached by path, a file outside
        // node_modules (the app, a linked package), a bundled package.
        const relative = source.startsWith('.') || path.isAbsolute(source);
        const pkg = packageOfFile(target);
        if (relative || pkg === null || isNoExternal(noExternal, pkg)) inlined.push(source);
      }
      return { code: commonJsToEsm(code, { inlined, names: facts.names }), map: null };
    },

    // A server build that would render every island empty is refused: the
    // bundle carries what-react (through the `react` alias) and also imports
    // it from node_modules, so hooks and the island renderer are two
    // runtimes that never see each other's component.
    generateBundle(_options, bundle) {
      const consumer = this.environment && this.environment.config ? this.environment.config.consumer : null;
      if (!(consumer === 'server' || (consumer === null && ssrBuild))) return;
      let bundled = false;
      const external = new Set();
      const react = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        for (const file of Object.keys(chunk.modules || {})) {
          if (file.split('?')[0].startsWith(compatDir + path.sep)) bundled = true;
        }
        for (const id of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) {
          if (/^what-react(\/|$)/.test(id)) external.add(id);
          else if (/^react(-dom)?(\/|$)/.test(id)) react.add(id);
        }
      }
      if (bundled && external.size > 0) {
        this.error(`[what-react] This server build holds two copies of what-react: it bundles one (the \`react\` alias) and also imports ${[...external].map((id) => JSON.stringify(id)).join(', ')} from node_modules, which Node loads as another. Hooks and the island renderer would not see each other's components, and every React island would render empty on the server. Take what-react out of ssr.external (reactCompat() puts it in ssr.noExternal; another plugin or the config overrides that).`);
      }
      if (react.size > 0) {
        this.warn(`[what-react] This server build imports ${[...react].map((id) => JSON.stringify(id)).join(', ')} from node_modules, which is React itself, not what-react: components that reach it cannot render in a React island. Take it out of ssr.external.`);
      }
    },
  }, mixedPlugin, {
    // A native module that what-compiler compiled for hydration (its JSX
    // claims the server's nodes) also installs island hydration: the islands
    // of the page it hydrates claim the server's regions and adopt its HTML
    // (src/hydrate.js), or, with `hydrateIslands: false`, claim the regions
    // and render over them (_claimIslands). A client build that does not
    // hydrate never imports either, and its bundle does not carry that code.
    // An import, not a call: an import is evaluated before the module's own
    // code, so the install comes first also when the module calls hydrate()
    // at its top level (a call added after that code ran after hydrate() had
    // replaced the islands). The modules it imports are the files of
    // what-react with a side effect (package.json).
    name: 'what-react-hydrate-islands',
    enforce: 'post',
    transform(code, id, opts) {
      if (!mixedOn || (opts && opts.ssr)) return null;
      // A JSX file, as what-compiler compiles them (its `include`).
      const file = id.split('?')[0];
      if (!/\.[jt]sx$/.test(file) || file.includes('/node_modules/') || file.startsWith('\0')) return null;
      const install = hydrateIslands ? HYDRATE_ISLANDS : CLAIM_ISLANDS;
      if (!HYDRATABLE_OUTPUT.test(code) || code.includes(install)) return null;
      // Appended (an import is hoisted wherever it stands): the module's own
      // lines and their source map stay as they are.
      return { code: `${code}\nimport ${JSON.stringify(install)};\n`, map: null };
    },
  }];
}

// The stand-in for what-react's server.js in a client build (resolveId): an
// island in the browser renders no server HTML (serverIsland gives undefined).
const SERVER_STUB = '\0what-react:server-stub';
const SERVER_STUB_CODE = "export function serverIsland() {}\n";

function isServerResolve(ctx, opts) {
  if (opts && opts.ssr) return true;
  const env = ctx && ctx.environment;
  return Boolean(env && env.config && env.config.consumer === 'server');
}

/** @type {Map<string, boolean>} */
const mixedFiles = new Map();

// Whether `importer` is what-react's src/mixed.js (any copy of the package).
function isWhatReactMixed(importer) {
  const file = importer.split('?')[0];
  if (!file.endsWith(path.join('src', 'mixed.js'))) return false;
  let known = mixedFiles.get(file);
  if (known === undefined) {
    try {
      known = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(file)), 'package.json'), 'utf8')).name === 'what-react';
    } catch {
      known = false;
    }
    mixedFiles.set(file, known);
  }
  return known;
}

// What only what-compiler's hydratable output imports, in the import it
// writes on a line of its own: a template that claims the server's node, and
// the JSX handed to hydrate().
const HYDRATABLE_OUTPUT = /^import\s*\{[^}]*\b_\$(?:claim|claimControl|componentVNode)\b[^}]*\}\s*from\s*['"]what-(?:framework|core)\/render['"]/m;
const HYDRATE_ISLANDS = 'what-react/hydrate-islands';
const CLAIM_ISLANDS = 'what-react/claim-islands';

export default reactCompat;
