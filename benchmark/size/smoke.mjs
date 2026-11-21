// Serve only built assets on loopback and exercise the same actions in each browser build.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

function count(page, selector, expected) {
  return page.waitForFunction(
    ([selector, n]) => document.querySelectorAll(selector).length === n,
    [selector, expected],
  );
}

function text(page, selector, expected) {
  return page.waitForFunction(
    ([selector, value]) => document.querySelector(selector)?.textContent === value,
    [selector, expected],
  );
}

async function checkTodo(page) {
  const entry = page.getByRole('textbox', { name: 'New todo' });
  const rows = page.locator('li');
  const alpha = rows.filter({ hasText: 'Alpha' });
  const beta = rows.filter({ hasText: 'Beta' });

  await text(page, 'p', '0 left');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await count(page, 'li', 0);
  for (const title of ['Alpha', 'Beta']) {
    await entry.fill(title);
    await entry.press('Enter');
    assert.equal(await entry.inputValue(), '');
  }
  await text(page, 'p', '2 left');
  await beta.evaluate(node => { node.dataset.smokeIdentity = 'kept'; });
  await alpha.getByRole('checkbox').check();
  await text(page, 'p', '1 left');
  assert.equal(await beta.getAttribute('data-smoke-identity'), 'kept');

  await page.getByRole('button', { name: 'Active', exact: true }).click();
  await alpha.waitFor({ state: 'detached' });
  assert.equal(await beta.getAttribute('data-smoke-identity'), 'kept');

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await beta.waitFor({ state: 'detached' });
  assert(await alpha.getByRole('checkbox').isChecked());

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await beta.waitFor();
  const toggle = alpha.getByRole('checkbox');
  assert(await toggle.isChecked());
  await toggle.uncheck();
  await text(page, 'p', '2 left');
  await toggle.check();
  await text(page, 'p', '1 left');
  await alpha.getByRole('button', { name: 'Remove' }).click();
  await alpha.waitFor({ state: 'detached' });
  await text(page, 'p', '1 left');
  await beta.getByRole('button', { name: 'Remove' }).click();
  await text(page, 'p', '0 left');
  await count(page, 'li', 0);
}

async function checkKrausest(page) {
  await page.locator('#run').click();
  await count(page, 'tbody tr', 1000);
  await page.locator('#update').click();
  await page.waitForFunction(() => document.querySelector('tbody tr a.lbl')?.textContent.endsWith(' !!!'));
  await page.locator('tbody tr a.remove').first().click();
  await count(page, 'tbody tr', 999);
  await page.locator('#clear').click();
  await count(page, 'tbody tr', 0);
}

export async function smoke(builds) {
  const server = createServer(async (req, res) => {
    try {
      const match = /^\/(\d+)\/(.*)$/.exec(new URL(req.url, 'http://localhost').pathname);
      const root = match && builds[Number(match[1])]?.outDir;
      const file = root && path.resolve(root, decodeURIComponent(match[2]));
      if (!file?.startsWith(root + path.sep)) {
        res.writeHead(404).end();
        return;
      }
      const data = await readFile(file);
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream');
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const [i, { app, framework }] of builds.entries()) {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      try {
        const res = await page.goto(`http://127.0.0.1:${server.address().port}/${i}/index.html`);
        assert(res?.ok());
        if (app === 'hello') {
          await text(page, 'h1', 'Hello');
          await text(page, 'button', 'Count: 0');
          await page.getByRole('button', { name: 'Count: 0' }).click();
          await page.getByRole('button', { name: 'Count: 1' }).click();
          await text(page, 'button', 'Count: 2');
        } else if (app === 'todo') {
          await text(page, 'h1', 'Todo');
          await checkTodo(page);
        } else {
          await checkKrausest(page);
        }
        assert.deepEqual(errors, []);
      } catch (error) {
        throw new Error(`${app}/${framework} smoke failed${errors.length ? `: ${errors.join(', ')}` : ''}`, { cause: error });
      } finally {
        await page.close();
      }
    }
    return browser.version();
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
