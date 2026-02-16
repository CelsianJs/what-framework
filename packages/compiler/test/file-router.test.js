// Tests for file-based router
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { scanPages, extractPageConfig, generateRoutesModule } from '../src/file-router.js';

// --- Test Fixtures ---
// Create a temporary directory structure for testing

const TMP = path.join(import.meta.dirname, '.test-pages');

function createFixture(structure) {
  // structure: { 'path/to/file.jsx': 'content' }
  for (const [filePath, content] of Object.entries(structure)) {
    const full = path.join(TMP, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

function cleanup() {
  if (fs.existsSync(TMP)) {
    fs.rmSync(TMP, { recursive: true });
  }
}

// --- scanPages Tests ---

describe('scanPages', () => {
  before(() => cleanup());
  after(() => cleanup());

  it('should discover index.jsx as root route /', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].routePath, '/');
    assert.ok(pages[0].filePath.endsWith('index.jsx'));
  });

  it('should discover named files as routes', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'about.jsx': 'export default function About() {}',
      'contact.jsx': 'export default function Contact() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 3);
    const paths = pages.map(p => p.routePath).sort();
    assert.deepEqual(paths, ['/', '/about', '/contact']);
  });

  it('should discover nested directories', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'blog/index.jsx': 'export default function BlogList() {}',
      'blog/archive.jsx': 'export default function Archive() {}',
    });

    const { pages } = scanPages(TMP);
    const paths = pages.map(p => p.routePath).sort();
    assert.deepEqual(paths, ['/', '/blog', '/blog/archive']);
  });

  it('should convert [param] to :param', () => {
    cleanup();
    createFixture({
      'users/[id].jsx': 'export default function User() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].routePath, '/users/:id');
    assert.equal(pages[0].isDynamic, true);
  });

  it('should convert [...param] to catch-all', () => {
    cleanup();
    createFixture({
      'docs/[...slug].jsx': 'export default function Docs() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].routePath, '/docs/*slug');
    assert.equal(pages[0].isDynamic, true);
  });

  it('should detect _layout.jsx files', () => {
    cleanup();
    createFixture({
      '_layout.jsx': 'export default function Layout({ children }) { return children; }',
      'index.jsx': 'export default function Home() {}',
      'blog/_layout.jsx': 'export default function BlogLayout({ children }) { return children; }',
      'blog/index.jsx': 'export default function Blog() {}',
    });

    const { pages, layouts } = scanPages(TMP);
    assert.equal(pages.length, 2);
    assert.equal(layouts.length, 2);

    const layoutPrefixes = layouts.map(l => l.urlPrefix).sort();
    assert.deepEqual(layoutPrefixes, ['/', '/blog']);
  });

  it('should strip route groups from URL', () => {
    cleanup();
    createFixture({
      '(auth)/login.jsx': 'export default function Login() {}',
      '(auth)/register.jsx': 'export default function Register() {}',
      '(marketing)/pricing.jsx': 'export default function Pricing() {}',
    });

    const { pages } = scanPages(TMP);
    const paths = pages.map(p => p.routePath).sort();
    assert.deepEqual(paths, ['/login', '/pricing', '/register']);
  });

  it('should detect API routes in api/ directory', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'api/users.js': 'export function GET() {} export function POST() {}',
      'api/users/[id].js': 'export function GET() {} export function DELETE() {}',
    });

    const { pages, apiRoutes } = scanPages(TMP);
    assert.equal(pages.length, 1);
    assert.equal(apiRoutes.length, 2);

    const apiPaths = apiRoutes.map(a => a.routePath).sort();
    assert.deepEqual(apiPaths, ['/api/users', '/api/users/:id']);
  });

  it('should sort routes: static first, dynamic middle, catch-all last', () => {
    cleanup();
    createFixture({
      '[...path].jsx': 'export default function CatchAll() {}',
      'about.jsx': 'export default function About() {}',
      'users/[id].jsx': 'export default function User() {}',
      'index.jsx': 'export default function Home() {}',
    });

    const { pages } = scanPages(TMP);
    const paths = pages.map(p => p.routePath);

    // Static routes should come before dynamic, catch-all last
    const staticRoutes = paths.filter(p => !p.includes(':') && !p.includes('*'));
    const dynamicRoutes = paths.filter(p => p.includes(':'));
    const catchAllRoutes = paths.filter(p => p.includes('*'));

    const staticIdx = paths.indexOf(staticRoutes[0]);
    const dynamicIdx = paths.indexOf(dynamicRoutes[0]);
    const catchAllIdx = paths.indexOf(catchAllRoutes[0]);

    assert.ok(staticIdx < dynamicIdx, 'Static routes should come before dynamic');
    assert.ok(dynamicIdx < catchAllIdx, 'Dynamic routes should come before catch-all');
  });

  it('should ignore non-page extensions', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'styles.css': 'body {}',
      'data.json': '{}',
      'README.md': '# Hello',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 1);
  });

  it('should handle empty directory', () => {
    cleanup();
    fs.mkdirSync(TMP, { recursive: true });

    const { pages, layouts, apiRoutes } = scanPages(TMP);
    assert.equal(pages.length, 0);
    assert.equal(layouts.length, 0);
    assert.equal(apiRoutes.length, 0);
  });

  it('should handle non-existent directory', () => {
    cleanup();
    const { pages, layouts, apiRoutes } = scanPages(path.join(TMP, 'nonexistent'));
    assert.equal(pages.length, 0);
    assert.equal(layouts.length, 0);
    assert.equal(apiRoutes.length, 0);
  });

  it('should handle deeply nested dynamic routes', () => {
    cleanup();
    createFixture({
      'org/[orgId]/projects/[projectId]/settings.jsx': 'export default function Settings() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].routePath, '/org/:orgId/projects/:projectId/settings');
  });

  it('should support .tsx, .ts, .js extensions', () => {
    cleanup();
    createFixture({
      'page1.jsx': 'export default function P1() {}',
      'page2.tsx': 'export default function P2() {}',
      'page3.js': 'export default function P3() {}',
      'page4.ts': 'export default function P4() {}',
    });

    const { pages } = scanPages(TMP);
    assert.equal(pages.length, 4);
  });
});

// --- extractPageConfig Tests ---

describe('extractPageConfig', () => {
  it('should return default config when no export', () => {
    const config = extractPageConfig('export default function Home() {}');
    assert.deepEqual(config, { mode: 'client' });
  });

  it('should extract mode: client', () => {
    const config = extractPageConfig(`
      export const page = { mode: 'client' };
      export default function Home() {}
    `);
    assert.equal(config.mode, 'client');
  });

  it('should extract mode: server', () => {
    const config = extractPageConfig(`
      export const page = { mode: 'server' };
      export default function Home() {}
    `);
    assert.equal(config.mode, 'server');
  });

  it('should extract mode: static', () => {
    const config = extractPageConfig(`
      export const page = { mode: 'static' };
      export default function About() {}
    `);
    assert.equal(config.mode, 'static');
  });

  it('should extract mode: hybrid', () => {
    const config = extractPageConfig(`
      export const page = { mode: 'hybrid' };
      export default function Product() {}
    `);
    assert.equal(config.mode, 'hybrid');
  });

  it('should handle double quotes', () => {
    const config = extractPageConfig(`
      export const page = { mode: "server" };
    `);
    assert.equal(config.mode, 'server');
  });

  it('should handle multiline declarations', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'hybrid',
      };
      export default function Page() {}
    `);
    assert.equal(config.mode, 'hybrid');
  });

  it('should handle comments in code around the declaration', () => {
    const config = extractPageConfig(`
      // This is a server page
      export const page = { mode: 'server' };
      // It renders on every request
      export default function Page() {}
    `);
    assert.equal(config.mode, 'server');
  });

  it('should default to client when page export has no mode', () => {
    const config = extractPageConfig(`
      export const page = {};
      export default function Page() {}
    `);
    assert.equal(config.mode, 'client');
  });

  it('should handle page declaration with trailing comma', () => {
    const config = extractPageConfig(`
      export const page = {
        mode: 'static',
      };
    `);
    assert.equal(config.mode, 'static');
  });
});

// --- generateRoutesModule Tests ---

describe('generateRoutesModule', () => {
  before(() => cleanup());
  after(() => cleanup());

  it('should generate valid module with imports and routes', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'about.jsx': `export const page = { mode: 'static' };\nexport default function About() {}`,
    });

    const mod = generateRoutesModule(TMP, path.dirname(TMP));
    assert.ok(mod.includes('import _page'), 'Should have page imports');
    assert.ok(mod.includes('export const routes ='), 'Should export routes');
    assert.ok(mod.includes("path: '/'"), 'Should have root route');
    assert.ok(mod.includes("path: '/about'"), 'Should have about route');
    assert.ok(mod.includes("mode: 'static'"), 'Should preserve static mode');
    assert.ok(mod.includes("mode: 'client'"), 'Should have default client mode');
  });

  it('should include layout references', () => {
    cleanup();
    createFixture({
      '_layout.jsx': 'export default function Layout({ children }) { return children; }',
      'index.jsx': 'export default function Home() {}',
    });

    const mod = generateRoutesModule(TMP, path.dirname(TMP));
    assert.ok(mod.includes('import _layout0'), 'Should import layout');
    assert.ok(mod.includes('layout: _layout0'), 'Should reference layout in route');
  });

  it('should generate API route exports', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'api/health.js': 'export function GET() { return { ok: true }; }',
    });

    const mod = generateRoutesModule(TMP, path.dirname(TMP));
    assert.ok(mod.includes('export const apiRoutes ='), 'Should export API routes');
    assert.ok(mod.includes("path: '/api/health'"), 'Should have API route path');
    assert.ok(mod.includes('import * as _api'), 'Should import API module with * as');
  });

  it('should generate pageModes export', () => {
    cleanup();
    createFixture({
      'index.jsx': 'export default function Home() {}',
      'about.jsx': `export const page = { mode: 'static' };\nexport default function About() {}`,
    });

    const mod = generateRoutesModule(TMP, path.dirname(TMP));
    assert.ok(mod.includes('export const pageModes ='), 'Should export pageModes');
    assert.ok(mod.includes("'/': 'client'"), 'Should have client mode for index');
    assert.ok(mod.includes("'/about': 'static'"), 'Should have static mode for about');
  });

  it('should match nested layouts to correct routes', () => {
    cleanup();
    createFixture({
      '_layout.jsx': 'export default function Root({ children }) { return children; }',
      'index.jsx': 'export default function Home() {}',
      'blog/_layout.jsx': 'export default function BlogLayout({ children }) { return children; }',
      'blog/index.jsx': 'export default function Blog() {}',
      'blog/[slug].jsx': 'export default function Post() {}',
      'about.jsx': 'export default function About() {}',
    });

    const mod = generateRoutesModule(TMP, path.dirname(TMP));

    // Root layout should be assigned to all pages
    // Blog layout should be assigned to blog pages
    // The generated code should have layout references
    assert.ok(mod.includes('import _layout0'), 'Should import root layout');
    assert.ok(mod.includes('import _layout1'), 'Should import blog layout');

    // Blog routes should get blog layout (closest), non-blog get root layout
    const lines = mod.split('\n').filter(l => l.includes("path: '"));
    const blogRoute = lines.find(l => l.includes("'/blog'") && !l.includes("'/blog/:slug'"));
    const postRoute = lines.find(l => l.includes("'/blog/:slug'"));
    const aboutRoute = lines.find(l => l.includes("'/about'"));
    const homeRoute = lines.find(l => l.includes("'/'"));

    // Blog and post routes should get blog layout (closer match)
    assert.ok(blogRoute.includes('_layout1'), 'Blog index should use blog layout');
    assert.ok(postRoute.includes('_layout1'), 'Blog post should use blog layout');
    // About and home should get root layout
    assert.ok(aboutRoute.includes('_layout0'), 'About should use root layout');
    assert.ok(homeRoute.includes('_layout0'), 'Home should use root layout');
  });
});

// --- Integration: Real example app structure ---

describe('integration: starter app structure', () => {
  const starterPages = path.resolve(import.meta.dirname, '../../..', 'examples/what-starter/src/pages');

  it('should scan the actual starter app pages', () => {
    // Skip if starter app doesn't exist (CI, etc)
    if (!fs.existsSync(starterPages)) return;

    const { pages, layouts } = scanPages(starterPages);

    // Should find 3 pages
    const paths = pages.map(p => p.routePath).sort();
    assert.deepEqual(paths, ['/', '/about', '/add']);

    // Should find 1 root layout
    assert.equal(layouts.length, 1);
    assert.equal(layouts[0].urlPrefix, '/');
  });

  it('should extract correct page configs from starter app', () => {
    if (!fs.existsSync(starterPages)) return;

    const { pages } = scanPages(starterPages);

    for (const page of pages) {
      const src = fs.readFileSync(page.filePath, 'utf-8');
      const config = extractPageConfig(src);

      if (page.routePath === '/about') {
        assert.equal(config.mode, 'static', 'About page should be static');
      } else {
        assert.equal(config.mode, 'client', `${page.routePath} should be client`);
      }
    }
  });

  it('should generate valid module for starter app', () => {
    if (!fs.existsSync(starterPages)) return;

    const rootDir = path.resolve(starterPages, '../..');
    const mod = generateRoutesModule(starterPages, rootDir);

    // Should be valid JS-like syntax
    assert.ok(mod.includes('export const routes ='));
    assert.ok(mod.includes('export const apiRoutes ='));
    assert.ok(mod.includes('export const pageModes ='));

    // Every route should have a component reference
    const routeLines = mod.split('\n').filter(l => l.trim().startsWith('{ path:'));
    for (const line of routeLines) {
      assert.ok(line.includes('component: _page'), `Route should have component: ${line}`);
      assert.ok(line.includes('mode:'), `Route should have mode: ${line}`);
    }
  });
});
