import { installDOM } from '../../../test-utils/dom.js';
// Three ways the compiler built DOM that the source said should not be built
// yet. All three share one root cause shape: the setup statements for a JSX
// subtree (`const _el$N = _tmpl$X(); _$insert(_el$N, () => sig().field, ...)`)
// were emitted OUTSIDE the thing that was supposed to guard them, so the
// bindings ran at mount instead of when the guard opened.
//
//   #42  `return cond() && <p>{cond().message}</p>` — transformJsxRoot hoisted
//        the arm's setup before the enclosing `return`, so the arm was built,
//        and its bindings executed, before the `&&` was ever evaluated. The
//        idiomatic React "render nothing until the data arrives" shape threw
//        a TypeError on the very first render.
//
//   #26  `<Show when={user}><p>{() => user().name}</p></Show>` — the static
//        children branch of transformShowFineGrained had no setup splice, so
//        the arm was built alongside the enclosing component. <Switch> already
//        splices for exactly this reason; <Show> did not. The same JSX behaves
//        correctly on the UNCOMPILED runtime path, where children genuinely are
//        lazy, which made it a compiled-vs-runtime divergence.
//
//   #24  `<For each={items} fallback={<p>empty</p>}>` — the attribute loop read
//        only `each` and `key`, so `fallback` was silently discarded. The
//        runtime For component implements it, so moving an app from a buildless
//        setup to the Vite compiler dropped its empty state with nothing on the
//        console.
//
// These are runtime tests on purpose. Every one of them would pass as a
// string assertion on the emitted code while the emitted code still threw.
//
// #24 then needed a second pass, because HOW the fallback is lowered matters as
// much as whether it renders. The first lowering gated the whole thing —
// `() => empty() ? _$mapArray(...) : fallback` — which reads correctly and
// produces correct DOM, and is still wrong: `insert()` installs a list ONCE
// only for values it recognises as mapArray inserters, and a thunk is not one.
// So every empty -> fill flip built another inserter that nothing disposed, and
// the fallback, anchored to a parent captured by value, stopped being removable
// as soon as that parent was a fragment createDOM had already emptied. Neither
// costs a DOM assertion anything, which is why the tests below count the row
// render function's invocations and watch the console instead.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformSync } from '@babel/core';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import babelPlugin from '../src/babel-plugin.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORE_INDEX = path.resolve(__dirname, '../../core/src/index.js');
const CORE_RENDER = path.resolve(__dirname, '../../core/src/render.js');

