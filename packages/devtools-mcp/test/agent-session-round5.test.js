// Round 5 agent-session gaps in the MCP tools:
//   - what_navigate on a page no client router claims loads the URL (a full
//     navigation) instead of changing the address bar alone (F3);
//   - the live tools name the files their issues point into, for what_lint,
//     which finds a missing cleanup or a write in render offline (F5);
//   - what_events collapses a timer's repeated write-and-runs into its first
//     and last group and a count (F5/F10).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

installDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/start' });
const { handleExtendedCommand } = await import('../src/client-commands.js');
const { lintHint, collapseRepeats } = await import('../src/tools.js');

describe('what_navigate with no client router', () => {
  it('loads the URL, after answering, and does not only rewrite the address bar', async () => {
    // jsdom does not load documents: location.assign() reports "navigation"
    // as not implemented, which is how the test sees the load start.
    const reported = [];
    const error = console.error;
    console.error = (...args) => reported.push(args.map(String).join(' '));
    try {
      const answer = await handleExtendedCommand('navigate', { path: '/users' }, { _registries: { signals: new Map() } });
      assert.equal(answer.document, true);
      assert.equal(answer.router, false);
      assert.equal(window.location.pathname, '/start', 'the address bar is not rewritten');
      await new Promise((resolve) => setTimeout(resolve, 5));
    } finally {
      console.error = error;
    }
    assert.ok(reported.some((line) => /navigation/i.test(line)), reported.join('\n'));
  });
});

describe('the files issues point into', () => {
  it('are named once each, for what_lint', () => {
    const hint = lintHint([{ loc: 'src/pages/lab.js:10:3' }, { loc: 'src/pages/lab.js:12:1' }, { loc: 'src/app.jsx:4' }, {}]);
    assert.deepEqual(hint.files, ['src/pages/lab.js', 'src/app.jsx']);
    assert.match(hint.hint, /what_lint/);
    assert.equal(lintHint([{}]), null);
  });
});

describe('what_events lines', () => {
  it('a repeated write and its runs collapse to the first and last group and a count', () => {
    const lines = [];
    for (let i = 0; i < 6; i++) {
      lines.push(`#${10 + 3 * i} write pings=${100 + i} at lab.js:5:15`, `#${11 + 3 * i} run Ticker#4 (${i + 1}) ← pings#2`, `#${12 + 3 * i} run p.text#9 (${i + 1}) ← pings#2`);
    }
    const out = collapseRepeats([...lines, '#99 mount <X> #3']);
    assert.deepEqual(out, [...lines.slice(0, 3), '… 4 more of the 3 lines above, then:', ...lines.slice(15), '#99 mount <X> #3']);
  });

  it('lines that differ, or repeat only twice, stay as they are', () => {
    const lines = ['#1 write a=1', '#2 write a=2', '#3 write b=1', '#4 run x#1 (1)', '#5 run y#2 (1)'];
    assert.deepEqual(collapseRepeats(lines), lines);
  });
});
