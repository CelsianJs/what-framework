/**
 * Tests for the diagnostics channel (packages/core/src/diagnostics.js) and the
 * core checks that report into it.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { installDOM } from '../../../test-utils/dom.js';

installDOM();

const diagnostics = await import('../src/diagnostics.js');
const { report, subscribe, capture, getDiagnostics, clearDiagnostics, VERSION } = diagnostics;
const { ERROR_CODES } = await import('../src/errors.js');

function withConsole(run) {
  const lines = { warn: [], error: [] };
  const original = { warn: console.warn, error: console.error };
  console.warn = (...args) => lines.warn.push(args.join(' '));
  console.error = (...args) => lines.error.push(args.join(' '));
  try { run(); } finally {
    console.warn = original.warn;
    console.error = original.error;
  }
  return lines;
}

function quietly(run) {
  const cap = capture({ quiet: true });
  try { run(); } finally { cap.stop(); }
  return cap.events;
}

describe('report()', () => {
  beforeEach(() => clearDiagnostics());

  it('builds a serializable event from the catalogue', () => {
    const [ev] = quietly(() => report('ERR_MISSING_SIGNAL_READ', {
      data: { signalName: 'count' },
      subject: { kind: 'signal', id: 3, name: 'count' },
    }));
    assert.equal(ev.code, 'ERR_MISSING_SIGNAL_READ');
    assert.equal(ev.severity, ERROR_CODES.MISSING_SIGNAL_READ.severity);
    assert.equal(ev.fix, ERROR_CODES.MISSING_SIGNAL_READ.suggestion);
    assert.ok(ev.message.includes('"count"'), ev.message);
    assert.ok(!ev.message.includes('{{'), ev.message);
    assert.deepEqual(ev.owner, []);
    assert.equal(ev.loc, null);
    assert.deepEqual(ev.subject, { kind: 'signal', id: 3, name: 'count' });
    assert.deepEqual(ev.data, { signalName: 'count' });
    assert.equal(ev.count, 1);
    assert.equal(typeof ev.seq, 'number');
    assert.deepEqual(JSON.parse(JSON.stringify(ev)), ev, 'event must survive JSON');
    assert.ok(!('codeExample' in ev), 'the worked example stays a what_fix lookup');
  });

  it('carries owner and loc through unchanged', () => {
    const [ev] = quietly(() => report('ERR_DUPLICATE_KEY', {
      data: { key: '"cart"' },
      owner: ['<App>', '<Cart>'],
      loc: 'src/Cart.jsx:4:9',
    }));
    assert.deepEqual(ev.owner, ['<App>', '<Cart>']);
    assert.equal(ev.loc, 'src/Cart.jsx:4:9');
  });

  it('folds repeats of a code on one subject and moves the event to the newest seq', () => {
    const subject = { kind: 'signal', id: 1, name: 'a' };
    let first;
    let second;
    quietly(() => {
      first = report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'a' }, subject });
      report('ERR_DUPLICATE_KEY', { data: { key: '"x"' } });
      second = report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'a' }, subject });
    });
    assert.equal(first, second, 'same event object');
    assert.equal(second.count, 2);
    const { events } = getDiagnostics();
    assert.deepEqual(events.map((e) => e.code), ['ERR_DUPLICATE_KEY', 'ERR_MISSING_SIGNAL_READ']);
  });

  it('keeps different subjects apart, and folds subject-less reports by message', () => {
    quietly(() => {
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'a' }, subject: { kind: 'signal', id: 1 } });
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'b' }, subject: { kind: 'signal', id: 2 } });
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } });
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } });
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 1 } });
    });
    const { events } = getDiagnostics();
    assert.equal(events.length, 4);
    assert.deepEqual(events.filter((e) => e.code === 'ERR_EFFECT_DEP_NOT_FUNCTION').map((e) => [e.data.index, e.count]), [[0, 2], [1, 1]]);
  });

  it('turns an uncatalogued code into ERR_UNKNOWN naming the bad code', () => {
    const [ev] = quietly(() => report('ERR_NOT_A_CODE'));
    assert.equal(ev.code, 'ERR_UNKNOWN');
    assert.equal(ev.data.errorCode, 'ERR_NOT_A_CODE');
    assert.ok(ev.message.includes('ERR_NOT_A_CODE'));
  });
});

describe('getDiagnostics() cursor', () => {
  beforeEach(() => clearDiagnostics());

  it('returns only events after the cursor, and the cursor to pass next', () => {
    quietly(() => report('ERR_DUPLICATE_KEY', { data: { key: 'a' } }));
    const first = getDiagnostics();
    assert.equal(first.events.length, 1);
    quietly(() => report('ERR_DUPLICATE_KEY', { data: { key: 'c' } }));
    const next = getDiagnostics({ since: first.seq });
    assert.deepEqual(next.events.map((e) => e.data.key), ['c']);
    assert.equal(getDiagnostics({ since: next.seq }).events.length, 0);
  });

  it('returns copies, so readers cannot corrupt the buffer', () => {
    quietly(() => report('ERR_DUPLICATE_KEY', { data: { key: 'a' } }));
    getDiagnostics().events[0].count = 99;
    assert.equal(getDiagnostics().events[0].count, 1);
  });

  it('bounds the buffer, drops the oldest and counts what it dropped', () => {
    quietly(() => {
      for (let i = 0; i < 510; i++) report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: i } });
    });
    const { events, dropped } = getDiagnostics();
    assert.equal(events.length, 500);
    assert.equal(dropped, 10);
    assert.equal(events[0].data.index, 10, 'the oldest ten are gone');
  });
});

describe('subscribe() and capture()', () => {
  beforeEach(() => clearDiagnostics());

  it('delivers every report, repeats included, until unsubscribed', () => {
    const seen = [];
    const off = subscribe((ev) => seen.push([ev.code, ev.count]));
    quietly(() => {
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } });
      report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } });
    });
    off();
    quietly(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } }));
    assert.deepEqual(seen, [['ERR_EFFECT_DEP_NOT_FUNCTION', 1], ['ERR_EFFECT_DEP_NOT_FUNCTION', 2]]);
  });

  it('isolates a throwing listener', () => {
    const off = subscribe(() => { throw new Error('listener bug'); });
    try {
      assert.doesNotThrow(() => quietly(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } })));
    } finally {
      off();
    }
  });

  it('counts within the capture, independent of earlier reports', () => {
    quietly(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } }));
    const events = quietly(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 0 } }));
    assert.equal(events.length, 1);
    assert.equal(events[0].count, 1, 'the capture saw one report');
    assert.equal(getDiagnostics().events[0].count, 2, 'the channel saw two');
  });

  it('delivers in seq order to every listener when a listener reports from inside its callback', () => {
    const order = [];
    const offNested = subscribe((ev) => {
      if (ev.data.index === 1) report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 2 } });
    });
    const offOrder = subscribe((ev) => order.push([ev.seq, ev.data.index]));
    try {
      quietly(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 1 } }));
    } finally {
      offNested();
      offOrder();
    }
    assert.deepEqual(order.map(([, index]) => index), [1, 2]);
    assert.ok(order[0][0] < order[1][0], `seqs must increase: ${JSON.stringify(order)}`);
  });

  it('delivers a frozen copy taken when the report was made', () => {
    const seen = [];
    const off = subscribe((ev) => seen.push(ev));
    const subject = { kind: 'signal', id: 9, name: 's' };
    quietly(() => {
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'first' }, subject });
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'second' }, subject });
    });
    off();
    assert.ok(Object.isFrozen(seen[0]));
    assert.equal(seen[0].count, 1, 'the first delivery still says count 1 after the repeat');
    assert.equal(seen[0].data.signalName, 'first');
    assert.equal(seen[1].count, 2);
  });

  it('a folded repeat describes the latest report and remembers the first seq', () => {
    const subject = { kind: 'signal', id: 4, name: 'old' };
    let firstSeq;
    const events = quietly(() => {
      firstSeq = report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'old' }, subject }).seq;
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'renamed' }, subject, loc: 'src/A.jsx:2:1' });
    });
    const [stored] = getDiagnostics().events;
    for (const ev of [stored, events[0]]) {
      assert.equal(ev.count, 2);
      assert.equal(ev.firstSeq, firstSeq);
      assert.ok(ev.seq > firstSeq);
      assert.equal(ev.data.signalName, 'renamed');
      assert.ok(ev.message.includes('"renamed"'), ev.message);
      assert.equal(ev.loc, 'src/A.jsx:2:1');
    }
  });

  it('stop() closes the capture', () => {
    const cap = capture({ quiet: true });
    cap.stop();
    withConsole(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 7 } }));
    assert.equal(cap.events.length, 0);
  });
});

describe('console output', () => {
  beforeEach(() => clearDiagnostics());

  it('prints one compact line, then the pointer once per code', () => {
    const out = withConsole(() => {
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'a' }, subject: { kind: 'signal', id: 1 }, owner: ['<App>', '<Total>'], loc: 'src/Total.jsx:3:7' });
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'b' }, subject: { kind: 'signal', id: 2 } });
      report('ERR_MISSING_SIGNAL_READ', { data: { signalName: 'b' }, subject: { kind: 'signal', id: 2 } });
    });
    assert.equal(out.warn.length, 2, 'a folded repeat does not print again');
    const [first, second] = out.warn.map((w) => w.split('\n'));
    assert.ok(first[0].startsWith('[what] ERR_MISSING_SIGNAL_READ Signal "a"'), first[0]);
    assert.equal(first[1], '  in <App> › <Total>');
    assert.equal(first[2], '  at src/Total.jsx:3:7');
    assert.ok(first[3].includes('what_fix({ error: "ERR_MISSING_SIGNAL_READ" })'), first[3]);
    assert.ok(first[3].includes('node_modules/what-framework/skills/what-diagnostics/SKILL.md'), first[3]);
    assert.ok(first[3].includes(`/blob/v${VERSION}/docs/ERRORS.md#err-missing-signal-read`), first[3]);
    assert.ok(!/blob\/(main|next|master)\//.test(first[3]), 'never branch-pinned');
    assert.equal(second.length, 1, 'the pointer prints only on the first report of a code');
  });

  it('uses console.error for error-severity codes', () => {
    const out = withConsole(() => report('ERR_HOOK_OUTSIDE_COMPONENT', { data: { hookName: 'useContext(Theme)' } }));
    assert.equal(out.error.length, 1);
    assert.equal(out.warn.length, 0);
  });

  it('stays silent while a quiet capture is open', () => {
    const cap = capture({ quiet: true });
    const out = withConsole(() => report('ERR_EFFECT_DEP_NOT_FUNCTION', { data: { index: 3 } }));
    cap.stop();
    assert.equal(out.warn.length, 0);
    assert.equal(cap.events.length, 1);
  });
});

describe('module contract', () => {
  it('VERSION matches packages/core/package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    assert.equal(VERSION, pkg.version);
  });

  it('imports only the catalogue, and the catalogue imports nothing', async () => {
    const root = new URL('../src/', import.meta.url).pathname;
    const out = await build({
      entryPoints: [`${root}diagnostics.js`],
      bundle: true, write: false, metafile: true, logLevel: 'silent', format: 'esm',
    });
    const inputs = Object.keys(out.metafile.inputs).map((p) => p.split('/').pop()).sort();
    assert.deepEqual(inputs, ['diagnostics.js', 'errors.js'], 'reactive.js must stay out: the engine reports into this module');
  });

  it('tree-shakes to nothing when unused, and when every call sits behind a false build-time dev flag', async () => {
    const root = new URL('../src/', import.meta.url).pathname;
    for (const contents of [
      "import { report, subscribe, capture, getDiagnostics } from './diagnostics.js';",
      "import { report } from './diagnostics.js'; export function f() { if (__DEV__) report('ERR_DUPLICATE_KEY'); return 1; }",
    ]) {
      const out = await build({
        stdin: { contents, resolveDir: root, loader: 'js' },
        define: { __DEV__: 'false' },
        bundle: true, minify: true, format: 'esm', write: false, logLevel: 'silent', treeShaking: true,
      });
      const text = out.outputFiles[0].text;
      assert.ok(!text.includes('ERR_'), `catalogue leaked into the bundle (${text.length} B)`);
      assert.ok(text.length < 80, `expected an empty bundle, got ${text.length} B: ${text.slice(0, 120)}`);
    }
  });
});

describe('core checks report through the channel', () => {
  beforeEach(() => clearDiagnostics());

  it('hooks outside a component throw with ERR_HOOK_OUTSIDE_COMPONENT', async () => {
    const { useState } = await import('../src/hooks.js');
    assert.throws(() => useState(0), (err) => err.code === 'ERR_HOOK_OUTSIDE_COMPONENT' && err.message.includes('useState()'));
  });

  it('useContext outside a component reports and still returns the default', async () => {
    const { useContext, createContext } = await import('../src/hooks.js');
    const Theme = createContext('light');
    let value;
    const events = quietly(() => { value = useContext(Theme); });
    assert.equal(value, 'light');
    assert.equal(events[0].code, 'ERR_HOOK_OUTSIDE_COMPONENT');
    assert.equal(events[0].message, 'useContext() was called outside a component function.');
    assert.equal(events[0].data.context, 'Context');
  });

  it('onCleanup with neither a component nor a reactive owner reports ERR_CLEANUP_WITHOUT_OWNER', async () => {
    const { onCleanup } = await import('../src/hooks.js');
    const { createRoot } = await import('../src/reactive.js');
    const events = quietly(() => onCleanup(() => {}));
    assert.deepEqual(events.map((e) => e.code), ['ERR_CLEANUP_WITHOUT_OWNER']);
    clearDiagnostics();
    let ran = 0;
    const inRoot = quietly(() => createRoot((dispose) => { onCleanup(() => { ran++; }); dispose(); }));
    assert.deepEqual(inRoot, [], 'a root is an owner: nothing to report');
    assert.equal(ran, 1, 'the cleanup ran when the root was disposed');
  });

  it('derived() without the state parameter reports ERR_DERIVED_WITHOUT_STATE', async () => {
    const { createStore, derived } = await import('../src/store.js');
    const events = quietly(() => createStore({ count: 0, doubled: derived(() => 0) }));
    assert.equal(events.length, 1);
    assert.equal(events[0].code, 'ERR_DERIVED_WITHOUT_STATE');
    assert.equal(events[0].data.key, 'doubled');
  });

  it('useLocalStorage reports ERR_STORAGE_FAILED for unreadable stored JSON from another tab', async () => {
    const { useLocalStorage } = await import('../src/helpers.js');
    const events = quietly(() => {
      useLocalStorage('diag-test', 1);
      window.dispatchEvent(Object.assign(new window.Event('storage'), { key: 'diag-test', newValue: '{not json' }));
    });
    const ev = events.find((e) => e.code === 'ERR_STORAGE_FAILED' && e.data.operation === 'read');
    assert.ok(ev, JSON.stringify(events));
    assert.equal(ev.data.key, 'diag-test');
    assert.equal(ev.data.operation, 'read');
  });
});
