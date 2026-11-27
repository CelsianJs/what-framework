// A redirect in a server render follows the browser's rule (isSafeUrl,
// ERR_UNSAFE_REDIRECT): a middleware verdict, redirect() or navigate() to an
// http(s), mailto: or tel: URL of another origin answers a Location off the
// site (the response's redirectExternal), as the browser leaves the page for
// it; an unsafe target (protocol-relative, javascript:, one with credentials)
// is refused on the server as in the browser, and the response goes to the
// app's root with ERR_SSR_UNSAFE_REDIRECT. Before, every URL of another
// origin was refused on the server and the page went to '/', while the
// browser followed it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { h } from 'what-core';
import { Router, redirect, navigate } from '../src/index.js';
import { createResponse, renderToStringAsync } from '../../server/src/index.js';

const thrown = [];
const routes = [
  { path: '/leave', middleware: [() => 'https://login.example/start?x=1'], component: () => h('p', null, 'leave') },
  { path: '/thrown', component: () => redirect('https://other.example/y') },
  { path: '/go', component: () => { navigate('https://other.example/z#top'); return null; } },
  { path: '/mail', middleware: [() => 'mailto:team@example.com'], component: () => h('p', null, 'mail') },
  { path: '/tel', component: () => redirect('tel:+15550100') },
  { path: '/protocol-relative', middleware: [() => '//evil.example/x'], component: () => h('p', null, 'x') },
  { path: '/script', component: () => { navigate('javascript:alert(1)'); return null; } },
  { path: '/credentials', middleware: [() => 'https://trusted.example@evil.example/'], component: () => h('p', null, 'x') },
  { path: '/thrown-unsafe', component: () => {
    try {
      redirect('//evil.example');
    } catch (error) {
      thrown.push(error.code);
    }
    return h('p', null, 'stayed');
  } },
];

async function render(url) {
  const response = createResponse();
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    await renderToStringAsync(h(Router, { routes, fallback: () => h('p', null, 'not found') }), { request: new Request('http://app.test' + url), response });
  } finally {
    console.warn = warn;
  }
  return { status: response.status, location: response.location, warnings };
}

describe('a redirect off the site in a server render', () => {
  it('answers a Location to an http(s), mailto: or tel: URL of another origin, as the browser follows it', async () => {
    for (const [url, location] of [
      ['/leave', 'https://login.example/start?x=1'],
      ['/thrown', 'https://other.example/y'],
      ['/go', 'https://other.example/z#top'],
      ['/mail', 'mailto:team@example.com'],
      ['/tel', 'tel:+15550100'],
    ]) {
      const out = await render(url);
      assert.equal(out.status, 302, url);
      assert.equal(out.location, location, url);
      assert.deepEqual(out.warnings, [], url);
    }
  });

  it('refuses a target the browser refuses, with its code', async () => {
    for (const url of ['/protocol-relative', '/script', '/credentials']) {
      const out = await render(url);
      assert.equal(out.location, '/', url);
      assert.match(out.warnings.join('\n'), /ERR_SSR_UNSAFE_REDIRECT/, url);
    }
    await render('/thrown-unsafe');
    assert.deepEqual(thrown, ['ERR_UNSAFE_REDIRECT']);
  });
});
