#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const PACKAGE_DIRS = [
  'packages/core',
  'packages/router',
  'packages/server',
  'packages/compiler',
  'packages/devtools',
  'packages/devtools-mcp',
  'packages/react-compat',
  'packages/what',
];

const workspace = mkdtempSync(join(tmpdir(), 'what-fw-types-smoke-'));
const tarballDir = join(workspace, 'tarballs');
const consumerDir = join(workspace, 'consumer');

try {
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  const tarballs = [];
  for (const relDir of PACKAGE_DIRS) {
    const pkgDir = join(repoRoot, relDir);
    const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    if (pkg.private) continue;
    console.log(`[types-smoke] Packing ${pkg.name}@${pkg.version}`);
    const result = run('npm', ['pack', '--json', '--pack-destination', tarballDir], { cwd: pkgDir, capture: true });
    const packed = JSON.parse(result.stdout);
    const filename = packed[0]?.filename;
    if (!filename) throw new Error(`npm pack did not report a tarball for ${pkg.name}`);
    tarballs.push(join(tarballDir, filename));
  }

  writeFileSync(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'what-fw-types-consumer-smoke',
    private: true,
    type: 'module',
    devDependencies: {
      typescript: '^5.9.3',
    },
  }, null, 2));

  console.log('[types-smoke] Installing packed packages into a clean TypeScript consumer');
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', ...tarballs], { cwd: consumerDir });

  writeFileSync(join(consumerDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ESNext',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      jsx: 'react-jsx',
      jsxImportSource: 'what-react',
      skipLibCheck: false,
      noEmit: true,
      types: [],
      lib: ['ESNext', 'DOM'],
    },
    include: ['index.ts', 'component.tsx'],
  }, null, 2));

  writeFileSync(join(consumerDir, 'index.ts'), `
import { h, signal, computed, isSafeUrl } from 'what-framework';
import { Link, navigate, isSafeUrl as routerSafe } from 'what-framework/router';
import { renderToString } from 'what-framework/server';
import { createRoot, createPortal, version } from 'what-react/dom';
import React, { Children, Component, Fragment, createElement, createRef, forwardRef, useEffect, useRef, useState, useSyncExternalStore } from 'what-react';
import { jsx, jsxs } from 'what-react/jsx-runtime';
import { reactCompat } from 'what-react/vite';
import { connectDevToolsMCP } from 'what-devtools-mcp/client';
import whatDevToolsMCP from 'what-devtools-mcp/vite-plugin';

const count = signal(1, 'count');
const doubled = computed(() => count() * 2);
const safe: boolean = isSafeUrl('/ok') && routerSafe('#hash');
const vnode = Link({ href: '/about', children: 'About' });
void doubled;
void safe;
void vnode;
void navigate('/next');
void renderToString(h('main', null, 'hello'));

const ref = createRef<HTMLButtonElement>();
const Fancy = forwardRef<HTMLButtonElement, { label: string }>((props, forwardedRef) => createElement('button', { ref: forwardedRef }, props.label));
const root = createRoot(document.createElement('div'));
root.render(createElement(Fragment, null, createElement(Fancy, { label: 'OK', ref })));
root.unmount();
void createPortal('portal', document.body);
void version;
void Children.count(['a', null, 'b']);
void jsx('div', { children: 'x' });
void jsxs('div', { children: ['x', 'y'] });
void reactCompat({ exclude: ['react'] });
const mcpConn = connectDevToolsMCP({ port: 9229, host: '127.0.0.1', token: 'dev' });
void mcpConn.isConnected;
mcpConn.disconnect();
void whatDevToolsMCP({ host: '127.0.0.1' });

class Demo extends Component<{ initial: number }, { value: number }> {
  state = { value: this.props.initial };
  render() { return createElement('span', null, this.state.value); }
}
void Demo;
void React.createElement('div');

function subscribe(cb: () => void) { cb(); return () => {}; }
const snapshot = () => 1;
const storeValue: number = useSyncExternalStore(subscribe, snapshot);
void storeValue;

function Hooks() {
  const [value, setValue] = useState(0);
  const localRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setValue(prev => prev + 1); }, []);
  return createElement('div', { ref: localRef }, value);
}
void Hooks;
`);

  writeFileSync(join(consumerDir, 'component.tsx'), `
import { useState } from 'what-react';

export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(prev => prev + 1)}>Count: {count}</button>;
}
`);

  run('npx', ['tsc', '--noEmit'], { cwd: consumerDir });
  console.log('[types-smoke] TypeScript declaration smoke passed');
} finally {
  if (process.env.KEEP_TYPES_SMOKE_TMP) {
    console.log(`[types-smoke] Kept temp directory: ${workspace}`);
  } else {
    rmSync(workspace, { recursive: true, force: true });
  }
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });

  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${cmd} ${args.join(' ')} failed with exit ${result.status}`);
  }

  return result;
}
