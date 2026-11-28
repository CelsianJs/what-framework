// what-compiler's `hydratable` option, and the Vite plugin's choice of it.
//
// Built with the option, a template claims the server's nodes while hydrating
// and clones itself otherwise (_$htemplate, _$claim, _$next, _$hole, _$exit),
// a component is created through _$hcreateComponent, and JSX that is not
// written in place in its parent is built on the client (_$outside). Built
// without it, the output is the plain DOM output, byte for byte: an app that
// does not hydrate pays nothing. The Vite plugin compiles client modules with
// the option when the project renders on the server.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import whatBabelPlugin from '../src/babel-plugin.js';
import whatVitePlugin from '../src/vite-plugin.js';

const compile = (code, options = {}) => transformSync(code, {
  filename: '/proj/src/App.jsx',
  babelrc: false,
  configFile: false,
  parserOpts: { plugins: ['jsx'] },
  plugins: [[whatBabelPlugin, { production: true, ...options }]],
}).code;

const APP = `
import { signal } from 'what-framework';
const count = signal(0);
const items = signal([]);
export function App(props) {
  const footer = <footer>{props.note}</footer>;
  return (
    <main class="app">
      <h1>Hi {props.name}!</h1>
      <p>{count()}</p>
      <ul>{() => items().map((item) => <Row key={item.id} label={item.label} />)}</ul>
      {footer}
    </main>
  );
}
function Row(props) { return <li>{props.label}</li>; }
`;

describe('hydratable output', () => {
  const plain = compile(APP);
  const hydratable = compile(APP, { hydratable: true });

  it('claims instead of cloning: templates, holes and components go through the hydration helpers', () => {
    // The hydrating template and component helpers are imported under the
    // names the rest of the output already calls.
    assert.match(hydratable, /_\$htemplate as _\$template\b/);
    assert.match(hydratable, /_\$hcreate(?:Component|Fn) as _\$createComponent\b/);
    assert.match(hydratable, /const _el\$\d+ = _\$claim\(_tmpl\$\d+, 1\);/);
    assert.match(hydratable, /_\$next\(0, 1\)/);
    assert.match(hydratable, /_\$hole\(_el\$\d+, \(\) => count\(\), 3\)/);
    assert.match(hydratable, /_\$exit\(\)/);
  });

  it('builds JSX that is not written in place on the client, through _$outside', () => {
    assert.match(hydratable, /const footer = _\$outside\(\(\) =>/);
  });

  it('is off by default: the plain output carries none of it', () => {
    assert.doesNotMatch(plain, /_\$htemplate|_\$claim|_\$next|_\$skip|_\$hole|_\$exit|_\$hcreateComponent|_\$outside/);
    assert.equal(compile(APP, { hydratable: false }), plain);
  });

  it('the server target ignores it', () => {
    assert.equal(compile(APP, { generate: 'ssr', hydratable: true }), compile(APP, { generate: 'ssr' }));
  });
});

describe('vite plugin: hydratable', () => {
  const SOURCE = 'export function App() { return <p>{1}</p>; }';
  const transform = (config, options, ssr = false) => {
    const plugin = whatVitePlugin(options);
    plugin.configResolved({ root: '/proj', command: 'build', ...config });
    return plugin.transform.call({}, SOURCE, '/proj/src/App.jsx', { ssr }).code;
  };

  it('compiles the client for hydration when the project renders on the server', () => {
    assert.match(transform({ appType: 'custom' }), /_\$claim\(/);
    assert.match(transform({ build: { ssr: 'src/entry-server.jsx' } }), /_\$claim\(/);
    assert.match(transform({ build: { ssrManifest: true } }), /_\$claim\(/);
  });

  it('leaves a client-only project on plain output', () => {
    assert.doesNotMatch(transform({ appType: 'spa' }), /_\$claim\(/);
    assert.doesNotMatch(transform({}), /_\$claim\(/);
  });

  it('true and false override the detection', () => {
    assert.match(transform({ appType: 'spa' }, { hydratable: true }), /_\$claim\(/);
    assert.doesNotMatch(transform({ appType: 'custom' }, { hydratable: false }), /_\$claim\(/);
  });

  it('server transforms are compiled for the server, never as hydratable DOM output', () => {
    const server = transform({ appType: 'custom' }, { hydratable: true }, true);
    assert.doesNotMatch(server, /_\$claim\(|_\$htemplate\(/);
  });
});
