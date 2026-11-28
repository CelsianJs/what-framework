// The commit of React rows that native What code places in a hole, against
// React 19.3.1's (the matrix fixture's react-dom, compared by the scratch
// probe of the fourth review): the hole is a container what-react's own
// reconciler renders into (mixed.js holeRows, runtime.js _mountMarked).
// - a hole whose parent is a native fragment mounts and updates;
// - a ref, layout or passive effect that unmounts the page returns its
//   cleanup, and the cleanup runs (React defers such an unmount until the
//   commit is done);
// - a hole's commit renders nothing that waits in another root;
// - a signal a React callback reads is not the hole's;
// - a row that leaves is removed before the rows that stay are updated, and
//   a class's getSnapshotBeforeUpdate still sees it;
// - a removed row's cleanup that stops the native owner (which takes the
//   hole's nodes out of the page) ends the commit: nothing more is set up
//   on nodes out of the page, and what was set up is cleaned up;
// - an error no boundary catches unmounts the container and is reported;
// - a hole's first rows run their refs and layout effects on nodes in the
//   page;
// - unmounting runs every layout cleanup, then the passive ones, on nodes out
//   of the page;
// - a row that a layout effect queued state for, and that its list removes
//   in the same update, is not rendered again (the sixth review's hole-edge
//   dirty scene, against React 19.3.1's hole-control).
// A production build with no what-core vnode renderer, through Vite (what()
// and reactCompat()), run in jsdom.
// Run: node --test packages/react-compat/test/native-keyed-commit.test.js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { reactCompat } from '../src/vite-plugin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const what = (await import(path.join(REPO, 'packages/compiler/src/vite-plugin.js'))).default;
const FRAMEWORK = { 'what-framework': 'what', 'what-core': 'core', 'what-router': 'router', 'what-server': 'server', 'what-react': 'react-compat' };

const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'what-react-commit-')));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const root = path.join(scratch, 'app');
for (const [pkg, dir] of Object.entries(FRAMEWORK)) {
  for (const entry of ['package.json', 'src']) {
    fs.cpSync(path.join(REPO, 'packages', dir, entry), path.join(root, 'node_modules', pkg, entry), { recursive: true });
  }
}

