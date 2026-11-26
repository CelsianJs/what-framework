// A reactive child whose value is text writes its text node when its text
// differs from the text it wrote last, not from the node's (render.js region,
// adoptRegion): text something outside What wrote into the node stays until
// the value changes, as with Solid's. A hydrated one starts from the text it
// claimed, so a value that differs from the server's is still written. Text
// in an option still has its select follow it; text anywhere else is not
// reported to the select code.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

let cleanup;
let core;
let render;
let renderToString;
let mod;
let host;

before(async () => {
  ({ cleanup } = installDOM());
  core = await import('../src/index.js');
  render = await import('../src/render.js');
  ({ renderToString } = await import('what-server'));
  mod = await loadCompiled(`
    import { signal, mount } from 'what-framework';
    export const n = signal(1);
    export const v = signal('z');
    export const label = signal('y');
    export const run = (el) => mount(() => <div>
      <p id="sign">{() => (n() > 0 ? 'pos' : 'neg')}</p>
      <select id="flat" value={v()}><option>{label()}</option><option>b</option></select>
      <select id="grouped" value={v()}><optgroup label="g"><option>{label()}</option><option>b</option></optgroup></select>
    </div>, el);
  `);
  host = document.body.appendChild(document.createElement('div'));
  mod.run(host);
  core.flushSync();
});
after(() => cleanup());

describe('a text region compares with the text it wrote last', () => {
  it('leaves text written outside What until its value changes', () => {
    const node = host.querySelector('#sign').firstChild;
    assert.equal(node.data, 'pos');
    node.data = 'edited';
    mod.n(2);
    core.flushSync();
    assert.equal(node.data, 'edited', 'the same text is not written again');
    mod.n(-1);
    core.flushSync();
    assert.equal(node.data, 'neg');
    node.data = 'again';
    mod.n(3);
    core.flushSync();
    assert.equal(node.data, 'pos');
    assert.equal(host.querySelector('#sign').firstChild, node, 'the same node throughout');
  });

  it('an option\'s text is still its value: the select follows a change of it', () => {
    for (const id of ['flat', 'grouped']) {
      const select = host.querySelector(`#${id}`);
      assert.equal(select.options[0].selected, false, id);
    }
    mod.label('z');
    core.flushSync();
    for (const id of ['flat', 'grouped']) {
      const select = host.querySelector(`#${id}`);
      assert.equal(select.options[0].text, 'z', id);
      assert.equal(select.options[0].selected, true, id);
      assert.equal(select.value, 'z', id);
    }
    mod.label('y');
    core.flushSync();
  });

  it('the text engine hears every run, written or not', () => {
    const heard = [];
    render._setTextInsertHook((parent, text) => { if (parent.id === 'sign') heard.push(text); });
    try {
      mod.n(4);
      core.flushSync();
      mod.n(-4);
      core.flushSync();
    } finally {
      render._setTextInsertHook(null);
    }
    assert.deepEqual(heard, ['pos', 'neg']);
  });
});

describe('a hydrated text region starts from the text it claimed', () => {
  const view = (n) => core.h('p', { id: 'h' }, () => (n() > 0 ? 'pos' : 'neg'));
  const hydrated = (serverN, clientN) => {
    const el = document.body.appendChild(document.createElement('div'));
    el.innerHTML = renderToString(view(core.signal(serverN)));
    const n = core.signal(clientN);
    const reports = [];
    const { warn, error } = console;
    console.warn = console.error = () => {};
    let dispose;
    try {
      dispose = render.hydrate(view(n), el, { onHydrationError: (info) => reports.push(info) });
      core.flushSync();
    } finally {
      Object.assign(console, { warn, error });
    }
    return { el, n, dispose, reports, node: el.querySelector('#h').firstChild };
  };

  it('writes a value that differs from the server\'s text, then compares with what it wrote', () => {
    const { n, dispose, node, reports } = hydrated(1, 1);
    assert.deepEqual(reports, []);
    assert.equal(node.data, 'pos');
    n(-1);
    core.flushSync();
    assert.equal(node.data, 'neg');
    node.data = 'edited';
    n(-2);
    core.flushSync();
    assert.equal(node.data, 'edited');
    n(1);
    core.flushSync();
    assert.equal(node.data, 'pos');
    dispose();
  });

  it('a mismatch corrected while hydrating is the text it compares with', () => {
    const { n, dispose, el, reports } = hydrated(1, -1);
    assert.equal(reports.length, 1, 'the server\'s text was not the client\'s');
    const node = el.querySelector('#h').firstChild;
    assert.equal(node.data, 'neg');
    node.data = 'edited';
    n(-3);
    core.flushSync();
    assert.equal(node.data, 'edited');
    n(2);
    core.flushSync();
    assert.equal(node.data, 'pos');
    dispose();
  });
});
