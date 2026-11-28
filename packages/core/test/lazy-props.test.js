// JSX passed to a component, as its children or in any other prop, behaves as
// an element does with h() and in React (dom.js _installLazyChildren):
// - it is built where it is placed, once per placement, under the owner of the
//   place, and disposed with it;
// - building it reads no signal into the scope around the place: a <Show>, a
//   reactive condition or an effect does not rebuild it when a signal its JSX
//   read at creation changes (a value prop is frozen, as with h());
// - a read that does not place it (a test in onMount or useEffect, a read in
//   an event handler) never runs its components a second time and never
//   builds it with no owner: such a build is the component's (its context,
//   its boundary, disposed with it).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';
import { loadCompiled } from '../../../test-utils/load-compiled.js';

installDOM('<!DOCTYPE html><html><body></body></html>');

const { h, mount, flushSync } = await import('what-framework');

const PRELUDE = `
import { signal, effect, onMount, onCleanup, useEffect, useContext, createContext, Show, ErrorBoundary } from 'what-framework';
export const log = [];
export const tick = signal(0);
export const open = signal(true);
export const item = signal({ title: 'first' });
export const Session = createContext('anon');
export function Clock() {
  log.push('Clock run ' + useContext(Session));
  onMount(() => log.push('Clock mount'));
  onCleanup(() => log.push('Clock cleanup'));
  effect(() => { log.push('Clock effect ' + tick()); });
  return <time>{tick}</time>;
}
export function EditForm({ title }) {
  log.push('EditForm run ' + title);
  onCleanup(() => log.push('EditForm cleanup'));
  return <form><input name="draft" /><span>{title}</span></form>;
}
export function Boom() { throw new Error('slot threw'); }
`;

async function page(source) {
  const mod = await loadCompiled(PRELUDE + source);
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = mount(h(mod.Page), host);
  flushSync();
  const take = () => mod.log.splice(0);
  return {
    mod, host, take,
    $: (sel) => host.querySelector(sel),
    unmount() { dispose(); flushSync(); host.remove(); },
  };
}

describe('JSX props placed in a tracked scope', () => {
  const shapes = {
    'a slot in <Show>': `function Modal({ body }) { return <div><Show when={open}>{body}</Show></div>; }
      export function Page() { return <Modal body={<EditForm title={item().title} />} />; }`,
    'a slot in a reactive condition': `function Panel(props) { return <div>{() => open() ? props.body : null}</div>; }
      export function Page() { return <Panel body={<EditForm title={item().title} />} />; }`,
    'children in a reactive condition': `function Panel({ children }) { return <div>{() => open() ? children : null}</div>; }
      export function Page() { return <Panel><EditForm title={item().title} /></Panel>; }`,
    'a slot handed into a boundary in <Show>': `function Modal({ body }) { return <div><Show when={open}><ErrorBoundary fallback={<p>failed</p>}>{body}</ErrorBoundary></Show></div>; }
      export function Page() { return <Modal body={<EditForm title={item().title} />} />; }`,
  };
  for (const [name, source] of Object.entries(shapes)) {
    it(`${name}: a write to a signal its JSX read leaves it alone, and showing it again builds it again`, async () => {
      const p = await page(source);
      assert.deepEqual(p.take(), ['EditForm run first']);
      p.$('[name=draft]').value = 'typed by the user';
      p.mod.item({ title: 'second' });
      flushSync();
      assert.deepEqual(p.take(), [], 'not torn down and built again');
      assert.equal(p.$('[name=draft]').value, 'typed by the user');
      p.mod.open(false);
      flushSync();
      p.mod.open(true);
      flushSync();
      assert.deepEqual(p.take(), ['EditForm cleanup', 'EditForm run second'], 'placed again, it is built again, as with h()');
      p.unmount();
      p.mod.open(true);
    });
  }
});

