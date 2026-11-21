import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { installPacked, packPackages, repo } from '../pack.mjs';

const tsc = join(repo, 'node_modules/typescript/bin/tsc');

const consumers = {
  'server.mts': {
    // what-core's declarations cover browser APIs as well as the SSR surface.
    options: { module: 'NodeNext', lib: ['ES2022'], skipLibCheck: true },
    source: `
      import { h } from 'what-core';
      import { createServer, renderToString } from 'what-server';
      import type { IslandOptions } from 'what-server/islands';
      import { renderToStream } from 'what-framework/server';
      const page = h('main', {}, 'Packed SSR');
      const html: string = renderToString(page);
      const chunks: AsyncIterable<string> = renderToStream(page);
      const server = createServer();
      const island: IslandOptions = {};
      // @ts-expect-error The consumer has no DOM globals.
      document.createElement('main');
    `,
  },
  'client.tsx': {
    options: {
      module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'],
      jsx: 'react-jsx', jsxImportSource: 'what-framework',
    },
    source: `
      import { mount, signal } from 'what-framework';
      import { jsx } from 'what-framework/jsx-runtime';
      import { jsxDEV } from 'what-framework/jsx-dev-runtime';
      import { setClass } from 'what-framework/render';
      import { navigate } from 'what-framework/router';
      import { flushEffects, render } from 'what-framework/testing';
      const count = signal(0);
      const tree = <button onClick={() => count(n => n + 1)}>{count}</button>;
      const target = document.createElement('div');
      const dispose: () => void = mount(tree, target);
      render(jsx('span', { children: 'client' }));
      setClass(target, 'pending');
      void navigate('/');
      flushEffects();
      // @ts-expect-error A numeric signal cannot accept a string.
      count('wrong');
    `,
  },
};

test('packed declarations compile in NodeNext SSR and bundler JSX consumers', t => {
  const work = mkdtempSync(join(tmpdir(), 'what-packed-types-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const tarDir = join(work, 'tarballs');
  const app = join(work, 'app');
  mkdirSync(tarDir);
  mkdirSync(app);
  const dependencies = packPackages(tarDir, ['core', 'router', 'server', 'compiler', 'what']);
  writeFileSync(join(app, 'package.json'), JSON.stringify({
    private: true, type: 'module', dependencies,
    overrides: { '@babel/core': 'file:' + join(repo, 'node_modules/@babel/core') },
  }));
  installPacked(app);

  for (const [file, { options, source }] of Object.entries(consumers)) {
    writeFileSync(join(app, file), source);
    writeFileSync(join(app, 'tsconfig.json'), JSON.stringify({
      files: [file],
      compilerOptions: { target: 'ES2022', strict: true, noEmit: true, types: [], ...options },
    }));
    try {
      execFileSync(process.execPath, [tsc, '--pretty', 'false'], { cwd: app, encoding: 'utf8', timeout: 30000 });
    } catch (error) {
      throw new Error(file + '\n' + (error.stdout || error.message), { cause: error });
    }
  }
});
