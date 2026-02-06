// Tests for What Framework - Router
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test route matching directly
function compilePath(path) {
  // Capture catch-all param names before normalizing
  const catchAllNames = {};
  let normalized = path.replace(/\[\.\.\.(\w+)\]/g, (_, name) => {
    catchAllNames['*'] = name;
    return '*';
  }).replace(/\[(\w+)\]/g, ':$1');
  const paramNames = [];

  const regexStr = normalized
    .split('/')
    .map(segment => {
      if (segment === '*') { paramNames.push(catchAllNames['*'] || 'rest'); return '(.+)'; }
      if (segment.startsWith(':')) { paramNames.push(segment.slice(1)); return '([^/]+)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { regex: new RegExp(`^${regexStr}$`), paramNames };
}

function matchRoute(path, routes) {
  for (const route of routes) {
    const { regex, paramNames } = compilePath(route.path);
    const match = path.match(regex);
    if (match) {
      const params = {};
      paramNames.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
      return { route, params };
    }
  }
  return null;
}

describe('route matching', () => {
  const routes = [
    { path: '/', component: 'Home' },
    { path: '/about', component: 'About' },
    { path: '/users/:id', component: 'User' },
    { path: '/users/:id/posts/:postId', component: 'UserPost' },
    { path: '/blog/*', component: 'Blog' },
    { path: '/files/[name]', component: 'File' },
    { path: '/docs/[...slug]', component: 'Docs' },
  ];

  it('should match exact paths', () => {
    const m = matchRoute('/', routes);
    assert.equal(m.route.component, 'Home');

    const m2 = matchRoute('/about', routes);
    assert.equal(m2.route.component, 'About');
  });

  it('should match dynamic params (:id)', () => {
    const m = matchRoute('/users/123', routes);
    assert.equal(m.route.component, 'User');
    assert.deepEqual(m.params, { id: '123' });
  });

  it('should match multiple dynamic params', () => {
    const m = matchRoute('/users/42/posts/7', routes);
    assert.equal(m.route.component, 'UserPost');
    assert.deepEqual(m.params, { id: '42', postId: '7' });
  });

  it('should match catch-all routes (*)', () => {
    const m = matchRoute('/blog/2024/my-post', routes);
    assert.equal(m.route.component, 'Blog');
    assert.deepEqual(m.params, { rest: '2024/my-post' });
  });

  it('should match file-based [param] syntax', () => {
    const m = matchRoute('/files/readme', routes);
    assert.equal(m.route.component, 'File');
    assert.deepEqual(m.params, { name: 'readme' });
  });

  it('should match file-based [...slug] catch-all', () => {
    const m = matchRoute('/docs/getting-started/install', routes);
    assert.equal(m.route.component, 'Docs');
    assert.deepEqual(m.params, { slug: 'getting-started/install' });
  });

  it('should return null for unmatched routes', () => {
    const m = matchRoute('/nonexistent', routes);
    assert.equal(m, null);
  });

  it('should decode URI components in params', () => {
    const m = matchRoute('/users/hello%20world', routes);
    assert.deepEqual(m.params, { id: 'hello world' });
  });
});
