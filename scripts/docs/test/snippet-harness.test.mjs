// The snippet gate's own behaviour, on fixtures: what it extracts, how it
// reads markers and languages, and that each check fails what it should and
// passes what it should. A gate that reports a harness problem as a documentation
// problem gets switched off, so every rule that decides "not runnable" or
// "expected failure" is pinned here.

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSnippets, extractHtmlBlocks, extractMarkdownBlocks, inferLanguage, parseMarker, snippetsOf, splitExample,
} from '../snippets.mjs';

const fence = '```';

describe('extraction', () => {
  it('reads Markdown fences with their language, indentation and marker', () => {
    const md = [
      'Intro',
      '<!-- snippet: bad run=ERR_X -->',
      `${fence}jsx`,
      'const a = 1;',
      fence,
      '- item:',
      '',
      `    ${fence}ts title="x.ts"`,
      '    const b: number = 2;',
      `    ${fence}`,
      '',
      `${fence}${fence[0]}md`,
      `${fence}js`,
      'inner();',
      fence,
      `${fence}${fence[0]}`,
      '<!-- snippet: bad import -->',
      '',
      'A paragraph, not a fence.',
    ].join('\n');
    const blocks = extractMarkdownBlocks(md);
    assert.deepEqual(blocks.map((b) => b.stray ? 'stray' : `${b.lang}@${b.line}`), ['jsx@4', 'ts@9', 'null@13', 'stray']);
    assert.deepEqual(blocks[0].marker, { channel: 'run', code: 'ERR_X' });
    assert.equal(blocks[1].code, 'const b: number = 2;');
    assert.equal(blocks[2].code, `${fence}js\ninner();\n${fence}`);
    assert.equal(blocks[2].marker, null);
  });

  it('reads markers, and refuses any other form', () => {
    assert.deepEqual(parseMarker('<!-- snippet: bad lint=ERR_MISSING_KEY -->'), { channel: 'lint', code: 'ERR_MISSING_KEY' });
    assert.deepEqual(parseMarker('<!--snippet: bad compile=ERR_A-->'), { channel: 'compile', code: 'ERR_A' });
    assert.deepEqual(parseMarker('<!-- snippet: bad import -->'), { channel: 'import', code: null });
    assert.match(parseMarker('<!-- snippet: skip -->').error, /unrecognized snippet marker/);
    assert.match(parseMarker('<!-- snippet: bad run -->').error, /unrecognized snippet marker/);
  });

  it('reads HTML <pre> blocks with highlighting stripped, entities decoded and the marker before <pre>', () => {
    const html = [
      '<p>Text</p>',
      '<!-- snippet: bad lint=ERR_Y -->',
      '<pre><code><span class="keyword">const</span> a = &lt;div title=&quot;x&quot;&gt;&amp;&#123;&lt;/div&gt;;</code></pre>',
      '<pre>npm install what-framework</pre>',
      '<!-- snippet: bad import -->',
      '<p>no block follows</p>',
    ].join('\n');
    const blocks = extractHtmlBlocks(html);
    assert.equal(blocks[0].code, 'const a = <div title="x">&{</div>;');
    assert.deepEqual(blocks[0].marker, { channel: 'lint', code: 'ERR_Y' });
    assert.equal(blocks[0].line, 3);
    assert.equal(blocks[1].lang, null);
    assert.ok(blocks[2].stray);
  });

  it('takes a marker only from the comment that ends right before <pre>', () => {
    const html = [
      '<!-- snippet: bad import -->',
      '<pre><code>a();</code></pre>',
      '<p>x</p><!-- an ordinary comment -->',
      '<pre><code>b();</code></pre>',
      '<!-- snippet: bad lint=ERR_A -->',
      '<pre><code>c();</code></pre>',
    ].join('\n');
    assert.deepEqual(extractHtmlBlocks(html).map((b) => b.marker), [{ channel: 'import', code: null }, null, { channel: 'lint', code: 'ERR_A' }]);
  });

  it('infers the language of an unlabelled block from its content', () => {
    assert.equal(inferLanguage('npm install what-framework'), null);
    assert.equal(inferLanguage('$ npx create-what my-app'), null);
    assert.equal(inferLanguage('// .mcp.json\n{\n  "mcpServers": {}\n}'), null);
    assert.equal(inferLanguage('.board {\n  display: grid;\n}'), null);
    assert.equal(inferLanguage('my-app/\n  src/\n    main.jsx'), null);
    assert.equal(inferLanguage('what_signals({ filter: "count" })\n// Returns:\n{ "signals": [] }'), null);
    assert.equal(inferLanguage('Cache-Control: public, s-maxage=60'), null);
    assert.equal(inferLanguage('<!doctype html>\n<html></html>'), null);
    assert.equal(inferLanguage('const a = <p>{count()}</p>;'), 'jsx');
    assert.equal(inferLanguage('const n: number = 1;'), 'tsx');
    assert.equal(inferLanguage('const n = <number>value;'), 'ts', 'an angle-bracket cast only parses without JSX');
    assert.equal(inferLanguage('// a broken snippet\nconst a = ;'), 'jsx', 'code that does not parse is still code');
  });

  it('splits a catalogue example at its first // Good line', () => {
    assert.deepEqual(splitExample('// Bad:\nbad();\n\n// Good:\ngood();\n// Better:\nbetter();'), { bad: '// Bad:\nbad();\n', good: '// Good:\ngood();\n// Better:\nbetter();' });
    assert.deepEqual(splitExample('// Bad:\nbad();'), { bad: '// Bad:\nbad();', good: null });
    assert.deepEqual(splitExample('// vite.config.js\nconfig();'), { bad: null, good: '// vite.config.js\nconfig();' });
  });

  it('reports a stray marker, a marker on prose and an unlabelled fence that imports from What', () => {
    const text = [
      '<!-- snippet: bad import -->',
      `${fence}bash`,
      'npm i',
      fence,
      fence,
      "import { signal } from 'what-framework';",
      fence,
      '<!-- snippet: bad import -->',
      'prose',
    ].join('\n');
    const { snippets, blocks, other } = snippetsOf({ label: 'doc.md', file: 'doc.md', kind: 'markdown', text });
    assert.equal(blocks, 2);
    assert.equal(other, 2);
    assert.deepEqual(snippets.map((s) => s.problem.split(':')[0]), ['a snippet marker on a block that is not js/jsx/ts/tsx (bash)', 'an unlabelled fence that imports from What', 'a snippet marker is not followed by a code block']);
  });
});

