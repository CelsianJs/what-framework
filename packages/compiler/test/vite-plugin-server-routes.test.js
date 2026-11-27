// what-compiler/vite serves the file router's two routes modules: the
// browser's (`virtual:what-routes`, each page's component and layout) and the
// server entry's (`virtual:what-routes/server`, the same routes with each
// page's loader, getStaticPaths and page config), which a server-rendered
// file-router app hands createRequestHandler.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import whatVitePlugin from '../src/vite-plugin.js';

const ROOT = path.join(import.meta.dirname, '.test-server-routes');
function write(rel, src) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, src);
}

before(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  write('src/pages/index.jsx', 'export default function Home() { return null; }');
  write('src/pages/org/[orgId].jsx',
    'export const page = { mode: "server" };\n' +
    'export async function loader({ params }) { return { org: params.orgId }; }\n' +
    'export default function Org() { return null; }');
});
after(() => { fs.rmSync(ROOT, { recursive: true, force: true }); });

function plugin() {
  const p = whatVitePlugin();
  p.configResolved({ root: ROOT, command: 'build' });
  return p;
}

describe('vite plugin: the file router\'s routes modules', () => {
  it('resolves and loads virtual:what-routes/server with each page\'s loader and page config', () => {
    const p = plugin();
    const id = p.resolveId('virtual:what-routes/server');
    assert.equal(typeof id, 'string', 'virtual:what-routes/server resolves');
    const code = p.load.call({}, id, { ssr: true });
    assert.match(code, /path: '\/org\/:orgId'[^\n]*loader: _page\d+_ns\.loader/);
    assert.match(code, /page: _page\d+_ns\.page/);
  });

  it('keeps loaders out of the browser\'s virtual:what-routes', () => {
    const p = plugin();
    const id = p.resolveId('virtual:what-routes');
    const code = p.load.call({}, id, { ssr: false });
    assert.match(code, /path: '\/org\/:orgId'/);
    assert.doesNotMatch(code, /\.loader/);
    assert.notEqual(id, p.resolveId('virtual:what-routes/server'));
  });
});
