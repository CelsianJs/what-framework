// Run after building each checkout. Arguments are repo roots to compare.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const load = (root, path) => import(pathToFileURL(join(root, path)).href);
const cases = [
  {
    name: 'todomvc',
    ready: '.new-todo',
    target: '.todo-list input.toggle',
    component: 'TodoItem',
    async act(page, n) {
      const input = page.locator('.new-todo');
      await input.fill(`Todo ${n}`);
      await input.press('Enter');
      await page.locator('.todo-list li').filter({ hasText: `Todo ${n}` }).waitFor();
    },
    async stale(page) {
      await page.locator('.todo-list input.toggle').first().check();
    },
  },
  {
    name: 'dx-testbed',
    ready: 'input[placeholder="Search query"]',
    target: '.section:has(input[placeholder="Search query"]) .mt',
    component: 'AsyncTest',
    async act(page, n) {
      await page.locator(this.ready).fill(`Query ${n}`);
      await page.locator('.section', { has: page.locator(this.ready) }).getByRole('button', { name: 'Refetch' }).click();
      await page.getByText(`#1: Query ${n} Result 1`, { exact: true }).waitFor();
    },
    async stale(page) {
      await page.locator(this.ready).fill('Pending search');
      await page.locator('.section', { has: page.locator(this.ready) }).getByRole('button', { name: 'Refetch' }).click();
      await page.locator(this.target).getByText('Loading...', { exact: true }).waitFor();
    },
  },
];

function mismatchProbe() {
  return {
    name: 'agent-measurement-hydration',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [{
        tag: 'script', attrs: { type: 'module' }, injectTo: 'body',
        children: `
          import { h, hydrate } from 'what-framework';
          window.measureHydrationMismatch = () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.innerHTML = '<p>server</p>';
            hydrate(h(function HydrationProbe() { return h('p', {}, 'client'); }), host);
          };
        `,
      }],
    },
  };
}

async function measure(root, app, browser) {
  const [{ createBridge }, { freePortPair, connectTools }, { registerAgentTools }, { default: compiler }, { default: devtools }] = await Promise.all([
    load(root, 'packages/devtools-mcp/src/bridge.js'),
    load(root, 'packages/devtools-mcp/test/helpers/fake-page.js'),
    load(root, 'packages/devtools-mcp/src/tools-agent.js'),
    load(root, 'packages/compiler/src/vite-plugin.js'),
    load(root, 'packages/devtools-mcp/src/vite-plugin.js'),
  ]);
  const port = await freePortPair();
  const bridge = createBridge({ port, projectRoot: root });
  let tools, server, page;
  try {
    await bridge.ready;
    tools = await connectTools(bridge);
    registerAgentTools(tools.server, bridge);
    const supported = (await tools.client.listTools()).tools.some((t) => t.name === 'what_why');
    server = await createServer({
      configFile: false, root: join(root, 'examples', app.name),
      plugins: [compiler(), devtools({ port }), mismatchProbe()],
      server: { host: '127.0.0.1', port: 0, hmr: false, fs: { allow: [root] } },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    });
    await server.listen();
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
    await page.locator(app.ready).waitFor();
    // Connection setup is not part of the five tasks.
    for (let i = 0; !bridge.isConnected() && i < 300; i++) {
      if (i % 40 === 39) await page.evaluate(() => window.__WHAT_MCP_RECONNECT__?.());
      await new Promise((done) => setTimeout(done, 25));
    }
    assert.ok(bridge.isConnected(), app.name);
    await app.act(page, 1);
    const metrics = {};
    async function task(name, fn) {
      const metric = metrics[name] = { calls: 0, bytes: 0, tools: [] };
      return fn(async (tool, args) => {
        const result = await tools.call(tool, args);
        assert.ok(!result.isError && !result.parsed?.error, JSON.stringify(result.parsed));
        metric.calls++;
        metric.bytes += Buffer.byteLength(result.content.find((c) => c.type === 'text').text, 'utf8');
        metric.tools.push(tool);
        return result.parsed;
      });
    }
    await task('orient', async (call) => assert.equal((await call('what_connection_status')).connected, true));

    await app.stale(page);
    await task('stale', async (call) => {
      if (supported) {
        const why = await call('what_why', { selector: app.target });
        assert.ok(why.targets.length || why.mountRef, JSON.stringify(why));
      } else {
        const { components } = await call('what_components', { filter: `^${app.component}$` });
        const { effects } = await call('what_explain', { componentId: components[0].id, includeDOM: false });
        const target = effects.find((e) => e.lastCause?.length) ?? effects.find((e) => e.deps.length);
        assert.ok(target, JSON.stringify(effects));
        await call('what_dependency_graph', { effectId: target.id, direction: 'upstream' });
      }
    });

    for (let i = 2; i <= 4; i++) await app.act(page, i);
    await task('hot', async (call) => {
      const { hotEffects } = await call('what_diagnose', { focus: 'performance', threshold: 2 });
      assert.ok(hotEffects.length);
    });

    const diff = await task('diff', async (call) => {
      await call('what_snapshot', { mode: 'save' });
      await app.act(page, 5);
      const diff = await call('what_snapshot', { mode: 'diff' });
      assert.ok(diff.effectsRan.length);
      return diff;
    });

    await page.waitForFunction(() => typeof window.measureHydrationMismatch === 'function');
    await page.evaluate(() => window.measureHydrationMismatch());
    await task('hydration', async (call) => {
      const code = 'ERR_HYDRATION_MISMATCH';
      const { diagnostics, mismatchFixes } = await call('what_errors', { after: diff.seq, ...(supported ? { code } : {}) });
      const mismatch = diagnostics.find((d) => d.code === code);
      assert.ok(mismatch, JSON.stringify(diagnostics));
      if (supported) assert.ok(mismatchFixes[mismatch.mismatch.kind]);
      else await call('what_fix', { error: code });
    });
    return metrics;
  } finally {
    await page?.close();
    await server?.close();
    await tools?.close();
    bridge.close();
  }
}

const browser = await chromium.launch();
try {
  for (const path of process.argv.slice(2)) {
    const root = resolve(path);
    for (const app of cases) console.log(JSON.stringify({ root, app: app.name, tasks: await measure(root, app, browser) }));
  }
} finally {
  await browser.close();
}