const COUNTER = `import { signal, mount } from 'what-framework';

function Counter() {
  const count = signal(0);
  return <button onClick={() => count((c) => c + 1)}>{count}</button>;
}

mount(<Counter />, '#app');`;

const FIXTURES = {
  good: { code: COUNTER },
  mountedForYou: { code: "import { signal } from 'what-framework';\nexport default function App() { const n = signal(1); return <p>{n}</p>; }" },
  forCrash: { code: "function List() { const config = null; return <ul><li>{config.title}</li></ul>; }" },
  missingExport: { code: "import { useTween } from 'what-framework';" },
  unknownEntry: { code: "import { x } from 'what-framework/nope';" },
  oldPackage: { code: "import { signal } from 'what';" },
  diagnostic: { code: "import { signal, mount } from 'what-framework';\nconst count = signal(0);\nfunction App() { return <p>{`Count: ${count}`}</p>; }\nmount(<App />, '#app');" },
  clickThrows: { code: "function App() { return <button onClick={() => { throw new Error('boom'); }}>x</button>; }" },
  missingKey: { code: "import { signal } from 'what-framework';\nfunction L() { const items = signal([1]); return <ul>{items().map((i) => <li>{i}</li>)}</ul>; }" },
  parseError: { code: 'const = 1;' },
  parseErrorBadImport: { code: "import { useTween } from 'what-framework';\nconst a = 1;\nconst a = 2;" },
  badComment: { code: '// Bad: a write in the body\nconst x = 1;' },
  fragment: { code: 'count(5);' },
  typeOk: { lang: 'ts', code: "import type { Signal } from 'what-framework';\nimport { signal } from 'what-framework';\nexport const s: Signal<number> = signal(0);" },
  typeMissing: { lang: 'ts', code: "import type { NoSuchType } from 'what-framework';" },
  serverListens: { code: "import { createServer } from 'what-framework/server';\ncreateServer({ routes: [] }).listen(3000);" },
  markup: { code: "document.querySelector('form').addEventListener('submit', () => {});" },
  projectFiles: { code: "import { exportStatic } from 'what-framework/server';\nawait exportStatic({ routes: [], outDir: 'dist' });" },
  loaderData: { code: "import { useLoaderData } from 'what-framework';\nfunction Post() { const { post } = useLoaderData(); return <h1>{post.title}</h1>; }" },
  badRun: { marker: { channel: 'run', code: 'ERR_MISSING_SIGNAL_READ' }, code: "import { signal, mount } from 'what-framework';\nconst count = signal(0);\nfunction App() { return <p>{`Count: ${count}`}</p>; }\nmount(<App />, '#app');" },
  badRunClean: { marker: { channel: 'run', code: 'ERR_MISSING_SIGNAL_READ' }, code: COUNTER },
  badRunFragment: { marker: { channel: 'run', code: 'ERR_MISSING_SIGNAL_READ' }, code: 'const label = `${count}`;' },
  badImport: { marker: { channel: 'import', code: null }, code: "import { useTween } from 'what-framework';" },
  badImportClean: { marker: { channel: 'import', code: null }, code: "import { signal } from 'what-framework';" },
  badLint: { marker: { channel: 'lint', code: 'ERR_INFINITE_EFFECT' }, code: "import { signal, effect } from 'what-framework';\nconst count = signal(0);\neffect(() => { count(count() + 1); });" },
  badLintClean: { marker: { channel: 'lint', code: 'ERR_INFINITE_EFFECT' }, code: "import { signal } from 'what-framework';\nconst count = signal(0);" },
  badCompile: { marker: { channel: 'compile', code: 'ERR_INVALID_HTML_NESTING' }, code: 'const el = <p><div>block</div></p>;' },
  badCompileServer: { marker: { channel: 'compile', code: 'ERR_UNSAFE_STATIC_MARKUP' }, code: '<a href="javascript:void 0">Open</a>;' },
  badCompileWarning: { marker: { channel: 'compile', code: 'ERR_MISSING_KEY' }, code: "import { signal } from 'what-framework';\nfunction L() { const items = signal([1]); return <ul>{items().map((i) => <li>{i}</li>)}</ul>; }" },
  catalogueBadLint: { role: 'catalogue-bad', errorCode: 'ERR_INFINITE_EFFECT', detects: ['reported', 'lint'], code: "// Bad:\nimport { signal, effect } from 'what-framework';\nconst count = signal(0);\neffect(() => { count(count() + 1); });" },
  catalogueBadMissed: { role: 'catalogue-bad', errorCode: 'ERR_INFINITE_EFFECT', detects: ['reported', 'lint'], code: '// Bad:\neffect(() => { count(count() + 1); });' },
  catalogueBadServer: { role: 'catalogue-bad', errorCode: 'ERR_ACTION_FAILED', detects: ['server'], code: '// Bad:\nawait save();' },
  catalogueBadImportLinted: { role: 'catalogue-bad', errorCode: 'ERR_MOVED_IMPORT', detects: ['compile', 'lint'], code: "// Bad:\nimport { signal, useForm } from 'what-framework';" },
  catalogueGoodWithBadComment: { role: 'catalogue-good', errorCode: 'ERR_X', detects: [], code: '// Good:\nconst ok = 1;\n// Bad would be: const ok = 2;' },
};

