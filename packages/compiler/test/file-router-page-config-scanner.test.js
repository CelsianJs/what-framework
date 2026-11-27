// extractPageConfig reads `export const page = { … }` with a scanner, not a
// JS parser: the literal must hold JSON-shaped values. For every such literal
// the scanner must read what JavaScript reads, so each case here is checked
// against the literal evaluated as JavaScript. The cases are the parts of the
// scanner a config rarely reaches: comments where a key ends, every escape a
// string can hold, template literals, and text that only looks like a comment
// or a brace inside a string.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { extractPageConfig } from '../src/file-router.js';

const CASES = {
  'a block comment between a key and its colon': String.raw`{ mode /* why */ : 'static', revalidate /**/: 60 }`,
  'a line comment between a key and its colon': `{ mode // the mode\n  : 'static' }`,
  'comments before keys and after a trailing comma': `{\n  // first\n  mode: 'static', /* second */\n  vary: ['a',], // trailing\n}`,
  'a comment as the last thing before the closing brace': `{ mode: 'static' /* done */ }`,
  'the single-character escapes': String.raw`{ s: "\n\t\r\b\f\v\0\\\'\"\`\/" }`,
  'a four-digit and a braced unicode escape': String.raw`{ s: 'A\u{1F600}\u{41}' }`,
  'a hex escape': String.raw`{ s: '\x41\x7a' }`,
  'an escape JavaScript ignores the backslash of': String.raw`{ s: '\q\%' }`,
  'a line continuation': `{ s: 'a\\\nb', t: 'c\\\r\nd' }`,
  'a template literal across lines': '{ s: `line one\nline two` }',
  'a template literal with CRLF line endings': '{ s: `one\r\ntwo\rthree` }',
  'a template literal with an escaped interpolation': '{ s: `cost: \\${price}` }',
  'quotes, braces and comment markers inside strings': String.raw`{ a: "What's new", b: 'a } b', c: "x // y", d: '/* z */', e: "say \"hi\"" }`,
  'nested objects and arrays with comments': `{ mode: 'static', paths: [ /* none */ ], meta: { title: 'T', /* x */ tags: ['a', 'b' /* last */] } }`,
};

describe('extractPageConfig reads a page config as JavaScript does', () => {
  for (const [title, literal] of Object.entries(CASES)) {
    it(title, () => {
      // Through JSON, so the arrays are this realm's.
      const expected = { mode: 'client', ...JSON.parse(JSON.stringify(runInNewContext(`(${literal})`))) };
      const warnings = [];
      const original = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        assert.deepEqual(extractPageConfig(`export const page = ${literal};\nexport default function P() {}`), expected);
      } finally {
        console.warn = original;
      }
      assert.deepEqual(warnings, []);
    });
  }
});

describe('extractPageConfig reports what it cannot read', () => {
  const unreadable = {
    'an unterminated block comment': `{ mode: 'static' /* never closed }`,
    'an unterminated string': `{ mode: 'static }`,
    'a quoted string across a line break': `{ mode: 'sta\ntic' }`,
    'a template literal with an interpolation': '{ mode: `${m}` }',
    'an unterminated braced unicode escape': String.raw`{ s: '\u{41' }`,
    'an unterminated literal': `{ mode: 'static'`,
  };
  for (const [title, literal] of Object.entries(unreadable)) {
    it(title, () => {
      const warnings = [];
      const original = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        assert.deepEqual(extractPageConfig(`export const page = ${literal}`, { filePath: 'pages/p.jsx' }), { mode: 'client' });
      } finally {
        console.warn = original;
      }
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /Ignoring unparseable `export const page` config in pages\/p\.jsx/);
    });
  }
});
