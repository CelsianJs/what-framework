// Showcase app dev server
import { createServer } from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const port = process.env.PORT || 3001;

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function resolveFile(pathname) {
  for (const base of [join(__dirname, 'public'), join(__dirname, 'src')]) {
    const full = join(base, pathname);
    if (existsSync(full) && statSync(full).isFile()) return full;
  }
  return null;
}

// The framework is served from the workspace source. A bare specifier
// (`what-framework/router`) or a package import (`#env`) is resolved the way
// Node and Vite resolve it, through the package's `exports` or `imports` map
// with the `development` condition, and rewritten to a /framework/ URL.
const packagesDir = join(__dirname, '..', '..', 'packages');
const PACKAGES = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server' };
const manifests = new Map();

function manifest(dir) {
  if (!manifests.has(dir)) manifests.set(dir, JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf-8')));
  return manifests.get(dir);
}

function target(entry) {
  if (typeof entry === 'string') return entry;
  return entry && target(entry.development ?? entry.import ?? entry.default);
}

function resolveSpecifier(specifier, fromDir) {
  if (specifier.startsWith('#')) {
    const file = fromDir && target(manifest(fromDir).imports?.[specifier]);
    return file && `/framework/${fromDir}/${file.slice(2)}`;
  }
  const [, name, subpath] = specifier.match(/^(what-[a-z]+)(\/.*)?$/) ?? [];
  const dir = PACKAGES[name];
  const file = dir && target(manifest(dir).exports?.['.' + (subpath ?? '')]);
  return file && `/framework/${dir}/${file.slice(2)}`;
}

function transformImports(code, fromDir) {
  return code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"./][^'"]*)\2/g,
    (whole, keyword, quote, specifier) => {
      const url = resolveSpecifier(specifier, fromDir);
      return url ? keyword + quote + url + quote : whole;
    });
}

// The response for a request path: { status, type, body }. The dev server
// below sends it, and the workspace smoke (smoke/workspace-apps.mjs) serves
// the site through it.
export function respond(pathname) {
  // Framework source files
  if (pathname.startsWith('/framework/')) {
    const frameworkPath = join(packagesDir, pathname.slice(11));
    if (frameworkPath.startsWith(packagesDir + sep) && existsSync(frameworkPath) && statSync(frameworkPath).isFile()) {
      const code = transformImports(readFileSync(frameworkPath, 'utf-8'), pathname.split('/')[2]);
      return { status: 200, type: 'application/javascript', body: code };
    }
  }

  const file = resolveFile(pathname === '/' ? '/index.html' : pathname);
  if (file) {
    const ext = extname(file);
    const content = readFileSync(file);
    return { status: 200, type: MIME[ext] || 'application/octet-stream', body: ext === '.js' ? transformImports(content.toString('utf-8')) : content };
  }

  // SPA fallback
  return { status: 200, type: 'text/html', body: readFileSync(join(__dirname, 'public', 'index.html')) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createServer((req, res) => {
    const { status, type, body } = respond(new URL(req.url, `http://localhost:${port}`).pathname);
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(body);
  }).listen(port, () => {
    console.log(`\n  What Showcase\n  http://localhost:${port}\n`);
  });
}