describe('checks', () => {
  const results = {};

  before(async () => {
    const snippets = Object.entries(FIXTURES).map(([name, f]) => ({
      source: 'fixture', file: 'fixture', line: 1, lang: 'jsx', role: 'block', marker: null, ...f, name,
    }));
    for (const r of await checkSnippets(snippets)) results[r.snippet.name] = r;
  }, { timeout: 120_000 });

  const passes = (name) => assert.deepEqual(results[name].failures, [], `${name} should pass`);
  const failsWith = (name, re) => assert.ok(results[name].failures.some((f) => re.test(f)), `${name} should fail with ${re}; got ${JSON.stringify(results[name].failures)}`);

  it('runs, mounts and clicks a working component', () => {
    passes('good');
    assert.equal(results.good.counts.ran, true);
    passes('mountedForYou');
    assert.equal(results.mountedForYou.counts.mounted, true, 'the default export is mounted');
  });

  it('fails a component that throws while mounting', () => failsWith('forCrash', /thrown while mounting <List>: TypeError/));
  it('fails an import of a name the package does not export', () => failsWith('missingExport', /imports useTween from 'what-framework', which does not export it/));
  it('fails an import of an unpublished subpath', () => failsWith('unknownEntry', /not an entry point of what-framework/));
  it("fails an import from 'what'", () => failsWith('oldPackage', /'what' is not a published What package/));
  it('fails a What diagnostic reported at run time', () => failsWith('diagnostic', /reports ERR_MISSING_SIGNAL_READ/));
  it('fails an exception in a click handler', () => failsWith('clickThrows', /uncaught exception in an event handler: Error: boom/));
  it('fails a coded compile warning', () => failsWith('missingKey', /compile warning: .*ERR_MISSING_KEY/));
  it('fails a parse error, and still checks the imports it could read', () => {
    failsWith('parseError', /line 1: does not parse/);
    failsWith('parseErrorBadImport', /line 3: does not parse: Identifier 'a' has already been declared/);
    failsWith('parseErrorBadImport', /line 1: imports useTween from 'what-framework', which does not export it/);
  });
  it('fails an unmarked block that calls itself bad', () => failsWith('badComment', /split the bad half into its own block and mark it/));

  it('compiles a fragment with free identifiers without running it', () => {
    passes('fragment');
    assert.equal(results.fragment.counts.ran, false);
    assert.ok(results.fragment.notes.some((n) => /free identifiers: count/.test(n)));
  });

  it('checks type-only imports against the declarations', () => {
    passes('typeOk');
    failsWith('typeMissing', /imports type NoSuchType from 'what-framework', which its declarations do not export/);
  });

  it('runs server code with sockets and listening disabled', () => {
    passes('serverListens');
    assert.equal(results.serverListens.counts.ran, true);
  });

  it('does not run code that needs page markup, project files or a server render', () => {
    for (const name of ['markup', 'projectFiles']) {
      passes(name);
      assert.equal(results[name].counts.ran, false, name);
    }
    assert.ok(results.markup.notes.some((n) => /looks up page markup/.test(n)));
    assert.ok(results.projectFiles.notes.some((n) => /uses exportStatic, which reads or writes the project's files/.test(n)));
    passes('loaderData');
    assert.equal(results.loaderData.counts.mounted, false);
  });

  it('asserts that a marked bad block fails exactly the stated way', () => {
    for (const name of ['badRun', 'badImport', 'badLint', 'badCompile', 'badCompileServer', 'badCompileWarning']) {
      passes(name);
      assert.equal(results[name].counts.badAsserted, true, name);
    }
    failsWith('badRunClean', /marked bad run=ERR_MISSING_SIGNAL_READ, but it does not fail that way/);
    failsWith('badRunFragment', /it cannot run on its own \(free identifiers: count\)/);
    failsWith('badImportClean', /marked bad import, but every import resolves/);
    failsWith('badLintClean', /marked bad lint=ERR_INFINITE_EFFECT, but it does not fail that way: eslint-plugin-what reports nothing/);
  });

  it('asserts a catalogue bad half through its detection channel when one can be exercised', () => {
    passes('catalogueBadLint');
    assert.equal(results.catalogueBadLint.counts.badAsserted, true);
    failsWith('catalogueBadMissed', /the bad half of ERR_INFINITE_EFFECT's example is not caught: eslint-plugin-what reports nothing/);
    passes('catalogueBadServer');
    assert.equal(results.catalogueBadServer.counts.compileOnly, true);
    passes('catalogueBadImportLinted');
    assert.equal(results.catalogueBadImportLinted.counts.badAsserted, true, 'the import the lint report points at is the mistake itself');
    passes('catalogueGoodWithBadComment');
  });
});