const tmpDir = mkdtempSync(path.join(tmpdir(), 'what-guarded-arms-'));
process.on('exit', () => { try { rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

let moduleId = 0;

function compile(source, filename = 'fixture.jsx') {
  return transformSync(source, {
    filename,
    plugins: [[babelPlugin, { production: false }]],
    parserOpts: { plugins: ['jsx'] },
    configFile: false,
    babelrc: false,
    compact: false,
  }).code;
}

// Compile something expected to fail, and hand back the error rather than
// letting it escape. Returns null when the compile unexpectedly succeeded.
function compileExpectingError(source, filename = 'fixture.jsx') {
  try {
    compile(source, filename);
    return null;
  } catch (err) {
    return err;
  }
}

// @babel/code-frame colourises through picocolors, which turns colour ON when
// `CI` is in the environment. So the same code frame is plain locally and full
// of SGR escapes on the runner, and a regex matching '> 9 | <Show>' passes on a
// laptop and fails in CI. Assert against the stripped text.
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/g;
const plain = (text) => String(text).replace(ANSI, '');

// Compile something expected to succeed, capturing console.warn.
function compileCapturingWarnings(source, filename = 'fixture.jsx') {
  const warnings = [];
  const orig = console.warn;
  console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };
  try {
    compile(source, filename);
  } finally {
    console.warn = orig;
  }
  return warnings;
}

async function compileAndLoad(source) {
  const out = compile(source)
    .replaceAll('"what-framework/render"', JSON.stringify(CORE_RENDER))
    .replaceAll("'what-framework/render'", JSON.stringify(CORE_RENDER))
    .replaceAll('"what-framework"', JSON.stringify(CORE_INDEX))
    .replaceAll("'what-framework'", JSON.stringify(CORE_INDEX));

  const file = path.join(tmpDir, `mod-${moduleId++}.mjs`);
  writeFileSync(file, out);
  return import(pathToFileURL(file).href);
}

const { mount, flushSync } = await import(pathToFileURL(CORE_INDEX).href);

function render(node) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  mount(node, host);
  return host;
}

// A binding that throws inside an effect never reaches the caller: the effect
// error handler turns it into one console.error and the page keeps going. So
// "did the guarded arm run?" has to watch BOTH channels.
function captureConsole(fn) {
  const logged = [];
  const origError = console.error;
  const origWarn = console.warn;
  console.error = (...args) => { logged.push(`error: ${args.map(String).join(' ')}`); };
  console.warn = (...args) => { logged.push(`warn: ${args.map(String).join(' ')}`); };
  let result;
  let threw = null;
  try {
    result = fn();
  } catch (err) {
    threw = err;
  } finally {
    console.error = origError;
    console.warn = origWarn;
  }
  return { logged, threw, result };
}

function assertQuiet({ logged, threw }, what) {
  assert.equal(
    threw ? threw.message : undefined,
    undefined,
    `${what} threw: ${threw && threw.stack}`
  );
  assert.deepEqual(logged, [], `${what} logged: ${logged.join(' | ')}`);
}

describe('#42 a guarded JSX arm is constructed inside its guard', () => {
  it('`return cond() && <p>{cond().field}</p>` does not build the arm while cond is falsy', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const user = signal(null);
      export function App() {
        return user() && <p>{user().name}</p>;
      }
    `);

    const first = captureConsole(() => mod.App());
    assertQuiet(first, 'falsy-guard render');
    assert.ok(!first.result, 'a falsy guard renders nothing');

    // Positive control: the arm still works once the guard opens, so the
    // assertion above is about laziness and not about a dead branch.
    mod.user({ name: 'Ada' });
    const second = captureConsole(() => mod.App());
    assertQuiet(second, 'truthy-guard render');
    assert.equal(second.result.textContent, 'Ada');
  });

  it('`return cond() ? <p>{cond().field}</p> : <span/>` does not build the untaken arm', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const user = signal(null);
      export function App() {
        return user() ? <p>{user().name}</p> : <span>anon</span>;
      }
    `);

    const first = captureConsole(() => mod.App());
    assertQuiet(first, 'falsy-ternary render');
    assert.equal(first.result.tagName, 'SPAN');

    mod.user({ name: 'Ada' });
    const second = captureConsole(() => mod.App());
    assertQuiet(second, 'truthy-ternary render');
    assert.equal(second.result.textContent, 'Ada');
  });

  it('a guarded arm in a component PROP is not built while the guard is falsy', async () => {
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const user = signal(null);
      function Card(props) { return <div>{props.body}</div>; }
      export function App() {
        return <div><Card body={user() && <p>{user().name}</p>} /></div>;
      }
    `);

    const first = captureConsole(() => render(mod.App()));
    assertQuiet(first, 'falsy-guard prop render');
    assert.doesNotMatch(first.result.innerHTML, /<p>/, 'the guarded arm must not be in the DOM');
    first.result.remove();
  });

  it('a guarded arm as a direct element child stays lazy (regression guard)', async () => {
    // This shape already worked. It is here so the fix cannot be "make the
    // hoist unconditional" in the other direction.
    const mod = await compileAndLoad(`
      import { signal } from 'what-framework';
      export const user = signal(null);
      export function App() {
        return <div>{user() && <p>{user().name}</p>}</div>;
      }
    `);

    const first = captureConsole(() => render(mod.App()));
    assertQuiet(first, 'element-child guard render');
    const host = first.result;
    assert.doesNotMatch(host.innerHTML, /<p>/);

    const update = captureConsole(() => { mod.user({ name: 'Ada' }); flushSync(); });
    assertQuiet(update, 'element-child guard update');
    assert.match(host.innerHTML, /<p>Ada/);
    host.remove();
  });
});

describe('#26 <Show> static children are lazy on the compiled path', () => {
  it('does not run an arm binding while `when` is falsy, and survives both transitions', async () => {
    const mod = await compileAndLoad(`
      import { signal, Show } from 'what-framework';
      export const user = signal(null);
      export function App() {
        return <div><Show when={user}><p>{() => user().name}</p></Show></div>;
      }
    `);

    const mounted = captureConsole(() => render(mod.App()));
    assertQuiet(mounted, 'Show mount with falsy when');
    const host = mounted.result;
    assert.doesNotMatch(host.innerHTML, /<p>/, 'the arm must not be in the DOM');

    const opened = captureConsole(() => { mod.user({ name: 'Ada' }); flushSync(); });
    assertQuiet(opened, 'Show transition to truthy');
    assert.match(host.innerHTML, /Ada/, 'the arm renders once when opens');

    // Transitions back to falsy and open again. DOM only, deliberately.
    //
    // Closing the arm ALSO logs one "[what] Uncaught error in effect during
    // update" from the arm's binding, which is still subscribed to `user` when
    // the write lands and re-runs before the reconcile removes its node. That
    // is NOT a <Show> bug and not this fix's to make: the identical log appears
    // for a plain `{cond() && <p>{cond().field}</p>}` element child, for a
    // ternary child, and for a <Match> arm, i.e. for every conditional shape
    // the compiler emits. Root cause is in packages/core/src/render.js, where
    // insert()'s reactive branch throws away the disposer effect() returns, so
    // disposeTree() has nothing to find on the node it removes.
    const closed = captureConsole(() => { mod.user(null); flushSync(); });
    assert.doesNotMatch(host.innerHTML, /Ada/, 'the arm leaves the DOM when when goes falsy');
    assert.equal(closed.threw, null, `closing the arm threw: ${closed.threw && closed.threw.stack}`);

    const reopened = captureConsole(() => { mod.user({ name: 'Grace' }); flushSync(); });
    assert.match(host.innerHTML, /Grace/, 'the arm renders again when when goes truthy');
    assert.equal(reopened.threw, null, `reopening the arm threw: ${reopened.threw && reopened.threw.stack}`);
    host.remove();
  });

  it('emits the arm construction INSIDE the Show thunk, not beside it', () => {
    // Structural companion to the runtime test above: the mount-time symptom
    // only shows up when the arm's binding happens to throw, so pin the shape
    // directly too. The arm's `_tmpl$` clone must come AFTER the _$insert that
    // installs the Show thunk, which is only true when it lives inside it.
    const code = compile(`
      import { signal, Show } from 'what-framework';
      const user = signal(null);
      export function App() {
        return <div><Show when={user}><p>{() => user().name}</p></Show></div>;
      }
    `);
    const insertIdx = code.indexOf('_$insert(_el$0');
    const armIdx = code.indexOf('_tmpl$1()');
    assert.ok(insertIdx > 0 && armIdx > 0, `unexpected emitted shape:\n${code}`);
    assert.ok(armIdx > insertIdx,
      `the Show arm is built before the thunk that guards it:\n${code}`);
  });

  it('a Show whose fallback is taken never builds the arm', async () => {
    const mod = await compileAndLoad(`
      import { signal, Show } from 'what-framework';
      export const user = signal(null);
      export function App() {
        return (
          <div>
            <Show when={user} fallback={<em>loading</em>}>
              <p>{() => user().name}</p>
            </Show>
          </div>
        );
      }
    `);

    const mounted = captureConsole(() => render(mod.App()));
    assertQuiet(mounted, 'Show mount with fallback taken');
    assert.match(mounted.result.innerHTML, /<em>loading<\/em>/);
    assert.doesNotMatch(mounted.result.innerHTML, /<p>/);
    mounted.result.remove();
  });
});

describe('control-flow build errors reach the developer, not the stack trace', () => {
  // The refusals themselves were fine: <Show> without `when` did fail the
  // build, so "it is a build error" was technically true. What the author got
  // was not the diagnostic. transformShowFineGrained called
  // path.buildCodeFrameError unguarded, and `path` is only a real NodePath when
  // the JSXElement visitor reached the element directly — i.e. when the <Show>
  // was the WHOLE return value. Nested inside anything at all, a parent
  // transform passes a synthetic `{ node: child }`, and the compile died with
  //
  //   TypeError: path.buildCodeFrameError is not a function
  //
  // which names neither the file, nor the line, nor the actual mistake. Since
  // essentially every real <Show> lives inside a <div>, the working case was
  // the rare one.
  //
  // These tests assert on the ERROR TEXT, which is the whole point: an
  // assertion that the build merely failed passes in both worlds.
  const nestedShowWithoutWhen = `
    import { signal, Show } from 'what-framework';
    const open = signal(true);
    export function App() {
      return (
        <div>
          <Show when={open}>
            <div>
              <Show>
                <p>hi</p>
              </Show>
            </div>
          </Show>
        </div>
      );
    }
  `;

  it('a nested <Show> without `when` reports the mistake, not an internal TypeError', () => {
    const err = compileExpectingError(nestedShowWithoutWhen, 'src/Nested.jsx');
    assert.ok(err, 'a <Show> without a when prop must fail the build');
    assert.doesNotMatch(err.message, /is not a function/,
      `the compiler crashed instead of diagnosing:\n${err.stack}`);
    assert.match(err.message, /<Show> requires a "when" prop/);
    assert.match(err.message, /fallback=\{null\}/, 'the message keeps its worked example');
  });

  it('the diagnostic carries the file and points at the offending line', () => {
    const err = compileExpectingError(nestedShowWithoutWhen, 'src/Nested.jsx');
    assert.match(err.message, /src\/Nested\.jsx/, 'the message must name the file');
    // Babel's code frame marks the offending line with a leading '>'. The inner
    // <Show> is on line 9 of the fixture (line 1 is the leading newline).
    assert.match(plain(err.message), />\s*9 \|\s*<Show>/,
      `the code frame must point at the inner <Show>:\n${plain(err.message)}`);
  });

  it('a <Show> that IS the whole return value still reports (regression guard)', () => {
    // This shape always worked, because the visitor hands it a real NodePath.
    // Keep it working: the fix must not trade one path for the other.
    const err = compileExpectingError(`
      import { Show } from 'what-framework';
      export function App() {
        return <Show><p>hi</p></Show>;
      }
    `, 'src/Root.jsx');
    assert.ok(err, 'a bare <Show> without when must still fail the build');
    assert.match(err.message, /<Show> requires a "when" prop/);
    assert.match(err.message, /src\/Root\.jsx/);
  });

  it('a nested <Switch> refusal keeps the file and line too', () => {
    // <Switch> already guarded the call, so it never crashed — but its fallback
    // was a bare `new Error(message)`, which reaches the developer with no
    // location at all. In a large app that is a diagnostic you cannot act on.
    const err = compileExpectingError(`
      import { signal, Show, Switch } from 'what-framework';
      const open = signal(true);
      export function App() {
        return (
          <div>
            <Show when={open}>
              <div>
                <Switch>{'not an arm'}</Switch>
              </div>
            </Show>
          </div>
        );
      }
    `, 'src/Sw.jsx');
    assert.ok(err, 'a <Switch> whose arms cannot be read statically must fail the build');
    assert.match(err.message, /<Switch> cannot read its arms from an expression child/);
    assert.match(err.message, /src\/Sw\.jsx/, 'the message must name the file');
    assert.match(plain(err.message), />\s*9 \|\s*<Switch>/,
      `the code frame must point at the <Switch>:\n${plain(err.message)}`);
  });

  it('a well-formed <Show> compiles with no diagnostic at all', () => {
    // Negative control: the refusal must stay attached to the actual mistake.
    const warnings = compileCapturingWarnings(`
      import { signal, Show } from 'what-framework';
      const open = signal(true);
      export function App() {
        return <div><Show when={open} fallback={null}><p>hi</p></Show></div>;
      }
    `);
    assert.deepEqual(warnings, [], `a valid <Show> warned: ${warnings.join(' | ')}`);
  });
});

describe('ERR_MISSING_KEY is a code the toolchain actually emits', () => {
  // docs-site/llms-full.txt lists ERR_MISSING_KEY among the codes the framework
  // "detects and reports", and the MCP what_fix tool publishes a diagnosis and
  // a worked example filed under that exact name. Nothing anywhere ever emitted
  // the string. The DETECTION was real and already shipping — the compiler
  // bails out of keyed reconciliation and warns — but the warning did not name
  // the code, so an agent that read it had no way to reach the fix filed under
  // it, and the docs' claim was unbacked.
  //
  // Note the channel: this is a BUILD-time report. Whether a list has keys is
  // settled by the source, so the compiler is the only thing that can see it.
  it('names the code when a .map() returns JSX without a key', () => {
    const warnings = compileCapturingWarnings(`
      import { signal } from 'what-framework';
      const todos = signal([]);
      export function List() {
        return <ul>{() => todos().map(t => <li>{t.title}</li>)}</ul>;
      }
    `, 'src/List.jsx');
    assert.equal(warnings.length, 1, `expected exactly one warning, got: ${warnings.join(' | ')}`);
    assert.match(warnings[0], /ERR_MISSING_KEY/);
    assert.match(warnings[0], /src\/List\.jsx:\d+:\d+/, 'the warning must locate the list');
    assert.match(warnings[0], /what_fix/, 'an agent needs the route to the worked example');
  });

  it('stays silent on a keyed list', () => {
    const warnings = compileCapturingWarnings(`
      import { signal } from 'what-framework';
      const todos = signal([]);
      export function List() {
        return <ul>{() => todos().map(t => <li key={t.id}>{t.title}</li>)}</ul>;
      }
    `, 'src/List.jsx');
    assert.deepEqual(warnings, [], `a keyed list warned: ${warnings.join(' | ')}`);
  });

  it('stays silent on a bare index key', () => {
    // A bare index key is deliberate positional reconciliation, which is what
    // the unkeyed path already does correctly. It was exempted on purpose (see
    // the reasoning in babel-plugin.js) and tagging the code must not revive it.
    const warnings = compileCapturingWarnings(`
      import { signal } from 'what-framework';
      const board = signal([]);
      export function Board() {
        return <ul>{() => board().map((sq, i) => <li key={i}>{sq}</li>)}</ul>;
      }
    `, 'src/Board.jsx');
    assert.deepEqual(warnings, [], `a bare index key warned: ${warnings.join(' | ')}`);
  });
});

describe('#24 <For fallback> is not silently discarded', () => {
  it('renders the fallback for an empty list and swaps it for rows and back', async () => {
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal([]);
      export function App() {
        return (
          <div>
            <For each={items} fallback={<p class="empty">nothing here</p>}>
              {(item) => <li>{item}</li>}
            </For>
          </div>
        );
      }
    `);

    const host = render(mod.App());
    assert.match(host.innerHTML, /nothing here/, '<For fallback> must render for an empty list');

    mod.items(['a', 'b']);
    flushSync();
    assert.doesNotMatch(host.innerHTML, /nothing here/, 'fallback goes away once there are rows');
    assert.equal(host.querySelectorAll('li').length, 2);

    mod.items([]);
    flushSync();
    assert.match(host.innerHTML, /nothing here/, 'fallback comes back when the list empties');
    assert.equal(host.querySelectorAll('li').length, 0);
    host.remove();
  });

  it('a non-empty length change does NOT tear the list down', async () => {
    // The emptiness test has to be memoized. Without that, every write to the
    // source re-evaluates the guard thunk, which builds a brand new mapArray
    // inserter and throws away every existing row: correct-looking HTML, no
    // node identity, and a full re-render per keystroke.
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal(['a', 'b']);
      export function App() {
        return (
          <div>
            <For each={items} fallback={<p>empty</p>}>
              {(item) => <li>{item}</li>}
            </For>
          </div>
        );
      }
    `);

    const host = render(mod.App());
    const firstRow = host.querySelector('li');
    assert.equal(firstRow.textContent, 'a');

    mod.items(['a', 'b', 'c']);
    flushSync();
    assert.equal(host.querySelectorAll('li').length, 3);
    assert.strictEqual(host.querySelector('li'), firstRow,
      'growing a non-empty list recreated its DOM — the emptiness guard is not memoized');
    host.remove();
  });

  it('a <For> without a fallback still compiles to a bare inserter', async () => {
    // No fallback must mean no behavior change and no extra emitted machinery.
    const code = compile(`
      import { signal, For } from 'what-framework';
      const items = signal([]);
      export function App() {
        return <div><For each={items}>{(item) => <li>{item}</li>}</For></div>;
      }
    `);
    assert.match(code, /_\$insert\(_el\$\d+, _\$mapArray\(items,/,
      'the no-fallback lowering must stay a bare _$mapArray inserter');
  });

  it('keeps working with a key prop alongside the fallback', async () => {
    // Keyed non-raw mode hands the render function a signal ACCESSOR, not the
    // raw item (see mapArray's contract in packages/core/src/render.js), hence
    // `item()` here.
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal([]);
      export function App() {
        return (
          <div>
            <For each={items} key={(item) => item.id} fallback={<p>empty</p>}>
              {(item) => <li>{() => item().name}</li>}
            </For>
          </div>
        );
      }
    `);

    const host = render(mod.App());
    assert.match(host.innerHTML, /empty/);

    mod.items([{ id: 1, name: 'Ada' }]);
    flushSync();
    assert.doesNotMatch(host.innerHTML, /empty/);
    assert.match(host.innerHTML, /Ada/);
    host.remove();
  });

  it('an empty -> fill cycle does not leave a second live list behind', async () => {
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal([]);
      let calls = 0;
      export function rowCalls() { return calls; }
      export function resetRowCalls() { calls = 0; }
      export function App() {
        return (
          <div>
            <For each={items} fallback={<p>empty</p>}>
              {(item) => { calls++; return <li>{item}</li>; }}
            </For>
          </div>
        );
      }
    `);

    const host = render(mod.App());

    // One probe is two writes that both leave the list non-empty, appending one
    // row each. An unkeyed list only builds rows it does not already have, so a
    // healthy <For> costs exactly two calls per probe forever. An orphaned
    // inserter is still subscribed to `items`, so it renders those same rows
    // again on its own detached fragment and the count climbs per leak. The
    // count is the only visible symptom: the DOM stays right either way.
    const probe = () => {
      mod.resetRowCalls();
      mod.items(['a', 'b', 'c']);
      flushSync();
      mod.items(['a', 'b', 'c', 'd']);
      flushSync();
      const calls = mod.rowCalls();
      mod.items(['a', 'b']);
      flushSync();
      return calls;
    };

    const counts = [];
    const cycling = captureConsole(() => {
      mod.items(['a', 'b']);
      flushSync();
      counts.push(probe());
      for (let cycle = 0; cycle < 3; cycle++) {
        mod.items([]);
        flushSync();
        mod.items(['a', 'b']);
        flushSync();
        counts.push(probe());
      }
    });

    // The leak also announced itself, in a channel a DOM test never reads: the
    // orphans reconcile against a fragment that no longer holds their rows and
    // log "NotFoundError: The child can not be found in the parent".
    assertQuiet(cycling, 'empty/fill cycling');
    assert.deepEqual(counts, [2, 2, 2, 2],
      `each empty -> fill flip left another live list subscribed to the source: ${counts.join(' -> ')}`);

    // Positive control: the list is still the working one at the end.
    assert.equal(host.querySelectorAll('li').length, 2);
    host.remove();
  });

  it('builds the list inserter once, not inside the reactive thunk', () => {
    // Structural companion to the count above. `_$mapArray` must be called from
    // a const at setup, never from inside an arrow that the runtime re-runs,
    // because each call returns a NEW inserter with its own effect and its own
    // rows and nothing disposes the previous one.
    const code = compile(`
      import { signal, For } from 'what-framework';
      const items = signal([]);
      export function App() {
        return <div><For each={items} fallback={<p>empty</p>}>{(item) => <li>{item}</li>}</For></div>;
      }
    `);
    assert.equal((code.match(/_\$mapArray\(/g) || []).length, 1,
      `the list must be constructed exactly once:\n${code}`);
    assert.match(code, /const _for\$\d+ = _\$mapArray\(/,
      `the list must be bound at setup, not built inside a thunk:\n${code}`);
  });

  it('stays a mapArray inserter, so insert() keeps its one-install fast path', async () => {
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal([]);
      export function App() {
        return <For each={items} fallback={<p>empty</p>}>{(item) => <li>{item}</li>}</For>;
      }
    `);

    const inserter = mod.App();
    assert.equal(typeof inserter, 'function');
    // insert(), createDOM(), hydrateNode() and the server's _mapArrayToArray all
    // branch on these. Losing them is what drops the value into insert()'s
    // generic reactive branch, which is where the rebuild-per-flip came from.
    assert.equal(inserter._mapArray, true,
      'the fallback lowering stopped being a mapArray inserter');
    assert.equal(typeof inserter._mapArraySource, 'function',
      'server-side row rendering reads _mapArraySource');
    assert.equal(typeof inserter._mapArrayFn, 'function',
      'server-side row rendering reads _mapArrayFn');
  });

  it('swaps both ways when mounted through createDOM, not just as an element child', async () => {
    // Returning the <For> as a component's entire output mounts it through
    // createDOM, which runs the inserter against a throwaway DocumentFragment
    // and then empties that fragment into the real container. Anything holding
    // the fragment as its parent is reconciling against a detached node from
    // then on: the fallback rendered, and then could never be removed, so it sat
    // under the rows. The list half already survived this (mapArray re-reads its
    // end marker's parent every run); the fallback half has to as well.
    const mod = await compileAndLoad(`
      import { signal, For } from 'what-framework';
      export const items = signal([]);
      export function App() {
        return (
          <For each={items} fallback={<p class="empty">nothing here</p>}>
            {(item) => <li>{item}</li>}
          </For>
        );
      }
    `);

    const host = render(mod.App());
    assert.match(host.innerHTML, /nothing here/, 'the fallback renders at mount');

    const filled = captureConsole(() => { mod.items(['a', 'b']); flushSync(); });
    assertQuiet(filled, 'createDOM-mounted fill');
    assert.equal(host.querySelectorAll('li').length, 2);
    assert.doesNotMatch(host.innerHTML, /nothing here/,
      'the fallback must leave the DOM once rows arrive, not sit underneath them');

    const emptied = captureConsole(() => { mod.items([]); flushSync(); });
    assertQuiet(emptied, 'createDOM-mounted empty');
    assert.equal(host.querySelectorAll('li').length, 0);
    assert.match(host.innerHTML, /nothing here/, 'the fallback comes back');
    host.remove();
  });
});
