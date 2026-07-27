// Deferred component children (compiled JSX) must still look like children:
// Array.isArray true, a real length, realized at most once, and never realized
// at all when the component does not read them.

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

before(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.DocumentFragment = dom.window.DocumentFragment;
  globalThis.queueMicrotask = (fn) => Promise.resolve().then(fn);
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
});
