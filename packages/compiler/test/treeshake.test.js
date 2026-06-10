// SPRINT v0.11 C6 — tree-shakeability of compiled output.
//  - Hoisted `_$template(...)` consts carry /* @__PURE__ */ so bundlers can
//    drop templates of components that are never imported.
//  - Event delegation is LAZY: a once-guarded module helper called at element
//    construction, not a module-top-level `_$delegateEvents([...])` side
//    effect (which pinned every module in the bundle forever).
// Verified end-to-end with a real esbuild bundle: an unused exported
// component (with a template AND a delegated onClick) must be DCE'd away.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import babelPlugin from '../src/babel-plugin.js';

function compile(source) {
  return transformSync(source, {
    filename: 'components.jsx',
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  })?.code || '';
}

const FIXTURE = `
  export function Used() {
    return <div class="used-marker">used</div>;
  }
  export function Unused() {
    const count = signal(0);
    return (
      <section class="unused-marker">
        <button onClick={() => count(c => c + 1)}>{count()}</button>
      </section>
    );
  }
`;

async function bundleImportingOnlyUsed() {
  const dir = mkdtempSync(path.join(tmpdir(), 'what-treeshake-'));
  try {
    writeFileSync(path.join(dir, 'components.js'), compile(FIXTURE));
    writeFileSync(path.join(dir, 'entry.js'),
      `import { Used } from './components.js';\nconsole.log(Used());\n`);
    const result = await build({
      entryPoints: [path.join(dir, 'entry.js')],
      bundle: true,
      format: 'esm',
      write: false,
      treeShaking: true,
      external: ['what-framework', 'what-framework/render'],
      logLevel: 'silent',
    });
    return result.outputFiles[0].text;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('C6: compiled output is tree-shakeable', () => {
  it('emits /* @__PURE__ */ on every hoisted _$template call', () => {
    const code = compile(FIXTURE);
    const templates = code.match(/_\$template\("/g) || [];
    const pure = code.match(/\/\* @__PURE__ \*\/\s*_\$template\(/g) || [];
    assert.ok(templates.length >= 2, 'fixture should hoist at least 2 templates');
    assert.equal(pure.length, templates.length,
      `every template must be PURE-annotated:\n${code}`);
  });

  it('does NOT emit a module-top-level _$delegateEvents side-effect call', () => {
    const code = compile(FIXTURE);
    // The call must only appear inside the once-guarded helper function.
    assert.match(code, /function _\$delegate\$\(\)/, 'lazy delegation helper expected');
    assert.match(code, /_\$delegate\$\(\);/, 'element setup must invoke the helper');
    // Column-0 lines only — the (indented) call inside the helper body is fine.
    const lines = code.split('\n');
    const topLevelCall = lines.some(l => l.startsWith('_$delegateEvents('));
    assert.equal(topLevelCall, false,
      `module-top-level _$delegateEvents call found:\n${code}`);
  });

  it('an unused exported component is fully DCE’d by esbuild (template + delegation too)', async () => {
    const out = await bundleImportingOnlyUsed();
    assert.ok(out.includes('used-marker'), 'used component must survive');
    assert.ok(!out.includes('unused-marker'),
      `unused component's template must be tree-shaken:\n${out}`);
    // No delegation CALL may survive (esbuild keeps the import specifier line
    // for external modules — that's an external-import artifact, not retained
    // code; the helper, guard flag, and call site must all be gone).
    assert.ok(!out.includes('_$delegateEvents('),
      `delegation setup must be dropped when only unused components need it:\n${out}`);
    assert.ok(!out.includes('_$delegate$'),
      `lazy delegation helper must be dropped:\n${out}`);
    assert.ok(!out.includes('Unused'), 'unused component function must be dropped');
  });
});