describe('JSX props read after the run without placing them', () => {
  it('read in an event handler and shown: built once, owned by the component, with its context, disposed with it', async () => {
    const p = await page(`
      function Dialog(props) {
        const shown = signal(null);
        return <div><button class="open" onClick={() => shown(props.content)}>open</button><dialog>{() => shown()}</dialog></div>;
      }
      export function Page() { return <Session value="page"><Dialog content={<Clock />} /></Session>; }`);
    assert.deepEqual(p.take(), []);
    p.$('.open').click();
    flushSync();
    p.$('.open').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock run page', 'Clock effect 0', 'Clock mount'], 'one Clock, which sees the page\'s context');
    p.mod.tick(1);
    flushSync();
    assert.deepEqual(p.take(), ['Clock effect 1']);
    p.unmount();
    assert.deepEqual(p.take(), ['Clock cleanup']);
    p.mod.tick(2);
    flushSync();
    assert.deepEqual(p.take(), [], 'nothing outlives the unmount');
  });

  it('a throw while it is built after the run reaches the boundary around the component, not the handler', async () => {
    const p = await page(`
      export const caught = [];
      function Dialog(props) {
        const shown = signal(null);
        return <div><button class="open" onClick={() => { try { shown(props.content); } catch (e) { caught.push(e.message); } }}>open</button>{() => shown()}</div>;
      }
      export function Page() { return <ErrorBoundary fallback={<i class="fb">boundary</i>}><Dialog content={<Boom />} /></ErrorBoundary>; }`);
    p.$('.open').click();
    flushSync();
    assert.ok(p.$('.fb'), 'the boundary shows its fallback');
    assert.deepEqual(p.mod.caught, []);
    p.unmount();
  });

  it('read after an await in onMount: built with the component\'s context', async () => {
    const p = await page(`
      function List(props) { const shown = signal(null); onMount(async () => { await Promise.resolve(); shown(props.empty); }); return <div>{() => shown()}</div>; }
      export function Page() { return <Session value="page"><List empty={<Clock />} /></Session>; }`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    assert.deepEqual(p.take(), ['Clock run page', 'Clock effect 0', 'Clock mount']);
    p.unmount();
    assert.deepEqual(p.take(), ['Clock cleanup']);
  });

  for (const hook of ['onMount', 'useEffect']) {
    it(`tested in ${hook} once the run placed it: true, with no second instance`, async () => {
      const p = await page(`
        function Card(props) {
          const hasIcon = signal(false);
          ${hook}(() => { if (props.icon) hasIcon(true); });
          return <div class={() => (hasIcon() ? 'card with-icon' : 'card')}>{props.icon}</div>;
        }
        export function Page() { return <Card icon={<Clock />} />; }`);
      assert.deepEqual(p.take(), ['Clock run anon', 'Clock effect 0', 'Clock mount']);
      assert.equal(p.host.firstElementChild.className, 'card with-icon');
      p.mod.tick(1);
      flushSync();
      assert.deepEqual(p.take(), ['Clock effect 1']);
      p.unmount();
      assert.deepEqual(p.take(), ['Clock cleanup']);
    });
  }

  it('a condition the run never read is tested by what it gives: null is false, and builds nothing', async () => {
    const p = await page(`
      function Card(props) { const has = signal('unset'); onMount(() => has(props.icon ? 'icon' : 'none')); return <div>{has}</div>; }
      export function Page() { return <Card icon={open() ? null : <Clock />} />; }`);
    assert.equal(p.host.textContent, 'none');
    assert.deepEqual(p.take(), []);
    p.unmount();
  });

  it('once placed, shown elsewhere it is another copy, built and disposed where it is shown', async () => {
    const p = await page(`
      function Dialog(props) {
        const shown = signal(null);
        return <div><p class="inline">{props.content}</p><button class="open" onClick={() => shown(props.content)}>open</button><button class="close" onClick={() => shown(null)}>close</button><dialog>{() => shown()}</dialog></div>;
      }
      export function Page() { return <Dialog content={<Clock />} />; }`);
    assert.deepEqual(p.take(), ['Clock run anon', 'Clock effect 0', 'Clock mount']);
    p.$('.open').click();
    flushSync();
    p.$('.open').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock run anon', 'Clock effect 0', 'Clock mount'], 'one more copy, shown in the dialog');
    assert.ok(p.$('.inline time') && p.$('dialog time'), 'the inline copy stays where it is');
    p.$('.close').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock cleanup'], 'disposed with its place');
    p.unmount();
    assert.deepEqual(p.take(), ['Clock cleanup']);
  });

  it('shown in a dialog, hidden and shown again: a copy each time, one built where it is shown disposed when hidden', async () => {
    const p = await page(`
      function Dialog(props) {
        const shown = signal(null);
        return <div><button class="open" onClick={() => shown(props.content)}>open</button><button class="close" onClick={() => shown(null)}>close</button><dialog>{() => shown()}</dialog></div>;
      }
      export function Page() { return <Dialog content={<Clock />} />; }`);
    p.$('.open').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock run anon', 'Clock effect 0', 'Clock mount']);
    p.$('.close').click();
    flushSync();
    assert.equal(p.$('dialog time'), null);
    p.take();
    p.$('.open').click();
    flushSync();
    assert.ok(p.$('dialog time'), 'shown again');
    assert.deepEqual(p.take(), ['Clock run anon', 'Clock effect 0', 'Clock mount']);
    p.$('.close').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock cleanup'], 'a copy built where it is shown is disposed when it is hidden');
    p.unmount();
    p.mod.tick(9);
    flushSync();
    assert.deepEqual(p.take().filter((e) => e.startsWith('Clock effect')), [], 'nothing outlives the unmount');
  });

  it('JSX built in an event handler that places the prop: the build is the component\'s', async () => {
    const p = await page(`
      function Holder(props) {
        const node = signal(null);
        return <div><button class="go" onClick={() => node(<section>{props.header}</section>)}>go</button>{() => node()}</div>;
      }
      export function Page() { return <Session value="page"><Holder header={<Clock />} /></Session>; }`);
    p.$('.go').click();
    flushSync();
    assert.deepEqual(p.take(), ['Clock run page', 'Clock effect 0', 'Clock mount']);
    p.unmount();
    assert.deepEqual(p.take(), ['Clock cleanup']);
    p.mod.tick(5);
    flushSync();
    assert.deepEqual(p.take(), []);
  });

  it('an array prop aliased in the run is that build: indexed in a thunk, the same nodes', async () => {
    const p = await page(`
      export const at = signal(0);
      function Tabs(props) { const panels = props.panels; return <div>{() => panels[at()]}</div>; }
      export function Page() { return <Tabs panels={[<b>one</b>, <i>two</i>]} />; }`);
    const first = p.$('b');
    assert.equal(p.host.textContent, 'one');
    p.mod.at(1);
    flushSync();
    assert.equal(p.host.textContent, 'two');
    p.mod.at(0);
    flushSync();
    assert.equal(p.$('b'), first, 'the same nodes, not a build per read');
    p.unmount();
  });

  it('data a prop hands on is given as it is after the run', async () => {
    const p = await page(`
      export const seen = [];
      const api = { name: 'api' };
      function Inner(props) { return <button class="go" onClick={() => seen.push(props.api.name, props.api === api)}>go</button>; }
      function Outer(props) { return <Inner api={props.api} />; }
      export function Page() { return <Outer api={api} />; }`);
    p.$('.go').click();
    p.$('.go').click();
    assert.deepEqual(p.mod.seen, ['api', true, 'api', true]);
    p.unmount();
  });
});

describe('a .map() or an array literal of JSX in a prop', () => {
  it('is built where the component places it, under its owner', async () => {
    const p = await page(`
      function Item({ label }) { log.push('Item ' + label + ' ' + useContext(Session)); return <li>{label}</li>; }
      function Menu({ items }) { log.push('Menu'); return <Session value="menu"><ul>{items}</ul></Session>; }
      export function Page() { return <Menu items={['a', 'b'].map((l) => <Item label={l} />)} />; }`);
    assert.deepEqual(p.take(), ['Menu', 'Item a menu', 'Item b menu']);
    assert.equal(p.host.textContent, 'ab');
    p.unmount();
  });
});