const files = {
  'package.json': JSON.stringify({ name: 'app', type: 'module' }),
  'src/rows.jsx': `import { Component, useState, useEffect, useLayoutEffect, startTransition } from 'react';
import { createRoot } from 'react-dom/client';
const note = (...x) => window.events.push(x.join(' '));
const connected = (id) => !!document.getElementById(id)?.isConnected;
export function Label({ id }) {
  useLayoutEffect(() => {
    note('layout+', id, connected(id));
    return () => note('layout-', id, connected(id));
  }, []);
  useEffect(() => {
    note('passive+', id);
    return () => note('passive-', id, connected(id));
  }, []);
  return <b id={id} ref={(el) => { note('ref+', id, el.isConnected); return () => note('ref-', id); }}>{id}</b>;
}
// Unmounts the page from a ref, a layout effect or a passive effect, and
// returns the cleanup of a listener it added.
function Kill({ phase }) {
  useLayoutEffect(() => {
    if (phase !== 'layout') return;
    const live = () => note('layout listener retained');
    window.addEventListener('probe', live);
    window.stopPage();
    return () => { window.removeEventListener('probe', live); note('layout cleanup'); };
  }, []);
  useEffect(() => {
    if (phase !== 'passive') return;
    const live = () => note('passive listener retained');
    window.addEventListener('probe', live);
    window.stopPage();
    return () => { window.removeEventListener('probe', live); note('passive cleanup'); };
  }, []);
  return <i ref={phase === 'ref' ? (el) => {
    const live = () => note('ref listener retained');
    window.addEventListener('probe', live);
    window.stopPage();
    return () => { window.removeEventListener('probe', live); note('ref cleanup'); };
  } : undefined}>kill</i>;
}
function Read({ id }) {
  useLayoutEffect(() => { note('read', id, window.shared()); }, []);
  return <b>{id}</b>;
}
function Crash({ id }) {
  useLayoutEffect(() => { throw new Error('layout crash ' + id); }, []);
  return <b>{id}</b>;
}
// A row whose layout cleanup notes itself, and stops the page when \`quit\`.
function Delete({ quit }) {
  useLayoutEffect(() => () => { note('delete cleanup'); if (quit) window.stopPage(); }, []);
  return <i id="deleted">delete</i>;
}
class Snapshot extends Component {
  getSnapshotBeforeUpdate() { return !!document.querySelector('#deleted'); }
  componentDidUpdate(_p, _s, snapshot) { note('snapshot', snapshot); }
  render() { return <i>{this.props.n}</i>; }
}
function Retained({ n }) {
  useLayoutEffect(() => { note('retained setup', n); return () => note('retained cleanup', n); }, [n]);
  return <i id="retained">{n}</i>;
}
// The sixth review's dirty scene (verify-wave6 hole-edge-rows.jsx).
let setList, setOld;
function DirtyRow({ id }) {
  const [n, set] = useState(0);
  if (id === 'old') setOld = set;
  note('render', id, n);
  useLayoutEffect(() => () => note('layout-', id, connected(id)), []);
  return <i id={id}>{id}{n}</i>;
}
function DirtyList() {
  const [n, set] = useState(0);
  setList = set;
  return n ? [<DirtyRow id="new" key="new" />, <DirtyRow id="tail" key="tail" />]
    : [<DirtyRow id="old" key="old" />, <DirtyRow id="tail" key="tail" />];
}
function Kick({ n }) {
  useLayoutEffect(() => { if (n) { setOld(1); setList(1); } }, [n]);
  return <i>kick</i>;
}
export function rows(scene, n) {
  if (scene === 'dirty') return [<DirtyList key="list" />, <Kick key="kick" n={n} />];
  if (scene === 'kill') return n ? [<Kill key="kill" phase={window.killPhase} />, <Label key="peer" id="peer" />] : [<Label key="old" id="old" />];
  if (scene === 'tracked') { note('factory', n); return [<Read key={n} id={'r' + n} />]; }
  if (scene === 'crash') return n ? [<Crash key="bad" id="bad" />, <Label key="good" id="good" />] : [<Label key="good" id="good" />];
  if (scene === 'snapshot') return n ? [<Snapshot key="kept" n={n} />, <Label key="new" id="new" />] : [<Snapshot key="kept" n={n} />, <Delete key="delete" />];
  if (scene === 'removestop') return n ? [<Retained key="kept" n={n} />, <Label key="new" id="new" />] : [<Retained key="kept" n={n} />, <Delete key="delete" quit />];
  if (scene === 'replace') return (n ? ['b', 'c'] : ['a', 'b']).map((id) => <Label key={id} id={id + (id === 'b' ? n : '')} />);
  return (n ? ['x', 'y'] : ['x']).map((id) => <Label key={id} id={id} />);
}
// Another React root, with a transition.
export function side(el) {
  function Side() {
    const [n, setN] = useState(0);
    window.setSide = (v) => startTransition(() => setN(v));
    return <b id="side">{n}</b>;
  }
  createRoot(el).render(<Side />);
}
`,
  'src/main.jsx': `import { signal, mount, flushSync } from 'what-framework';
import { rows, side } from './rows.jsx';
window.events = [];
const n = signal(0);
let scene = '';
window.shared = signal(0);
function Page() {
  return <main>{rows(scene, n())}</main>;
}
function FragPage() {
  return <>{rows(scene, n())}</>;
}
window.start = (name, frag) => {
  scene = name;
  n(0);
  window.events = [];
  const el = document.getElementById('page');
  el.textContent = '';
  window.stopPage = mount(frag ? <FragPage /> : <Page />, el);
};
window.put = (v, sync = true) => { n(v); if (sync) flushSync(); };
side(document.getElementById('side-root'));
`,
};
for (const [rel, text] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

async function quiet(fn) {
  const { log, warn } = console;
  console.log = () => {};
  console.warn = () => {};
  try { return await fn(); } finally { console.log = log; console.warn = warn; }
}

const outDir = path.join(root, 'dist');
await quiet(() => build({
  root, configFile: false, logLevel: 'silent',
  plugins: [what({ prodBundles: false }), reactCompat()],
  resolve: { conditions: ['browser'] },
  build: { outDir, emptyOutDir: true, modulePreload: false, rollupOptions: { input: path.join(root, 'src', 'main.jsx') } },
}));
const assets = path.join(outDir, 'assets');
const bundle = path.join(assets, fs.readdirSync(assets).find((f) => f.startsWith('main-') && f.endsWith('.js')));

const { installDOM } = await import(path.join(REPO, 'test-utils/dom.js'));
installDOM();
document.body.innerHTML = '<div id="page"></div><div id="side-root"></div>';
await import(pathToFileURL(bundle).href);
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };
await settle();
const take = () => window.events.splice(0);

test('a hole whose parent is a native fragment mounts and updates', async () => {
  window.start('', true);
  await settle();
  assert.equal(document.getElementById('page').textContent, 'x');
  window.put(1);
  await settle();
  assert.equal(document.getElementById('page').textContent, 'xy');
  window.stopPage();
});

test('a hole\'s first rows run their refs and layout effects on nodes in the page (React: connected)', async () => {
  window.start('', false);
  await settle();
  assert.deepEqual(take().filter((e) => !e.startsWith('passive')), ['ref+ x true', 'layout+ x true']);
  window.stopPage();
  await settle();
});

for (const phase of ['ref', 'layout', 'passive']) {
  test(`a ${phase} callback that unmounts the page returns its cleanup, and the cleanup runs (React 19.3.1: once, no listener left)`, async () => {
    window.killPhase = phase;
    window.start('kill', false);
    await settle();
    take();
    window.put(1);
    await settle();
    window.dispatchEvent(new window.Event('probe'));
    const events = take();
    assert.equal(events.filter((e) => e === `${phase} cleanup`).length, 1, events.join(' | '));
    assert.ok(!events.some((e) => e.includes('retained')), events.join(' | '));
    // what-core took the page's nodes out as it stopped: the peer that
    // mounted with it is set up only if it was before then, on nodes in the
    // page, and what was set up is cleaned up.
    assert.ok(!events.some((e) => /^(ref|layout)\+ peer false/.test(e)), events.join(' | '));
    assert.equal(events.filter((e) => e.startsWith('layout+ peer')).length, events.filter((e) => e.startsWith('layout- peer')).length, events.join(' | '));
    assert.equal(events.filter((e) => e.startsWith('passive+ peer')).length, events.filter((e) => e.startsWith('passive- peer')).length, events.join(' | '));
    assert.equal(document.getElementById('page').textContent, '');
  });
}

