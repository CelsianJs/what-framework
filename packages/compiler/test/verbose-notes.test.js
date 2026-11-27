// The compiler's notes on correct code (what the auto-selector rewrote, that
// a <For> compiles to the same keyed rows as a keyed .map()) print only with
// the `verbose` option: a terminal that reports correct, documented code
// teaches its reader to skip what it prints. Warnings about code that
// misbehaves print either way.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileJSX } from '../../../test-utils/compile.js';
import whatVitePlugin from '../src/vite-plugin.js';

let file = 0;
function printed(source, pluginOptions = {}) {
  const info = console.info;
  const warn = console.warn;
  const seen = [];
  console.info = (...args) => seen.push(['info', args.join(' ')]);
  console.warn = (...args) => seen.push(['warn', args.join(' ')]);
  try {
    compileJSX(source, { filename: `/proj/src/notes-${file++}.jsx`, pluginOptions });
  } finally {
    console.info = info;
    console.warn = warn;
  }
  return seen;
}

const FOR = `import { For, signal } from 'what-framework';
export function List() {
  const items = signal([{ id: 1, text: 'a' }]);
  return <ul><For each={items}>{(item) => <li>{item.text}</li>}</For></ul>;
}`;

const SELECTOR = `import { signal } from 'what-framework';
export function Table() {
  const selected = signal(0);
  const rows = signal([{ id: 1 }]);
  return <ul>{rows().map((row) => <li key={row.id} class={selected() === row.id ? 'on' : ''} />)}</ul>;
}`;

describe('notes on correct code', () => {
  it('a <For> and an auto-selector rewrite print nothing by default', () => {
    assert.deepEqual(printed(FOR), []);
    assert.deepEqual(printed(SELECTOR), []);
  });

  it('print once per file with verbose: true', () => {
    const forNotes = printed(FOR, { verbose: true });
    assert.equal(forNotes.length, 1, JSON.stringify(forNotes));
    assert.equal(forNotes[0][0], 'info');
    assert.match(forNotes[0][1], /<For> at \/proj\/src\/notes-\d+\.jsx:4:\d+/);
    const selectorNotes = printed(SELECTOR, { verbose: true });
    assert.equal(selectorNotes.length, 1, JSON.stringify(selectorNotes));
    assert.match(selectorNotes[0][1], /auto-selector: `selected\(\) === row\.id`/);
  });

  it('a production build prints none, verbose or not', () => {
    assert.deepEqual(printed(FOR, { verbose: true, production: true }), []);
  });

  it('a warning about code that misbehaves still prints without verbose', () => {
    const seen = printed(`export function Title({ name }) { const label = name.toUpperCase(); return <h1>{label}</h1>; }`);
    assert.deepEqual(seen.map(([kind, text]) => [kind, text.includes('ERR_PROP_READ_ONCE')]), [['warn', true]]);
  });

  it('the Vite plugin hands its verbose option to the compiler', () => {
    const run = (options, id) => {
      const info = console.info;
      const seen = [];
      console.info = (...args) => seen.push(args.join(' '));
      try {
        whatVitePlugin(options).transform.call({}, FOR, id);
      } finally {
        console.info = info;
      }
      return seen;
    };
    assert.deepEqual(run({}, '/app/src/QuietList.jsx'), []);
    const notes = run({ verbose: true }, '/app/src/VerboseList.jsx');
    assert.equal(notes.length, 1, JSON.stringify(notes));
    assert.match(notes[0], /<For> at .*VerboseList\.jsx/);
  });
});
