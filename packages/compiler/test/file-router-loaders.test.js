// file-router codegen: loaders/getStaticPaths ride as live bindings on the
// SERVER routes module; the client module omits them (only a hasLoader flag).
// SPA pages are unaffected.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import {
  detectPageExports,
  generateRoutesModule,
  generateServerRoutesModule,
} from '../src/file-router.js';

const TMP = path.join(import.meta.dirname, '.test-loaders');
function write(rel, src) {
  const full = path.join(TMP, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, src);
}
before(() => { fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true }); });
after(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('detectPageExports', () => {
  it('detects const/function/async loader', () => {
    assert.ok(detectPageExports('export const loader = () => {}').hasLoader);
    assert.ok(detectPageExports('export function loader() {}').hasLoader);
    assert.ok(detectPageExports('export async function loader() {}').hasLoader);
  });
  it('detects getStaticPaths and page', () => {
    assert.ok(detectPageExports('export async function getStaticPaths() {}').hasGetStaticPaths);
    assert.ok(detectPageExports('export const page = { mode: "static" }').hasPageConfig);
  });
  it('does not false-positive on similar names', () => {
    assert.ok(!detectPageExports('export const loaderState = 1').hasLoader);
    assert.ok(!detectPageExports('export const getStaticPathsHelper = 1').hasGetStaticPaths);
  });
});

describe('codegen', () => {
  it('SPA page (no loader) produces no hasLoader flag — additive/compatible', () => {
    write('index.jsx', 'export default function Home() {}');
    const mod = generateRoutesModule(TMP, TMP);
    assert.match(mod, /component: _page0/);
    assert.doesNotMatch(mod, /hasLoader/);
  });

  it('client module flags a page that has a loader but does NOT import it', () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    write('index.jsx', 'export const loader = () => ({ n: 1 });\nexport default function Home() {}');
    const mod = generateRoutesModule(TMP, TMP);
    assert.match(mod, /hasLoader: true/);
    assert.doesNotMatch(mod, /\.loader/, 'client module must not reference the loader binding');
  });

  it('server module imports the namespace and attaches live loader/getStaticPaths bindings', () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    write('blog/[slug].jsx',
      'export const loader = ({ params }) => ({ slug: params.slug });\n' +
      'export async function getStaticPaths() { return { paths: [], fallback: "blocking" }; }\n' +
      'export const page = { mode: "static", revalidate: 60 };\n' +
      'export default function Post() {}');
    const mod = generateServerRoutesModule(TMP, TMP);
    assert.match(mod, /import _page0, \* as _page0_ns from/);
    assert.match(mod, /loader: _page0_ns\.loader/);
    assert.match(mod, /getStaticPaths: _page0_ns\.getStaticPaths/);
    assert.match(mod, /page: _page0_ns\.page/);
  });

  it('the generated server module is importable and exposes a callable loader', async () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    write('index.js',
      'export const loader = () => ({ hello: "world" });\n' +
      'export default function Home() { return null; }');
    const mod = generateServerRoutesModule(TMP, TMP);
    // Rewrite the root-relative import to an absolute file URL so it loads here.
    const abs = pathToFileURL(path.join(TMP, 'index.js')).href;
    const runnable = mod.replace(/from '\/index\.js'/, `from '${abs}'`);
    const outFile = path.join(TMP, '__routes.server.mjs');
    fs.writeFileSync(outFile, runnable);
    const imported = await import(pathToFileURL(outFile).href);
    assert.equal(typeof imported.routes[0].loader, 'function');
    assert.deepEqual(imported.routes[0].loader(), { hello: 'world' });
  });
});

describe('codegen: nested _layout files', () => {
  it('gives a page every layout above it, outermost first, in both modules', () => {
    fs.rmSync(TMP, { recursive: true, force: true });
    write('_layout.jsx', 'export default function Root({ children }) { return children; }');
    write('org/[orgId]/_layout.jsx', 'export default function Org({ children }) { return children; }');
    write('org/[orgId]/projects/_layout.jsx', 'export default function Projects({ children }) { return children; }');
    write('org/[orgId]/members.jsx', 'export default function Members() {}');
    write('org/[orgId]/projects/[projectId]/issues.jsx', 'export default function Issues() {}');
    write('about.jsx', 'export default function About() {}');
    for (const mod of [generateRoutesModule(TMP, TMP), generateServerRoutesModule(TMP, TMP)]) {
      const vars = {};
      for (const [, name, file] of mod.matchAll(/import (_layout\d+) from '([^']+)'/g)) vars[file] = name;
      const root = vars['/_layout.jsx'];
      const org = vars['/org/[orgId]/_layout.jsx'];
      const projects = vars['/org/[orgId]/projects/_layout.jsx'];
      const line = (p) => mod.split('\n').find((l) => l.includes(`path: '${p}'`));
      assert.ok(line('/org/:orgId/projects/:projectId/issues').includes(`layout: [${root}, ${org}, ${projects}]`), line('/org/:orgId/projects/:projectId/issues'));
      assert.ok(line('/org/:orgId/members').includes(`layout: [${root}, ${org}]`), line('/org/:orgId/members'));
      assert.ok(line('/about').includes(`layout: ${root} `), line('/about'));
    }
  });
});