test('a hole\'s commit renders nothing that waits in another root: an observer queued after the update still sees the other root\'s old value', async () => {
  window.start('', false);
  await settle();
  window.put(1, false);
  let seen = null;
  queueMicrotask(() => { seen = document.getElementById('side').textContent; });
  window.setSide(5);
  await settle();
  assert.equal(seen, '0');
  assert.equal(document.getElementById('side').textContent, '5');
  window.stopPage();
  await settle();
});

test('a signal a row\'s layout effect reads is not the hole\'s: writing it does not run the native code again', async () => {
  window.start('tracked', false);
  await settle();
  window.put(1);
  await settle();
  take();
  window.shared(1);
  await settle();
  assert.deepEqual(take(), []);
  window.stopPage();
  await settle();
});

test('a row that leaves is removed before the rows that stay are updated (React 19.3.1 order)', async () => {
  window.start('replace', false);
  await settle();
  take();
  window.put(1);
  await settle();
  const events = take();
  // a's cleanups come before b's ref (a new function each render) is
  // detached: React removes a first. React 19.3.1 logs layout- a, ref- a,
  // ref- b0, then the layout phase: ref+ b1, ref+ c, layout+ c.
  assert.deepEqual(events.filter((e) => !e.startsWith('passive')), ['layout- a true', 'ref- a', 'ref- b0', 'ref+ b1 true', 'ref+ c true', 'layout+ c true']);
  window.stopPage();
  await settle();
});

test('a class\'s getSnapshotBeforeUpdate sees the row the commit removes (React 19.3.1: delete cleanup, snapshot true, then the layout phase)', async () => {
  window.start('snapshot', false);
  await settle();
  take();
  window.put(1);
  assert.deepEqual(take().filter((e) => !e.startsWith('passive')), ['delete cleanup', 'snapshot true', 'ref+ new true', 'layout+ new true']);
  window.stopPage();
  await settle();
});

test('a removed row\'s cleanup that stops the native owner ends the commit: nothing is set up on nodes out of the page, and what was is cleaned up', async () => {
  window.start('removestop', false);
  await settle();
  take();
  window.put(1);
  await settle();
  window.dispatchEvent(new window.Event('probe'));
  // The retained row's old layout effect is cleaned up; its new one, and the
  // incoming row's ref and effects, never run (React finishes the commit on
  // nodes still in the page, then unmounts: what-core has taken them out).
  assert.deepEqual(take(), ['delete cleanup', 'retained cleanup 0']);
  assert.equal(document.getElementById('page').textContent, '');
});

test('an error no boundary catches unmounts the hole\'s rows and is reported, as React unmounts a root', async () => {
  window.start('crash', false);
  await settle();
  take();
  const printed = [];
  const { error } = console;
  console.error = (...args) => printed.push(args.map(String).join(' '));
  try {
    window.put(1);
    await settle();
  } finally {
    console.error = error;
  }
  assert.ok(printed.some((line) => line.includes('layout crash bad')), printed.join(' | '));
  assert.equal(document.getElementById('page').textContent, '');
  const events = take();
  assert.ok(events.includes('layout- good false') || events.includes('layout- good true'), events.join(' | '));
  assert.ok(events.some((e) => e.startsWith('passive- good')), events.join(' | '));
  window.stopPage();
  await settle();
});

test('unmounting the page runs every row\'s layout cleanup, then the passive cleanups, on nodes out of the page', async () => {
  window.start('', false);
  await settle();
  window.put(1);
  await settle();
  take();
  window.stopPage();
  await settle();
  const events = take().filter((e) => !e.startsWith('ref'));
  assert.deepEqual(events.slice(0, 2).map((e) => e.split(' ').slice(0, 2).join(' ')), ['layout- x', 'layout- y']);
  assert.deepEqual(events.slice(2), ['passive- x false', 'passive- y false']);
});

test('a row a layout effect queued state for, and that its list removes in the same update, is not rendered again (React 19.3.1 hole-control dirty)', async () => {
  window.start('dirty', false);
  await settle();
  take();
  window.put(1);
  await settle();
  // React 19.3.1: the hole's update renders the list (old 0, tail 0); Kick's
  // layout effect queues old 1 and the list's new state; the list renders
  // (new 0, tail 0), and old, which it removed, is not rendered.
  assert.deepEqual(take(), ['render old 0', 'render tail 0', 'render new 0', 'render tail 0', 'layout- old true']);
  assert.equal(document.getElementById('page').textContent, 'new0tail0kick');
  window.stopPage();
  await settle();
});
