// Deferred component children (compiled JSX) must still look like children:
// Array.isArray true, a real length, realized at most once, and never realized
// at all when the component does not read them.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

before(() => {
  installDOM('<!DOCTYPE html><html><body></body></html>');
});

describe('lazy component children', () => {
  it('are array-like once realized', async () => {
    const { _$createComponent } = await import('../src/render.js');

    let calls = 0;
    const factory = () => {
      calls++;
      return [document.createElement('a'), document.createElement('b')];
    };
    let seen;
    const Probe = (props) => { seen = props.children; return null; };

    _$createComponent(Probe, {}, factory);

    assert.ok(Array.isArray(seen), 'children should be an array');
    assert.equal(seen.length, 2);
    assert.equal(calls, 1, 'factory runs once');
  });

  it('realize at most once across repeated reads', async () => {
    const { _$createComponent } = await import('../src/render.js');

    let calls = 0;
    const factory = () => { calls++; return [document.createElement('x')]; };
    const Probe = (props) => {
      void props.children; void props.children; void props.children;
      return null;
    };

    _$createComponent(Probe, {}, factory);
    assert.equal(calls, 1, `factory ran ${calls} times, expected 1`);
  });

  it('are not realized when never read', async () => {
    const { _$createComponent } = await import('../src/render.js');

    let calls = 0;
    const Probe = () => null;
    _$createComponent(Probe, {}, () => { calls++; return [document.createElement('x')]; });
    assert.equal(calls, 0, 'unread children should not be realized');
  });

  it('render the same nodes when read and returned twice', async () => {
    const { _$createComponent } = await import('../src/render.js');

    const factory = () => [document.createElement('span')];
    const Probe = (props) => {
      const host = document.createElement('div');
      host.appendChild(document.createElement('i'));
      const first = props.children;
      const second = props.children;
      assert.equal(first, second, 'repeated reads return the same value');
      host.appendChild(first);
      host.appendChild(second);
      return host;
    };

    const out = _$createComponent(Probe, {}, factory);
    const host = out.nodeType === 11 ? out.firstElementChild : out;
    assert.equal(host.querySelectorAll('span').length, 1, 'one node, moved, not duplicated');
  });

  it('realize while the owning component is the current one', async () => {
    const { _$createComponent } = await import('../src/render.js');
    const { getCurrentComponent } = await import('../src/dom.js');

    let owner = null;
    const Probe = (props) => { void props.children; return null; };
    _$createComponent(Probe, {}, () => {
      owner = getCurrentComponent();
      return [document.createElement('i')];
    });

    assert.equal(owner && owner.Component, Probe, 'children must be built inside their owner');
  });

  // Realized children are single-use DOM: a DocumentFragment is drained by its
  // first insertion, and nodes a consumer removed have had their effects
  // disposed. Caching them for the life of the component instance makes a
  // component that re-reads props.children from a reactive thunk lose its
  // children permanently after the first teardown.
  it('rebuild for a consumer that tears them down and re-reads them', async () => {
    const { _$createComponent } = await import('../src/render.js');
    const { signal } = await import('../src/reactive.js');
    const { mount } = await import('../src/dom.js');

    const open = signal(true);
    let builds = 0;
    const factory = () => {
      builds++;
      const frag = document.createDocumentFragment();
      const span = document.createElement('span');
      span.className = 'kid';
      frag.appendChild(span);
      return [frag];
    };
    const Panel = (props) => () => (open() ? props.children : 'CLOSED');

    const host = document.createElement('div');
    document.body.appendChild(host);
    mount(_$createComponent(Panel, {}, factory), host);

    const kids = () => host.querySelectorAll('.kid').length;
    const settle = () => new Promise((r) => setTimeout(r, 0));

    assert.equal(kids(), 1, 'children render initially');
    open(false); await settle();
    assert.equal(kids(), 0);
    open(true); await settle();
    assert.equal(kids(), 1, 'children come back after the first toggle');
    open(false); await settle();
    assert.equal(kids(), 0);
    open(true); await settle();
    assert.equal(kids(), 1, 'children come back after the second toggle');

    assert.ok(builds > 1, 'a torn-down subtree has to be rebuilt, not re-inserted');
    host.remove();
  });

  it('unwrap a single child the way eager children do', async () => {
    const { _$createComponent } = await import('../src/render.js');

    let lazySeen;
    let eagerSeen;
    const LazyProbe = (props) => { lazySeen = props.children; return null; };
    const EagerProbe = (props) => { eagerSeen = props.children; return null; };

    _$createComponent(LazyProbe, {}, () => ['only']);
    _$createComponent(EagerProbe, {}, ['only']);

    assert.equal(lazySeen, 'only');
    assert.equal(eagerSeen, 'only');
  });

  // hydrateNode builds its own props object, so it has to speak the same
  // children protocol as createComponent. It used to read props.children, which
  // the compiled path no longer sets, and handed the component `undefined`.
  // This drives the vnode shape _$createComponent produces straight into
  // hydrate(), which is the only way to reach that branch: _$createComponent
  // itself builds its DOM eagerly, so hydrating compiled output takes
  // hydrateNode's DOM-passthrough branch rather than its component branch.
  it('reach the component on the hydration path too', async () => {
    const { hydrate } = await import('../src/render.js');

    let seen;
    const Wrapper = (props) => {
      seen = props.children;
      const el = document.createElement('div');
      el.className = 'wrap';
      el.appendChild(seen);
      return el;
    };

    // _$lazyChildren returns the children value already unwrapped, the way the
    // wrapper _$createComponent installs does.
    const lazy = () => {
      const span = document.createElement('span');
      span.className = 'kid';
      span.textContent = 'hi';
      return span;
    };
    lazy._lazyChildren = true;
    const props = {};
    Object.defineProperty(props, '_$lazyChildren', { value: lazy, configurable: true });

    const host = document.createElement('div');
    host.innerHTML = '<div class="wrap"><span class="kid">hi</span></div>';
    document.body.appendChild(host);

    hydrate({ tag: Wrapper, props, children: [], key: null, _vnode: true }, host);

    assert.notEqual(seen, undefined, 'hydration must pass children to the component');
    assert.equal(seen.className, 'kid');
    host.remove();
  });
});
