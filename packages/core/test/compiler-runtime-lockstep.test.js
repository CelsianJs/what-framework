// what-compiler and what-core move together. The runtime trusts the compiler's
// output protocol and no longer second-guesses it: `_$template(html)` without
// the namespace flag parses as HTML, where the previous runtime detected SVG
// and MathML roots by tag. So a compiler may only ever be installed with the
// runtime of its own minor version, and that is what these ranges guarantee:
// what-compiler requires what-core at its own version, and what-framework pins
// both to the same release. Below 1.0 a caret range admits exactly one minor
// version; from 1.0 on it would admit later minors, and this test fails until
// the ranges are changed to keep the guarantee.
//
// Output compiled by an older what-compiler that reaches a newer runtime anyway
// (a library shipping precompiled code with a loose peer range) is caught in
// development by `_$template` itself: ERR_TEMPLATE_NAMESPACE.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const packagesDir = new URL('../../', import.meta.url);
const read = (pkg) => JSON.parse(readFileSync(new URL(`${pkg}/package.json`, packagesDir), 'utf8'));
const core = read('core');
const compiler = read('compiler');
const framework = read('what');
const manifests = readdirSync(packagesDir)
  .filter((dir) => existsSync(new URL(`${dir}/package.json`, packagesDir)))
  .map(read);

describe('compiler and runtime versions move together', () => {
  it('are released at the same version', () => {
    assert.equal(compiler.version, core.version);
    assert.equal(framework.version, core.version);
  });

  it('what-compiler requires the what-core of its own minor version', () => {
    assert.equal(compiler.peerDependencies['what-core'], `^${core.version}`);
    assert.match(core.version, /^0\./, 'from 1.0 a caret range admits later minors: pin with ~ instead');
  });

  it('what-framework installs both at that version', () => {
    assert.equal(framework.dependencies['what-core'], `^${core.version}`);
    assert.equal(framework.dependencies['what-compiler'], `^${compiler.version}`);
  });
});

// The companion packages reach into what-core's internals (what-text's text
// insert hook on what-core/render, what-devtools' hooks on what-core/internal)
// and into each other, so each must declare its siblings at the release it
// ships with. A loose range is never moved by scripts/bump-version.mjs, which
// retargets caret ranges only: what-text's `>=0.7.0` let what-text 0.14 install
// beside a what-core that no longer exported the hook it imports, with no peer
// warning, and the app threw at import.
describe('companion packages declare their siblings in lockstep', () => {
  const siblings = new Set(manifests.map((m) => m.name));

  it('every range on a sibling is the release caret', () => {
    const off = [];
    for (const m of manifests) {
      for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies', 'devDependencies']) {
        for (const [name, range] of Object.entries(m[field] || {})) {
          if (siblings.has(name) && range !== `^${core.version}`) off.push(`${m.name} ${field} ${name}@${range}`);
        }
      }
    }
    assert.deepEqual(off, [], `declare these at ^${core.version}`);
  });

  it('covers what-core and what-compiler in the packages that use them', () => {
    const declares = (pkg, name) => manifests.find((m) => m.name === pkg)?.peerDependencies?.[name];
    assert.equal(declares('what-text', 'what-core'), `^${core.version}`);
    assert.equal(declares('what-devtools-mcp', 'what-compiler'), `^${core.version}`);
  });
});
