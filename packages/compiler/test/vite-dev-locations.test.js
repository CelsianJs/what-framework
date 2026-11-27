// Development locations name the line you wrote. Vite reprints a .tsx file
// with esbuild (oxc on Vite 8) before what-compiler's plugin runs (comments
// dropped, TypeScript stripped), so the plugin maps each development location
// back through the combined source map. A .jsx file reaches the plugin as
// written, and the dev server serves it with each statement on its source
// line, so a stack trace names the line too.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import whatVitePlugin from '../src/vite-plugin.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = fs.mkdtempSync(path.join(here, '.vite-locations-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const { createServer } = await import(createRequire(import.meta.url).resolve('vite'));

const SOURCE = [
  '// A comment esbuild drops.',
  '/* And a block comment',
  '   over two lines. */',
  "import { signal } from 'what-framework';",
  '',
  'type Props = { label: string };',
  '',
  'function Badge(props: Props) {',
  "  const on = signal(false, 'on');",
  '  return <b>{props.label}</b>;',
  '}',
  '',
  'export function App() {',
  '  return (',
  '    <main>',
  '      <Badge label="x" />',
  '    </main>',
  '  );',
  '}',
  '',
].join('\n');

test('a development location points at the line and column of the source as written', async () => {
  fs.writeFileSync(path.join(root, 'App.tsx'), SOURCE);
  const vite = await createServer({
    root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false },
    plugins: [whatVitePlugin({ prodBundles: false, hot: false })],
  });
  try {
    const { code } = await vite.transformRequest('/App.tsx');
    const locs = Object.fromEntries([...code.matchAll(/"(\w+)@App\.tsx:(\d+):(\d+)"/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
    assert.deepEqual(locs.on, [9, 14], `signal "on" is created at 9:14 (${JSON.stringify(locs)})`);
    assert.deepEqual(locs.Badge, [16, 7], `<Badge> is written at 16:7 (${JSON.stringify(locs)})`);
  } finally {
    await vite.close();
  }
});

test('the dev server serves a .jsx file with each statement on its source line', async () => {
  const lines = [
    "import { signal } from 'what-framework';",
    '',
    'const count = signal(1);',
    '',
    'export function thrower() {',
    "  throw new Error('boom');",
    '}',
    '',
    'export function Card({ title }) {',
    '  return <section class="card"><h2>{title}</h2><p>body</p></section>;',
    '}',
    '',
    'export function App() {',
    '  const text = `count: ${count}`;',
    '  return <div><p>{text}</p><Card title="a" /></div>;',
    '}',
    '',
  ];
  fs.writeFileSync(path.join(root, 'Lines.jsx'), lines.join('\n'));
  const vite = await createServer({
    root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false },
    plugins: [whatVitePlugin({ prodBundles: false })],
  });
  try {
    const { code } = await vite.transformRequest('/Lines.jsx');
    const served = code.split('\n');
    for (const [line, statement] of [[3, 'const count = signal(1'], [6, "throw new Error('boom');"], [14, 'const text = `count: ${count}`;']]) {
      assert.ok(served[line - 1].trimStart().startsWith(statement), `line ${line} holds \`${statement}\`, not \`${served[line - 1]}\``);
    }
    assert.match(code, /"p\.children@Lines\.jsx:15:18"/, 'a development location names the column written');
  } finally {
    await vite.close();
  }
});

// With @babel/plugin-transform-typescript installed in the app, a .tsx file
// skips the bundler's transformer too: its types are stripped in the plugin's
// own Babel pass, and the dev server serves it with each statement on its
// source line. The stand-in below strips the type syntax the source uses.
const TS_STAND_IN = `module.exports = function stripTypes(api, options) {
  globalThis.__whatTsOptions = options;
  const drop = (p) => p.remove();
  return {
    visitor: {
      TSTypeAliasDeclaration: drop,
      TSInterfaceDeclaration: drop,
      TSTypeAnnotation: drop,
      TSTypeParameterInstantiation: drop,
      TSAsExpression(p) { p.replaceWith(p.node.expression); },
    },
  };
};`;

test('with the TypeScript Babel plugin installed, the dev server serves a .tsx file with each statement on its source line', async () => {
  const tsRoot = fs.mkdtempSync(path.join(here, '.vite-tsx-lines-'));
  try {
    const pluginDir = path.join(tsRoot, 'node_modules', '@babel', 'plugin-transform-typescript');
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify({ name: '@babel/plugin-transform-typescript', main: 'index.js' }));
    fs.writeFileSync(path.join(pluginDir, 'index.js'), TS_STAND_IN);
    fs.writeFileSync(path.join(tsRoot, 'package.json'), '{}');
    fs.writeFileSync(path.join(tsRoot, 'App.tsx'), [
      "import { signal } from 'what-framework';",
      '',
      '// Types the bundler would strip, and the lines with them.',
      'interface Props {',
      '  title: string;',
      '}',
      '',
      'type Count = number;',
      '',
      "const count = signal<Count>(1, 'count');",
      '',
      'export function thrower(): void {',
      "  throw new Error('boom');",
      '}',
      '',
      'export function App({ title }: Props) {',
      '  const text: string = `count: ${count}`;',
      '  return <div><p>{text}</p>{(title as string)}</div>;',
      '}',
      '',
    ].join('\n'));
    const vite = await createServer({
      root: tsRoot, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false },
      plugins: [whatVitePlugin({ prodBundles: false })],
    });
    try {
      const { code } = await vite.transformRequest('/App.tsx');
      const served = code.split('\n');
      for (const [line, statement] of [[10, 'const count = signal('], [13, "throw new Error('boom');"], [17, 'const text = `count: ${count}`;']]) {
        assert.ok(served[line - 1].trimStart().startsWith(statement), `line ${line} holds \`${statement}\`, not \`${served[line - 1]}\``);
      }
      assert.doesNotMatch(code, /interface Props|type Count/);
      assert.equal(globalThis.__whatTsOptions?.isTSX, true, 'the plugin strips the file as TSX');
    } finally {
      await vite.close();
    }
  } finally {
    delete globalThis.__whatTsOptions;
    fs.rmSync(tsRoot, { recursive: true, force: true });
  }
});
