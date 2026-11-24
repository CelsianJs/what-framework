// what-react: the React semantics popular packages depend on. Each test
// states what React does; each was found by a package in the browser matrix
// (test/matrix-browser.mjs) failing without it, named in the test.
// Run: node --test packages/react-compat/test/
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDOM } from '../../../test-utils/dom.js';

const { dom } = installDOM('<!DOCTYPE html><html><body></body></html>');
for (const k of ['HTMLElement', 'Element', 'Node', 'SVGElement', 'CustomEvent', 'Event', 'MouseEvent', 'KeyboardEvent', 'FocusEvent', 'InputEvent', 'MutationObserver', 'FormData', 'getComputedStyle', 'DocumentFragment', 'Text', 'Comment']) {
  try { if (!(k in global)) global[k] = dom.window[k]; } catch { /* read-only global */ }
}
try { global.navigator = dom.window.navigator; } catch { /* Node ≥21 read-only getter */ }

const React = await import('../src/index.js');
const ReactDOM = await import('../src/dom.js');
const { c: memoCache } = await import('../src/compiler-runtime.js');
const {
  createElement: h, useState, useEffect, useLayoutEffect, useRef, useReducer, useContext, createContext,
  useSyncExternalStore, useTransition, useOptimistic, useActionState, useEffectEvent, startTransition,
  Suspense, Component, PureComponent, act, use, Children,
} = React;
const { createRoot, createPortal, flushSync, unstable_batchedUpdates, findDOMNode, useFormStatus } = ReactDOM;

const roots = [];
function mount(element) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return { container, root };
}
// Each test starts from an empty page (jsdom finds `#id` through the
// document, so an id left over from another test would hide this one's).
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.textContent = '';
});
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { await tick(); act(() => {}); await tick(); act(() => {}); };
const fire = (el, type, init = {}) => {
  const Ctor = type === 'click' ? MouseEvent : type.startsWith('key') ? KeyboardEvent : type.startsWith('focus') ? FocusEvent : Event;
  const event = new Ctor(type, { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(event);
  return event;
};
const typeInto = (input, value) => { input.value = value; fire(input, 'input'); };

// ---------------------------------------------------------------
// DOM props
// ---------------------------------------------------------------

test('aria-* and data-* booleans are written as text, never dropped (react-hook-form, Radix)', () => {
  const { container } = mount(h('button', { 'aria-pressed': false, 'aria-busy': true, 'data-open': false, 'aria-label': undefined }));
  const el = container.firstChild;
  assert.equal(el.getAttribute('aria-pressed'), 'false');
  assert.equal(el.getAttribute('aria-busy'), 'true');
  assert.equal(el.getAttribute('data-open'), 'false');
  assert.equal(el.hasAttribute('aria-label'), false);
});

test('a prop that is undefined or null is left out, not written as an empty value (react-aria-components)', () => {
  let set;
  function App() {
    const [on, s] = useState(true);
    set = s;
    return h('div', null,
      h('input', { id: 'i', maxLength: undefined, tabIndex: undefined, pattern: undefined, title: on ? 'tip' : undefined }),
      h('a', { id: 'a', href: undefined }, 'x'),
      h('div', { id: 'd', tabIndex: null, hidden: on ? true : undefined }));
  }
  const { container } = mount(h(App));
  const input = container.querySelector('#i');
  // '' would make maxLength 0: a field that accepts no text.
  assert.equal(input.hasAttribute('maxlength'), false);
  assert.equal(input.hasAttribute('pattern'), false);
  assert.equal(input.hasAttribute('tabindex'), false);
  assert.equal(container.querySelector('#a').hasAttribute('href'), false);
  assert.equal(container.querySelector('#d').hasAttribute('tabindex'), false);
  assert.equal(input.getAttribute('title'), 'tip');
  assert.equal(container.querySelector('#d').hidden, true);
  act(() => set(false));
  assert.equal(input.hasAttribute('title'), false, 'a prop that becomes undefined is taken back');
  assert.equal(container.querySelector('#d').hidden, false);
});

test('autoFocus focuses the element when it mounts (MUI Dialog, cmdk)', () => {
  const { container } = mount(h('div', null, h('input', { id: 'first' }), h('input', { id: 'auto', autoFocus: true })));
  assert.equal(document.activeElement, container.querySelector('#auto'));
  assert.equal(container.querySelector('#auto').hasAttribute('autofocus'), false);
});

// ---------------------------------------------------------------
// Events
// ---------------------------------------------------------------

test('a handler gets a synthetic event: own fields that survive a copy, and React\'s methods (react-aria, Radix Select)', () => {
  const seen = {};
  const { container } = mount(h('div', { onKeyDown: (e) => { seen.outer = e.isPropagationStopped(); } },
    h('button', {
      onKeyDown: (e) => {
        const copy = { ...e };
        seen.key = copy.key;
        seen.type = copy.type;
        seen.target = copy.target;
        seen.current = e.currentTarget;
        seen.native = e.nativeEvent instanceof KeyboardEvent;
        seen.before = e.isPropagationStopped();
        e.persist();
        e.preventDefault();
        seen.prevented = e.isDefaultPrevented() && e.defaultPrevented;
      },
    })));
  const button = container.querySelector('button');
  const event = fire(button, 'keydown', { key: 'ArrowDown' });
  assert.equal(seen.key, 'ArrowDown');
  assert.equal(seen.type, 'keydown');
  assert.equal(seen.target, button);
  assert.equal(seen.current, button);
  assert.equal(seen.native, true);
  assert.equal(seen.before, false);
  assert.equal(seen.prevented, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(seen.outer, false);
});

test('onFocus and onBlur bubble and report React\'s types; onChange reports change', () => {
  const types = [];
  const { container } = mount(h('div', { onFocus: (e) => types.push('focus:' + e.type), onBlur: (e) => types.push('blur:' + e.type) },
    h('input', { onChange: (e) => types.push('change:' + e.type + ':' + e.target.value) })));
  const input = container.querySelector('input');
  fire(input, 'focusin');
  typeInto(input, 'a');
  fire(input, 'focusout');
  assert.deepEqual(types, ['focus:focus', 'change:change:a', 'blur:blur']);
});

test('onInput and onChange on one field each keep their handler; an undefined one removes nothing (react-aria-components)', () => {
  const calls = [];
  let set;
  function App() {
    const [both, s] = useState(false);
    set = s;
    return h('input', { onChange: () => calls.push('change'), onInput: both ? () => calls.push('input') : undefined });
  }
  const { container } = mount(h(App));
  const input = container.querySelector('input');
  typeInto(input, 'a');
  assert.deepEqual(calls, ['change'], 'onInput={undefined} did not take the onChange listener away');
  act(() => set(true));
  typeInto(input, 'ab');
  assert.deepEqual(calls, ['change', 'input', 'change'], 'both run, onChange last');
  act(() => set(false));
  typeInto(input, 'abc');
  assert.deepEqual(calls, ['change', 'input', 'change', 'change']);
});

test('a controlled field goes back to its value when the handler does not take the edit (input-otp)', async () => {
  let checkedSeen = null;
  function App() {
    const [text, setText] = useState('ab');
    return h('div', null,
      h('input', { id: 't', value: text, onChange: (e) => { if (/^[a-z]*$/.test(e.target.value)) setText(e.target.value); } }),
      h('input', { id: 'c', type: 'checkbox', checked: false, onChange: (e) => { checkedSeen = e.target.checked; } }));
  }
  const { container } = mount(h(App));
  const text = container.querySelector('#t');
  typeInto(text, 'ab1');
  await settle();
  assert.equal(text.value, 'ab', 'the refused character is gone');
  typeInto(text, 'abc');
  await settle();
  assert.equal(text.value, 'abc');
  const box = container.querySelector('#c');
  box.click();
  await settle();
  assert.equal(checkedSeen, true, 'the handler saw the click\'s value');
  assert.equal(box.checked, false, 'and the box shows its prop again');
});

test('an event inside a portal reaches the React parents, capture first (Radix layers, MUI ClickAwayListener)', () => {
  const calls = [];
  const target = document.createElement('div');
  document.body.appendChild(target);
  function App() {
    return h('section', { onClickCapture: () => calls.push('capture section'), onClick: (e) => calls.push('bubble section ' + (e.currentTarget.tagName)) },
      h('div', { onClick: () => calls.push('bubble div') },
        createPortal(h('p', { onClick: () => calls.push('bubble p') },
          h('button', { id: 'in', onClick: () => calls.push('bubble button') }),
          h('button', { id: 'stop', onClick: (e) => { e.stopPropagation(); calls.push('stopped'); } })), target)));
  }
  const { container, root } = mount(h(App));
  assert.equal(container.contains(target.querySelector('#in')), false, 'the button is not a DOM descendant of the section');
  fire(target.querySelector('#in'), 'click');
  assert.deepEqual(calls, ['capture section', 'bubble button', 'bubble p', 'bubble div', 'bubble section SECTION']);
  calls.length = 0;
  fire(target.querySelector('#stop'), 'click');
  assert.deepEqual(calls, ['capture section', 'stopped'], 'stopPropagation in the portal stops the React parents too');
  calls.length = 0;
  fire(container.querySelector('div'), 'click');
  assert.deepEqual(calls, ['capture section', 'bubble div', 'bubble section SECTION'], 'an event outside a portal is handled once');
  act(() => root.unmount());
});

// ---------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------

test('two portals in one container do not re-insert each other\'s nodes on a re-render: focus stays (Radix Dialog)', () => {
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('div', null,
      createPortal(h('i', { id: 'overlay' }, n), document.body),
      createPortal(h('div', { id: 'content' }, h('input', { id: 'field' }), n), document.body));
  }
  mount(h(App));
  const field = document.querySelector('#field');
  field.focus();
  const observer = new MutationObserver(() => {});
  observer.observe(document.body, { childList: true });
  act(() => set(1));
  assert.equal(observer.takeRecords().length, 0, 'no node of <body> moved');
  assert.equal(document.activeElement, field);
  assert.equal(document.querySelector('#content').textContent, '1');
  observer.disconnect();
});

test('a kept node is not moved because of a node the list does not own (a library appended one)', () => {
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('ul', null, h('li', { id: 'a' }, n), h('li', { id: 'b' }, 'b'));
  }
  const { container } = mount(h(App));
  const ul = container.querySelector('ul');
  ul.appendChild(document.createElement('hr'));
  ul.insertBefore(document.createElement('em'), ul.querySelector('#b'));
  const observer = new MutationObserver(() => {});
  observer.observe(ul, { childList: true });
  act(() => set(1));
  assert.equal(observer.takeRecords().length, 0);
  assert.equal([...ul.children].map((c) => c.tagName).join(','), 'LI,EM,LI,HR');
  observer.disconnect();
});

test('an unkeyed child keeps its slot when a keyed sibling before it goes (react-select)', () => {
  let set;
  function App() {
    const [hint, s] = useState(true);
    set = s;
    return h('div', null, hint ? h('em', { key: 'placeholder' }, 'type here') : null, h('input', { id: 'field' }));
  }
  const { container } = mount(h(App));
  const field = container.querySelector('#field');
  field.value = 'typed';
  field.focus();
  act(() => set(false));
  assert.equal(container.querySelector('em'), null);
  assert.equal(container.querySelector('#field'), field, 'the same input element');
  assert.equal(field.value, 'typed');
  assert.equal(document.activeElement, field);
  act(() => set(true));
  assert.equal(container.querySelector('#field'), field);
  assert.equal(container.querySelector('div').firstChild.tagName, 'EM', 'the keyed sibling comes back in front of it');
});

test('a nested array is a list of its own: the child after a growing .map() list keeps its state', () => {
  let setRows;
  let made = 0;
  function Footer() {
    const [id] = useState(() => ++made);
    return h('footer', null, id);
  }
  function App() {
    const [rows, s] = useState(['a']);
    setRows = s;
    // Rows without keys (React matches them by index inside their own
    // list), then rows with keys: the footer's slot is the same either way.
    return h('div', null, rows.map((r) => h('p', null, r)), rows.map((r) => h('i', { key: r }, r)), h(Footer));
  }
  const { container } = mount(h(App));
  const first = container.querySelector('i');
  act(() => setRows(['c', 'a', 'b']));
  assert.equal(container.textContent, 'cabcab1', 'the footer was kept, not mounted again');
  assert.equal(container.querySelectorAll('i')[1], first, 'a keyed row keeps its element when the list reorders');
  act(() => setRows([]));
  assert.equal(container.textContent, '1');
});

test('unmounting removes an element a library moved out of its place (cmdk sorts its items in the DOM)', () => {
  let set;
  function Item({ name }) { return h('li', { id: name }, name); }
  function App() {
    const [names, s] = useState(['a', 'b', 'c']);
    set = s;
    return h('ul', null, names.map((n) => h(Item, { key: n, name: n })));
  }
  const { container } = mount(h(App));
  const ul = container.querySelector('ul');
  // What cmdk's sort does: append the elements in score order.
  ul.appendChild(ul.querySelector('#a'));
  ul.appendChild(ul.querySelector('#b'));
  act(() => set(['c']));
  assert.equal([...ul.querySelectorAll('li')].map((li) => li.id).join(','), 'c');
});

// ---------------------------------------------------------------
// Effects
// ---------------------------------------------------------------

test('a commit\'s passive effects run before the next render (Radix DismissableLayer registers, then reads)', async () => {
  // The layer registers itself in an effect and tells the others with an
  // event; each re-renders on that event and reads the registry while it
  // renders. The element arrives through a ref callback that sets state, so
  // a second render is already queued when the first commit's effects are
  // still waiting: they have to run first, or the listener is not there yet.
  const registry = new Set();
  const listeners = new Set();
  const emit = () => listeners.forEach((l) => l());
  function Layer() {
    const [node, setNode] = useState(null);
    const [, force] = useState({});
    useEffect(() => {
      if (!node) return undefined;
      registry.add(node);
      emit();
      return () => { registry.delete(node); emit(); };
    }, [node]);
    useEffect(() => {
      const update = () => force({});
      listeners.add(update);
      return () => listeners.delete(update);
    }, []);
    return h('div', { ref: setNode, 'data-registered': node !== null && registry.has(node) });
  }
  const { container } = mount(h(Layer));
  await settle();
  assert.equal(container.querySelector('div').getAttribute('data-registered'), 'true');
});

test('layout effects run child before parent when both re-rendered on their own in one commit (cmdk)', () => {
  const listeners = new Set();
  let version = 0;
  const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
  const seen = [];
  function Child() {
    const v = useSyncExternalStore(subscribe, () => version);
    const ref = useRef(null);
    useLayoutEffect(() => { ref.current.setAttribute('data-v', String(v)); });
    return h('i', { ref });
  }
  // Nothing re-renders Middle, so the parent's render stops there: the
  // child renders on its own, after the parent, in the same commit.
  function Middle() { return h(Child); }
  const middle = h(Middle);
  function Parent() {
    const v = useSyncExternalStore(subscribe, () => version);
    const ref = useRef(null);
    // The parent reads what its child's layout effect wrote.
    useLayoutEffect(() => { seen.push(v + ':' + ref.current.querySelector('i').getAttribute('data-v')); });
    return h('div', { ref }, middle);
  }
  mount(h(Parent));
  act(() => { version = 1; listeners.forEach((l) => l()); });
  assert.deepEqual(seen, ['0:0', '1:1']);
});

test('a callback ref may return a cleanup, called in place of the call with null', () => {
  const calls = [];
  let set;
  const ref = (el) => { calls.push(el ? 'attach' : 'null'); return () => calls.push('cleanup'); };
  function App() {
    const [on, s] = useState(true);
    set = s;
    return on ? h('b', { ref }) : null;
  }
  mount(h(App));
  act(() => set(false));
  assert.deepEqual(calls, ['attach', 'cleanup']);
});

test('an error thrown in an effect reaches the error boundary', async () => {
  class Boundary extends Component {
    constructor(props) { super(props); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() { return this.state.error ? h('b', null, 'caught ' + this.state.error.message) : this.props.children; }
  }
  function Bad() { useEffect(() => { throw new Error('in effect'); }, []); return h('i', null, 'fine'); }
  const { container } = mount(h(Boundary, null, h(Bad)));
  await settle();
  assert.equal(container.textContent, 'caught in effect');
});

test('unstable_batchedUpdates runs its callback without rendering before it returns', () => {
  let set;
  function App() { const [n, s] = useState(0); set = s; return h('b', null, n); }
  const { container } = mount(h(App));
  let during;
  unstable_batchedUpdates(() => set(1));
  during = container.textContent;
  act(() => {});
  assert.equal(during, '0');
  assert.equal(container.textContent, '1');
  flushSync(() => set(2));
  assert.equal(container.textContent, '2', 'flushSync is what renders now');
});

// ---------------------------------------------------------------
// Class components
// ---------------------------------------------------------------

test('a class gets its context in the constructor, and a ref to it is the instance (react-transition-group, react-select)', () => {
  const Ctx = createContext('none');
  class Box extends Component {
    static contextType = Ctx;
    constructor(props, context) {
      super(props, context);
      this.state = { fromConstructor: context };
    }
    hello() { return 'hi ' + this.props.name; }
    render() { return h('b', null, this.state.fromConstructor + '/' + this.context + '/' + ('ref' in this.props)); }
  }
  const ref = { current: null };
  const { container, root } = mount(h(Ctx.Provider, { value: 'given' }, h(Box, { ref, name: 'ada' })));
  assert.equal(container.textContent, 'given/given/false');
  assert.equal(ref.current.hello(), 'hi ada');
  assert.equal(findDOMNode(ref.current), container.querySelector('b'));
  act(() => root.unmount());
  assert.equal(ref.current, null);
});

test('shouldComponentUpdate compares against the state that is still current, and skips the render and componentDidUpdate', () => {
  const log = [];
  class Counter extends Component {
    constructor(props) { super(props); this.state = { n: 0, noise: 0 }; this.renders = 0; }
    shouldComponentUpdate(nextProps, nextState) { return nextState.n !== this.state.n; }
    componentDidUpdate(prevProps, prevState) { log.push(`update ${prevState.n}->${this.state.n}`); }
    render() { this.renders++; return h('b', null, this.state.n + ':' + this.renders); }
  }
  class Pure extends PureComponent {
    renders = 0;
    render() { this.renders++; return h('i', null, this.props.label + ':' + this.renders); }
  }
  const ref = { current: null };
  let rerender;
  function App() {
    const [, force] = useReducer((x) => x + 1, 0);
    rerender = force;
    return h('div', null, h(Counter, { ref }), h(Pure, { label: 'same' }));
  }
  const { container } = mount(h(App));
  act(() => rerender());
  assert.equal(container.textContent, '0:1same:1', 'a parent re-render with nothing new skips both');
  act(() => ref.current.setState({ noise: 1 }));
  assert.equal(container.querySelector('b').textContent, '0:1', 'a state change the component says not to render for');
  assert.equal(ref.current.state.noise, 1, 'the state is updated all the same');
  let seenInCallback = null;
  act(() => {
    ref.current.setState((s) => ({ n: s.n + 1 }), () => { seenInCallback = container.querySelector('b').textContent; });
    assert.equal(ref.current.state.n, 0, 'this.state changes at the render, not at the call');
  });
  assert.equal(container.querySelector('b').textContent, '1:2');
  assert.equal(seenInCallback, '1:2', 'the setState callback runs after the commit');
  assert.deepEqual(log, ['update 0->1']);
  act(() => ref.current.forceUpdate());
  assert.equal(container.querySelector('b').textContent, '1:3', 'forceUpdate skips shouldComponentUpdate');
});

test('componentDidMount runs in the commit, and the legacy lifecycles are called', () => {
  const log = [];
  class Old extends Component {
    UNSAFE_componentWillMount() { log.push('willMount'); }
    componentDidMount() { log.push('didMount ' + document.body.contains(findDOMNode(this))); }
    UNSAFE_componentWillReceiveProps(next) { log.push('willReceive ' + next.n); }
    componentWillUnmount() { log.push('willUnmount'); }
    render() { return h('b', null, this.props.n); }
  }
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    useLayoutEffect(() => { log.push('parent layout'); }, []);
    return n < 2 ? h(Old, { n }) : null;
  }
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  root.render(h(App));
  // No act() yet: componentDidMount is not a passive effect.
  assert.deepEqual(log, ['willMount', 'didMount true', 'parent layout']);
  act(() => set(1));
  act(() => set(2));
  assert.deepEqual(log.slice(3), ['willReceive 1', 'willUnmount']);
});

// ---------------------------------------------------------------
// Suspense, transitions, actions
// ---------------------------------------------------------------

test('content that suspends after it was shown stays mounted, hidden, and keeps its state', async () => {
  let resolve;
  let setPromise;
  let bump;
  function Stateful({ promise }) {
    const [n, setN] = useState(0);
    bump = () => setN((x) => x + 1);
    const value = promise ? use(promise) : 'none';
    return h('b', null, n + ':' + value);
  }
  function App() {
    const [promise, s] = useState(null);
    setPromise = s;
    return h(Suspense, { fallback: h('i', null, 'wait') }, h(Stateful, { promise }));
  }
  const { container } = mount(h(App));
  act(() => bump());
  act(() => bump());
  const shown = container.querySelector('b');
  assert.equal(shown.textContent, '2:none');
  act(() => setPromise(new Promise((r) => { resolve = r; })));
  assert.equal(container.querySelector('i').textContent, 'wait');
  assert.equal(container.querySelector('b'), shown, 'the element is still mounted');
  assert.equal(shown.style.display, 'none');
  resolve('done');
  await settle();
  assert.equal(container.querySelector('i'), null);
  assert.equal(container.querySelector('b'), shown);
  assert.equal(shown.textContent, '2:done', 'the state survived');
  assert.equal(shown.style.display, '');
});

test('an async transition: isPending and optimistic state last until it ends, and its updates land together', async () => {
  const frames = [];
  let like;
  function App() {
    const [likes, setLikes] = useState(1);
    const [optimistic, addOptimistic] = useOptimistic(likes, (current, add) => current + add);
    const [isPending, start] = useTransition();
    like = () => start(async () => {
      addOptimistic(1);
      await tick(10);
      startTransition(() => setLikes((n) => n + 1));
      await tick(10);
    });
    frames.push(optimistic + (isPending ? 'p' : ''));
    return h('b', null, optimistic);
  }
  const { container } = mount(h(App));
  like();
  // Until the action has ended (its timers run late on a loaded machine).
  for (let i = 0; i < 200 && frames[frames.length - 1] !== '2'; i++) await tick(10);
  act(() => {});
  assert.equal(container.textContent, '2');
  // Never 3: the real value and the optimistic one are not shown together.
  assert.deepEqual([...new Set(frames)], ['1', '2p', '2']);
});

test('useActionState with a form action: FormData in, pending out, useFormStatus, the form reset', async () => {
  const frames = [];
  function Status() {
    const { pending } = useFormStatus();
    return h('button', { type: 'submit' }, pending ? 'sending' : 'send');
  }
  function App() {
    const [state, formAction, isPending] = useActionState(async (prev, data) => {
      await tick(10);
      return { count: prev.count + 1, name: data.get('name') };
    }, { count: 0, name: '' });
    frames.push(`${state.count}:${state.name}:${isPending}`);
    return h('form', { action: formAction }, h('input', { name: 'name', defaultValue: '' }), h(Status), h('output', null, state.count + ':' + state.name));
  }
  const { container } = mount(h(App));
  const form = container.querySelector('form');
  assert.equal(form.hasAttribute('action'), false, 'a function is not written as the action attribute');
  form.querySelector('input').value = 'ada';
  form.requestSubmit();
  act(() => {});
  assert.equal(container.querySelector('button').textContent, 'sending');
  await tick(40);
  act(() => {});
  assert.equal(container.querySelector('output').textContent, '1:ada');
  assert.equal(container.querySelector('button').textContent, 'send');
  assert.equal(form.querySelector('input').value, '', 'the form was reset');
  assert.deepEqual([...new Set(frames)], ['0::false', '0::true', '1:ada:false']);
});

test('React 19 forms of context, refs and events: <Context value>, element.ref, useEffectEvent', () => {
  const Theme = createContext('light');
  const seen = [];
  let setCount;
  function Label() { return h('b', null, use(Theme) + '/' + useContext(Theme)); }
  function App() {
    const [count, s] = useState(0);
    setCount = s;
    const onEvent = useEffectEvent(() => seen.push(count));
    useEffect(() => { onEvent(); }, []);
    useEffect(() => () => onEvent(), []);
    return h(Theme, { value: 'dark' }, h(Label));
  }
  const ref = () => {};
  assert.equal(h('i', { ref }).ref, ref, 'element.ref for libraries written for React 18');
  assert.equal(h('i', { ref }).props.ref, ref, 'and props.ref for React 19');
  const { container, root } = mount(h(App));
  assert.equal(container.textContent, 'dark/dark');
  act(() => setCount(5));
  act(() => root.unmount());
  assert.deepEqual(seen, [0, 5], 'the effect event sees the latest render\'s values');
});

// ---------------------------------------------------------------
// Portals into a library's own document
// ---------------------------------------------------------------

test('a portal into a document that is not the DOM\'s builds the library\'s own nodes (react-aria-components collections)', () => {
  // What react-aria keeps: nodes that are plain objects, linked by hand.
  class FakeNode {
    constructor(ownerDocument, type) { this.ownerDocument = ownerDocument; this.type = type; this.firstChild = null; this.lastChild = null; this.nextSibling = null; this.previousSibling = null; this.parentNode = null; }
    get children() { const out = []; for (let n = this.firstChild; n; n = n.nextSibling) out.push(n); return out; }
    removeChild(child) {
      if (child.previousSibling) child.previousSibling.nextSibling = child.nextSibling; else this.firstChild = child.nextSibling;
      if (child.nextSibling) child.nextSibling.previousSibling = child.previousSibling; else this.lastChild = child.previousSibling;
      child.parentNode = child.nextSibling = child.previousSibling = null;
    }
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.nextSibling = before ?? null;
      child.previousSibling = before ? before.previousSibling : this.lastChild;
      if (child.previousSibling) child.previousSibling.nextSibling = child; else this.firstChild = child;
      if (before) before.previousSibling = child; else this.lastChild = child;
    }
    appendChild(child) { this.insertBefore(child, null); }
  }
  class FakeDocument extends FakeNode {
    constructor() { super(null, '#document'); this.ownerDocument = this; this.nodeType = 11; }
    createElement(type) { return new FakeNode(this, type); }
  }
  const doc = new FakeDocument();
  const outline = (node) => node.type + (node.firstChild ? '(' + node.children.map(outline).join(' ') + ')' : '') + (node.props ? '=' + node.props : '');
  let setKeys;
  function Item({ name, children }) {
    // The library hands each node its data through a ref.
    return h('item', { ref: (node) => { if (node) node.props = name; } }, children);
  }
  function App() {
    const [keys, s] = useState(['a', 'b']);
    setKeys = s;
    return h('div', null, 'real', createPortal(keys.map((k) => h(Item, { key: k, name: k }, k === 'b' ? h(Item, { name: 'b1' }) : null)), doc));
  }
  const { container, root } = mount(h(App));
  assert.equal(outline(doc), '#document(item=a item(item=b1)=b)');
  assert.equal(doc.firstChild instanceof FakeNode, true, 'the ref and the tree are the library\'s nodes, not DOM elements');
  assert.equal(container.textContent, 'real', 'nothing of the portal shows in the page');
  act(() => setKeys(['c', 'b', 'a']));
  assert.equal(outline(doc), '#document(item=c item(item=b1)=b item=a)');
  act(() => setKeys(['a']));
  assert.equal(outline(doc), '#document(item=a)');
  act(() => root.unmount());
  assert.equal(doc.firstChild, null);
});

// ---------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------

test('the React 19 names libraries import exist (a missing export fails the whole build)', () => {
  for (const name of ['useOptimistic', 'useActionState', 'useEffectEvent', 'Profiler', 'Activity', 'unstable_Activity', 'cache', 'captureOwnerStack', 'use', 'startTransition']) {
    assert.equal(typeof React[name], 'function', `react: ${name}`);
    assert.equal(typeof React.default[name], 'function', `react default: ${name}`);
  }
  for (const name of ['useFormStatus', 'useFormState', 'requestFormReset', 'preload', 'preinit', 'preconnect', 'prefetchDNS', 'preloadModule', 'preinitModule', 'flushSync', 'createPortal']) {
    assert.equal(typeof ReactDOM[name], 'function', `react-dom: ${name}`);
  }
  const { container } = mount(h(React.Profiler, { id: 'p', onRender() {} }, h(React.Activity, { mode: 'visible' }, h('b', null, 'in'))));
  assert.equal(container.textContent, 'in');
  assert.equal(React.cache((a, b) => a + b)(1, 2), 3);
  assert.equal(Children.count([null, 'a']), 2);
});

test('react/compiler-runtime: the memo cache of a component compiled by React Compiler', () => {
  const sentinel = Symbol.for('react.memo_cache_sentinel');
  const caches = [];
  let set;
  function Compiled() {
    const $ = memoCache(2);
    caches.push($);
    const [n, s] = useState(0);
    set = s;
    if ($[0] === sentinel) $[0] = 'computed once';
    return h('b', null, $[0] + ':' + n);
  }
  const { container } = mount(h(Compiled));
  assert.deepEqual([caches[0].length, caches[0][1]], [2, sentinel]);
  act(() => set(1));
  assert.equal(caches[1], caches[0], 'the same cache on every render');
  assert.equal(container.textContent, 'computed once:1');
});

// ===============================================================
// The second review: the same components on real React and on what-react.
// Each test states what React does; the values marked "React 19.3.0" or
// "React 18.3.1" are what that React printed for the same component in jsdom
// (the review's probe scripts), kept here as the expected values.
// ===============================================================

class Boundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { if (this.props.onCatch) this.props.onCatch(error, info); }
  render() { return this.state.error ? h('b', null, 'caught ' + this.state.error.message) : this.props.children; }
}

// ---------------------------------------------------------------
// State actions are queued and run by the render
// ---------------------------------------------------------------

test('a reducer that throws reaches the error boundary, not the caller of dispatch', () => {
  let dispatch;
  function App() {
    const [state, d] = useReducer((s, action) => { if (action === 'boom') throw new Error('reducer boom'); return s + 1; }, 0);
    dispatch = d;
    return h('i', null, 'state=' + state);
  }
  const { container } = mount(h(Boundary, null, h(App)));
  // React 19.3.0: dom="BOUNDARY:reducer boom", nothing thrown at dispatch or act.
  assert.doesNotThrow(() => act(() => dispatch('boom')));
  assert.equal(container.textContent, 'caught reducer boom');
});

test('a useState updater that throws reaches the error boundary', () => {
  let set;
  function App() {
    const [n, s] = useState(0);
    set = s;
    return h('i', null, 'n=' + n);
  }
  const { container } = mount(h(Boundary, null, h(App)));
  assert.doesNotThrow(() => act(() => set(() => { throw new Error('updater boom'); })));
  assert.equal(container.textContent, 'caught updater boom');
});

test('queued updaters run in order while the component renders, and never when it unmounts first', () => {
  const log = [];
  let set, setShown;
  function Counter() {
    const [n, s] = useState(0);
    set = s;
    log.push('render ' + n);
    return h('i', null, n);
  }
  function App() {
    const [shown, s] = useState(true);
    setShown = s;
    return shown ? h(Counter) : null;
  }
  const { container } = mount(h(App));
  log.length = 0;
  act(() => {
    set(1);
    set((n) => { log.push('updater saw ' + n); return n + 10; });
    set((n) => { log.push('updater saw ' + n); return n + 100; });
    log.push('after the calls');
  });
  // The first action is resolved at the call (React's eager state); the ones behind it wait for the render.
  assert.deepEqual(log, ['after the calls', 'updater saw 1', 'updater saw 11', 'render 111']);
  assert.equal(container.textContent, '111');

  log.length = 0;
  act(() => {
    set(1);
    set((n) => { log.push('updater ran'); return n + 1; });
    setShown(false);
  });
  assert.deepEqual(log, [], 'the component unmounted before it rendered: its queued updater never ran');
  assert.equal(container.textContent, '');
});

test('an action that leaves the state as it is schedules no render; an updater runs once', () => {
  let renders = 0, calls = 0, set, dispatch;
  function App() {
    const [n, s] = useState(0);
    const [m, d] = useReducer((state, add) => state + add, 0);
    set = s; dispatch = d;
    renders++;
    return h('i', null, n + ':' + m);
  }
  const { container } = mount(h(App));
  act(() => { set(0); set((n) => n); dispatch(0); });
  assert.equal(renders, 1);
  act(() => set((n) => { calls++; return n + 1; }));
  assert.equal(calls, 1, 'the result of the call-time run is the render\'s');
  assert.equal(container.textContent, '1:0');
  act(() => { dispatch(2); dispatch(3); });
  assert.equal(container.textContent, '1:5');
});

test('a queued action runs with the reducer of the render that applies it', () => {
  let dispatch, setStep;
  function Counter({ step }) {
    const [n, d] = useReducer((state) => state + step, 0);
    dispatch = d;
    return h('i', null, n);
  }
  function App() {
    const [step, s] = useState(1);
    setStep = s;
    return h(Counter, { step });
  }
  const { container } = mount(h(App));
  // The first dispatch is resolved at the call, with the reducer of the last
  // render (step 1); the second waits for the render, whose reducer adds 10.
  act(() => { dispatch(); setStep(10); dispatch(); });
  assert.equal(container.textContent, '11');
});

test('setState during render (derived state) renders again before the commit, with the queue applied', () => {
  const effects = [];
  function App({ items }) {
    const [prev, setPrev] = useState(items);
    const [selected, setSelected] = useState('first');
    if (items !== prev) { setPrev(items); setSelected(null); }
    useEffect(() => { effects.push('selected=' + selected); });
    return h('i', null, 'selected=' + selected);
  }
  const a = [1], b = [2];
  const { container, root } = mount(h(App, { items: a }));
  act(() => root.render(h(App, { items: b })));
  assert.equal(container.textContent, 'selected=null');
  assert.deepEqual(effects, ['selected=first', 'selected=null']);
});

// ---------------------------------------------------------------
// Controlled fields
// ---------------------------------------------------------------

// What a user's keystroke does, as testing tools do it: the prototype's
// setter (which React's value tracking does not see), then the event.
const nativeValue = (el, value) => Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
const typed = (el, value) => { nativeValue(el, value); return fire(el, 'input'); };
const selectedOf = (select) => [...select.options].filter((o) => o.selected).map((o) => o.value).join(',');
const options = () => [h('option', { key: 'a', value: 'a' }, 'A'), h('option', { key: 'b', value: 'b' }, 'B'), h('option', { key: 'c', value: 'c' }, 'C')];

test('a refused edit is back to the prop when the event\'s dispatch returns, and an accepted one has rendered', () => {
  let renders = 0;
  function App() {
    const [text, setText] = useState('ab');
    renders++;
    return h('div', null,
      h('input', { id: 'fixed', value: 'a', onChange() {} }),
      h('input', { id: 'letters', value: text, onChange: (e) => { if (/^[a-z]*$/.test(e.target.value)) setText(e.target.value); } }),
      h('i', { id: 'shown' }, text));
  }
  const { container } = mount(h(App));
  const fixed = container.querySelector('#fixed');
  typed(fixed, 'ab');
  // React 19.3.0: "a" read right after dispatchEvent, with no act() and no tick.
  assert.equal(fixed.value, 'a');
  const letters = container.querySelector('#letters');
  typed(letters, 'abc');
  assert.equal(letters.value, 'abc');
  assert.equal(container.querySelector('#shown').textContent, 'abc', 'the update rendered before the dispatch returned');
  typed(letters, 'abc1');
  assert.equal(letters.value, 'abc');
  assert.equal(renders, 2);
});

test('a controlled field is restored after every handler ran: one on its form takes the edit, one that stops the event does not hide it', () => {
  const seen = [];
  function App() {
    const [value, setValue] = useState('a');
    return h('div', null,
      h('form', { onChange: (e) => { seen.push('form:' + e.target.value); setValue(e.target.value); } }, h('input', { id: 'in-form', value, readOnly: false })),
      h('input', { id: 'stops', value: 'x', onChange: (e) => { e.stopPropagation(); } }));
  }
  const { container } = mount(h(App));
  const inForm = container.querySelector('#in-form');
  typed(inForm, 'ab');
  // React 19.3.0: the form's onChange is called with "ab" and the field shows "ab".
  assert.deepEqual(seen, ['form:ab']);
  assert.equal(inForm.value, 'ab');
  const stops = container.querySelector('#stops');
  typed(stops, 'xy');
  assert.equal(stops.value, 'x', 'restored where the handler stopped the event, with no listener further up');
});

test('a select shows its value: every option of an array for `multiple`, the first option when none matches', () => {
  let setValue;
  function App() {
    const [value, set] = useState(['b', 'c']);
    setValue = set;
    return h('div', null,
      h('select', { id: 'multi', multiple: true, value, onChange() {} }, options()),
      h('select', { id: 'nomatch', value: 'zz', onChange() {} }, options()));
  }
  const { container } = mount(h(App));
  const multi = container.querySelector('#multi');
  // React 19.3.0: multiSelected=[b,c], valueNoMatch=a.
  assert.equal(selectedOf(multi), 'b,c');
  assert.equal(selectedOf(container.querySelector('#nomatch')), 'a');
  // A change the handler does not take: the selection goes back.
  multi.options[0].selected = true;
  multi.options[1].selected = false;
  fire(multi, 'change');
  assert.equal(selectedOf(multi), 'b,c');
  act(() => setValue(['a']));
  assert.equal(selectedOf(multi), 'a');
});

test('an uncontrolled select starts as the browser shows one: its defaultValue, a selected option, or the first option', () => {
  let setLoaded;
  function Late() {
    const [loaded, set] = useState(false);
    setLoaded = set;
    return h('select', { id: 'late' }, loaded ? options() : null);
  }
  const { container } = mount(h('div', null,
    h('select', { id: 'plain' }, options()),
    h('select', { id: 'default', defaultValue: 'b' }, options()),
    h('select', { id: 'multi', multiple: true, defaultValue: ['a', 'c'] }, options()),
    h('select', { id: 'marked' }, h('option', { value: 'a' }, 'A'), h('option', { value: 'b', selected: true }, 'B'), h('option', { value: 'c' }, 'C')),
    h('select', { id: 'disabled' }, h('option', { value: 'a', disabled: true }, 'A'), h('option', { value: 'b' }, 'B')),
    h('select', { id: 'undef', value: undefined }, options()),
    h('select', { id: 'text', value: 'B', onChange() {} }, h('option', null, 'A'), h('option', { value: undefined }, 'B')),
    h(Late)));
  // React 19.3.0: plain=a default=b defaultMulti=a,c optSelected=b disabledFirst=b valueUndef=a optNoValueAttr=B.
  const read = (id) => selectedOf(container.querySelector('#' + id));
  assert.deepEqual(['plain', 'default', 'multi', 'marked', 'disabled', 'undef', 'text'].map(read), ['a', 'b', 'a,c', 'b', 'b', 'a', 'B']);
  // Options that arrive in a later render: the first one, as when a browser is given them in order.
  act(() => setLoaded(true));
  assert.equal(read('late'), 'a');
});

test('a refused click in a controlled radio group leaves the group as its props say', () => {
  const { container } = mount(h('form', null,
    h('input', { type: 'radio', name: 'r', value: 'x', checked: true, onChange() {} }),
    h('input', { type: 'radio', name: 'r', value: 'y', checked: false, onChange() {} })));
  const [x, y] = container.querySelectorAll('input');
  y.click();
  // React 19.3.0: radioAfterRefusedClick=[true,false]. (cbbfd764 left neither checked.)
  assert.deepEqual([x.checked, y.checked], [true, false]);
});

test('an uncontrolled radio group fires onChange each time the choice moves, and not for a click on the chosen one', () => {
  const log = [];
  const { container } = mount(h('div', null,
    h('input', { type: 'radio', name: 'g', value: 'x', defaultChecked: true, onChange: () => log.push('x') }),
    h('input', { type: 'radio', name: 'g', value: 'y', onChange: () => log.push('y') })));
  const [x, y] = container.querySelectorAll('input');
  y.click(); x.click(); x.click(); y.click();
  // React 19.3.0 and 18.3.1: y,x,y.
  assert.deepEqual(log, ['y', 'x', 'y']);
});

test('a field that stops being controlled keeps what it shows', () => {
  let setControlled;
  function App() {
    const [controlled, set] = useState(true);
    setControlled = set;
    return h('div', null,
      controlled ? h('input', { id: 't', value: 'fixed', onChange() {} }) : h('input', { id: 't', defaultValue: 'other' }),
      controlled ? h('input', { id: 'c', type: 'checkbox', checked: true, onChange() {} }) : h('input', { id: 'c', type: 'checkbox' }),
      h('input', { id: 'u', value: controlled ? 'was' : undefined, onChange() {} }));
  }
  const { container } = mount(h(App));
  act(() => setControlled(false));
  // React 19.3.0: afterSwitchToUncontrolled="fixed" (and a warning). cbbfd764 emptied the field.
  assert.equal(container.querySelector('#t').value, 'fixed');
  assert.equal(container.querySelector('#c').checked, true);
  assert.equal(container.querySelector('#u').value, 'was');
  // And it is the user's from here on: an edit stays.
  typed(container.querySelector('#u'), 'typed');
  assert.equal(container.querySelector('#u').value, 'typed');
});

test('a number field keeps "1.0" while its prop is 1; `value` on other elements is an attribute', async () => {
  function App() {
    const [n, setN] = useState(1);
    return h('div', null,
      h('input', { id: 'n', type: 'number', value: n, onChange: (e) => setN(parseFloat(e.target.value)) }),
      h('progress', { id: 'p', value: 0.5 }),
      h('li', { id: 'li', value: 3 }, 'x'),
      h('button', { id: 'b', value: undefined }, 'x'));
  }
  const { container } = mount(h(App));
  const number = container.querySelector('#n');
  // React's rule for number fields: the text stays while it stands for the prop.
  typed(number, '1.0');
  await settle();
  assert.equal(number.value, '1.0');
  typed(number, '2.50');
  await settle();
  assert.equal(number.value, '2.50');
  assert.equal(container.querySelector('#p').getAttribute('value'), '0.5');
  assert.equal(container.querySelector('#li').getAttribute('value'), '3');
  assert.equal(container.querySelector('#b').hasAttribute('value'), false);
});

// ---------------------------------------------------------------
// onChange and the synthetic event
// ---------------------------------------------------------------

test('onChange fires only when the field\'s value changed, on the field and above it', () => {
  const log = [];
  const { container } = mount(h('div', { onChange: (e) => log.push('div:' + e.target.id) },
    h('input', { id: 'text', defaultValue: 'a', onChange: () => log.push('text') }),
    h('input', { id: 'box', type: 'checkbox', onChange: () => log.push('box') }),
    h('select', { id: 'sel', defaultValue: 'a', onChange: (e) => log.push('sel:' + e.target.value) }, options()),
    h('p', { id: 'editable', contentEditable: true, suppressContentEditableWarning: true })));
  const text = container.querySelector('#text');
  // React 19.3.0: an `input` event that changed nothing fires no onChange.
  fire(text, 'input');
  assert.deepEqual(log, []);
  typed(text, 'ab');
  assert.deepEqual(log, ['text', 'div:text']);
  // The `change` a text field sends when it loses focus reports nothing new...
  fire(text, 'change');
  assert.deepEqual(log, ['text', 'div:text']);
  // ...and one that does carry a new value counts (testing-library's fireEvent.change).
  nativeValue(text, 'abc');
  fire(text, 'change');
  assert.deepEqual(log.splice(0), ['text', 'div:text', 'text', 'div:text']);
  // A checkbox: a `change` without a new state is none; a click is one.
  const box = container.querySelector('#box');
  fire(box, 'change');
  assert.deepEqual(log, []);
  box.click();
  assert.deepEqual(log.splice(0), ['box', 'div:box']);
  // A select: every `change`.
  const sel = container.querySelector('#sel');
  sel.options[1].selected = true;
  fire(sel, 'change');
  assert.deepEqual(log.splice(0), ['sel:b', 'div:sel']);
  // An `input` event from a contenteditable is not a change.
  fire(container.querySelector('#editable'), 'input');
  assert.deepEqual(log, []);
});

test('a value a script assigned counts as a change at the next event, also the value it had before', () => {
  // React counts the assignment as seen and fires nothing (tests use the
  // prototype's setter to get an onChange); here the next event is a change.
  const log = [];
  const { container } = mount(h('form', null, h('input', { defaultValue: '', onChange: (e) => log.push(e.target.value) })));
  const input = container.querySelector('input');
  typeInto(input, 'a');
  input.value = '';            // a script clears the field (after a send)
  typed(input, 'a');           // and the user types the same text again
  container.querySelector('form').reset();
  typed(input, 'a');           // the same after form.reset()
  assert.deepEqual(log, ['a', 'a', 'a']);
});

test('each React event type gets its own event object, and currentTarget is set only while a handler runs', async () => {
  let fromInput, fromChange, clicked;
  const during = [];
  const { container } = mount(h('div', { id: 'outer', onClick: (e) => during.push(e.currentTarget.id) },
    h('input', { defaultValue: '', onInput: (e) => { fromInput = e; }, onChange: (e) => { fromChange = e; } }),
    h('button', { id: 'btn', onClick: (e) => { clicked = e; during.push(e.currentTarget.id); } }, 'x')));
  typed(container.querySelector('input'), 'x');
  // React 19.3.0: sameObject=false inputEvent.typeNow=input changeEvent.type=change.
  assert.notEqual(fromInput, fromChange);
  assert.equal(fromInput.type, 'input');
  assert.equal(fromChange.type, 'change');
  assert.equal(fromInput.nativeEvent, fromChange.nativeEvent);
  fire(container.querySelector('#btn'), 'click');
  assert.deepEqual(during, ['btn', 'outer']);
  // React 19.3.0: stored.currentTarget=null stored.type=click.
  assert.equal(clicked.currentTarget, null);
  assert.equal(clicked.type, 'click');
  assert.equal(clicked.target.id, 'btn');
});

test('a form action runs when onSubmit stops propagation, and not when it prevents the default', async () => {
  const ran = [];
  const { container } = mount(h('div', null,
    h('form', { id: 'stop', action: () => { ran.push('stop'); }, onSubmit: (e) => e.stopPropagation() }),
    h('form', { id: 'prevent', action: () => { ran.push('prevent'); }, onSubmit: (e) => e.preventDefault() }),
    h('form', { id: 'plain', action: () => { ran.push('plain'); } }),
    h('div', { onSubmit: (e) => e.stopPropagation() }, h('form', { id: 'above', action: () => { ran.push('above'); } }))));
  for (const id of ['stop', 'prevent', 'plain', 'above']) fire(container.querySelector('#' + id), 'submit');
  await settle();
  // React 19.3.0: action:stop,action:plain,action:parentstop. (cbbfd764 ran only the plain one.)
  assert.deepEqual(ran, ['stop', 'plain', 'above']);
});

// ---------------------------------------------------------------
// The commit: cleanups before effects, insertion effects, unmount order
// ---------------------------------------------------------------

test('an update runs every layout cleanup, then every layout effect, then the passive ones the same way', () => {
  const log = [];
  let bump;
  function Child({ n }) {
    useLayoutEffect(() => { log.push('C layout ' + n); return () => log.push('C layout~ ' + n); }, [n]);
    useEffect(() => { log.push('C passive ' + n); return () => log.push('C passive~ ' + n); }, [n]);
    return h('span', null, n);
  }
  function Parent() {
    const [n, setN] = useState(0);
    bump = () => setN(1);
    useLayoutEffect(() => { log.push('P layout ' + n); return () => log.push('P layout~ ' + n); }, [n]);
    useEffect(() => { log.push('P passive ' + n); return () => log.push('P passive~ ' + n); }, [n]);
    return h(Child, { n });
  }
  mount(h(Parent));
  assert.equal(log.splice(0).join(' > '), 'C layout 0 > P layout 0 > C passive 0 > P passive 0');
  act(() => bump());
  // React 19.3.0 and 18.3.1.
  assert.equal(log.join(' > '), 'C layout~ 0 > P layout~ 0 > C layout 1 > P layout 1 > C passive~ 0 > P passive~ 0 > C passive 1 > P passive 1');
});

test('unmounting runs layout cleanups parents first with refs still set, then the passive cleanups', () => {
  const log = [];
  function Child() {
    const ref = useRef(null);
    useLayoutEffect(() => () => log.push('C layout~ ref=' + (ref.current ? 'set' : 'null')), []);
    useEffect(() => () => log.push('C passive~ ref=' + (ref.current ? 'set' : 'null')), []);
    return h('i', { ref }, 'c');
  }
  function Parent() {
    useLayoutEffect(() => () => log.push('P layout~'), []);
    useEffect(() => () => log.push('P passive~'), []);
    return h(Child);
  }
  const { root } = mount(h(Parent));
  root.unmount();
  // React 19.3.0 and 18.3.1: P layout~ > C layout~ ref=set > P passive~ > C passive~
  // (and the ref is null by the passive cleanup). All of it before unmount() returns.
  assert.equal(log.join(' > '), 'P layout~ > C layout~ ref=set > P passive~ > C passive~ ref=null');
});

test('a commit that removes one component and updates another: the removed one\'s passive cleanup waits for the passive phase', () => {
  const log = [];
  let bump;
  function Gone() {
    const ref = useRef(null);
    useLayoutEffect(() => () => log.push('G layout~ connected=' + ref.current.isConnected), []);
    useEffect(() => () => log.push('G passive~ ref=' + (ref.current ? 'set' : 'null')), []);
    return h('i', { ref }, 'g');
  }
  function Stay({ n }) {
    useLayoutEffect(() => { log.push('S layout ' + n); return () => log.push('S layout~ ' + n); }, [n]);
    useEffect(() => { log.push('S passive ' + n); return () => log.push('S passive~ ' + n); }, [n]);
    return h('b', null, n);
  }
  function App() {
    const [n, setN] = useState(0);
    bump = () => setN(1);
    return h('div', null, n === 0 ? h(Gone) : null, h(Stay, { n }));
  }
  mount(h(App));
  log.length = 0;
  act(() => bump());
  // React 19.3.0 and 18.3.1.
  assert.equal(log.join(' > '), 'G layout~ connected=true > S layout~ 0 > S layout 1 > G passive~ ref=null > S passive~ 0 > S passive 1');
});

test('insertion effects run in the commit, children first, before refs and layout effects; never for a render that threw', () => {
  const log = [];
  let fail = false, bump;
  function Child({ n }) {
    React.useInsertionEffect(() => { log.push('C insertion ' + n); return () => log.push('C insertion~ ' + n); }, [n]);
    useLayoutEffect(() => { log.push('C layout ' + n); }, [n]);
    return h('i', { ref: (el) => { if (el) log.push('ref'); } }, n);
  }
  function Parent() {
    const [n, setN] = useState(0);
    bump = () => setN((x) => x + 1);
    React.useInsertionEffect(() => { log.push('P insertion ' + n); }, [n]);
    useLayoutEffect(() => { log.push('P layout ' + n); }, [n]);
    if (fail) throw new Error('discarded');
    return h(Child, { n });
  }
  const { root } = mount(h(Boundary, null, h(Parent)));
  // React 19.3.0 and 18.3.1: C insertion > P insertion > (ref) > C layout > P layout. cbbfd764 ran them while rendering, parent first.
  assert.equal(log.splice(0).join(' > '), 'C insertion 0 > P insertion 0 > ref > C layout 0 > P layout 0');
  act(() => bump());
  assert.equal(log.splice(0, 2).join(' > '), 'ref > C insertion~ 0');
  log.length = 0;
  fail = true;
  act(() => bump());
  assert.deepEqual(log.filter((l) => l.startsWith('P insertion')), [], 'the render that threw ran no insertion effect');
  root.unmount();
});

test('an effect whose deps changed in a render that suspended runs when the content is back', async () => {
  const log = [];
  let resolve, suspend = false, setId;
  const promise = new Promise((r) => { resolve = r; });
  function Kid({ id }) {
    useEffect(() => { log.push('effect ' + id); }, [id]);
    if (suspend) throw promise;
    return h('i', null, id);
  }
  function App() {
    const [id, set] = useState(1);
    setId = set;
    return h(Suspense, { fallback: 'wait' }, h(Kid, { id }));
  }
  const { container } = mount(h(App));
  suspend = true;
  act(() => setId(2));
  suspend = false;
  resolve();
  await settle();
  // React 19.3.0: log=[effect 1,effect 2]. (cbbfd764 never ran the second.)
  assert.deepEqual(log, ['effect 1', 'effect 2']);
  assert.equal(container.textContent, '2');
});

// ---------------------------------------------------------------
// Elements, Children and the shapes libraries check
// ---------------------------------------------------------------

test('a host element keeps className and htmlFor in its props (a Radix Slot merges the child\'s classes)', () => {
  // Slot's merge: the slot's props, the child's on top, and the class names joined.
  function Slot({ children, ...slotProps }) {
    const child = Children.only(children);
    return React.cloneElement(child, { ...slotProps, ...child.props, className: [slotProps.className, child.props.className].filter(Boolean).join(' ') });
  }
  const child = h('label', { className: 'child-cls', htmlFor: 'field' }, 'x');
  // React 19.3.0: child.props.className="child-cls" props.class=undefined props.htmlFor="field".
  assert.equal(child.props.className, 'child-cls');
  assert.equal(child.props.class, undefined);
  assert.equal(child.props.htmlFor, 'field');
  const { container } = mount(h('div', null,
    h(Slot, { className: 'slot-cls' }, child),
    h(Slot, { className: 'slot-cls' }, h('a', { class: 'what-cls' }, 'y'))));
  // React 19.3.0: mergedDomClass="slot-cls child-cls". (cbbfd764: "slot-cls".)
  assert.equal(container.querySelector('label').className, 'slot-cls child-cls');
  assert.equal(container.querySelector('label').getAttribute('for'), 'field');
  // A child written with `class` and given a className: React's name wins.
  assert.equal(container.querySelector('a').className, 'slot-cls');
});

test('defaultProps of a function component, a forwardRef and a memo stand in for undefined props', () => {
  function Size(props) { return h('i', null, props.size + ':' + props.label); }
  Size.defaultProps = { size: 'md', label: 'L' };
  const Fwd = React.forwardRef((props, ref) => h('b', { ref }, props.v));
  Fwd.defaultProps = { v: 'fwd' };
  const Inner = (props) => h('u', null, props.v);
  Inner.defaultProps = { v: 'inner' };
  const Memo = React.memo(Inner);
  const given = { label: undefined };
  const element = h(Size, given);
  // React 19.3.0: elementPropsBeforeMount="dflt" (the element's props carry the defaults); the caller's object is untouched.
  assert.deepEqual({ ...element.props }, { size: 'md', label: 'L' });
  assert.deepEqual(given, { label: undefined });
  const { container } = mount(h('div', null, element, h(Size, { size: 'xl', label: null }), h(Fwd), h(Memo)));
  // React 18.3.1: memo(inner defaults)=v=inner forwardRef.defaultProps=v=fwd. (React 19 dropped the memo's inner defaults.)
  assert.equal(container.textContent, 'md:L' + 'xl:null' + 'fwd' + 'inner');
});

test('Children.toArray and map give React\'s keys: escaped, and by path through nested arrays', () => {
  const kids = [h('i', { key: 'a=b:c' }), [h('i'), h('i', { key: 'x' })], 'text'];
  const keys = Children.toArray(kids).map((c) => (typeof c === 'string' ? c : c.key));
  // React 19.3.0: toArrayKeys=[.$a=0b=2c | .1:0 | .1:$x | text].
  assert.deepEqual(keys, ['.$a=0b=2c', '.1:0', '.1:$x', 'text']);
  // React 19.3.0: mapKey=[new/.$orig].
  assert.equal(Children.map([h('i', { key: 'orig' })], (c) => React.cloneElement(c, { key: 'new' }))[0].key, 'new/.$orig');
  assert.deepEqual(Children.map([h('i', { key: 'k' })], (c) => [c, h('b', { key: 'extra/x' })]).map((c) => c.key), ['.$k/.$k', '.$k/.$extra/x']);
  assert.equal(Children.count(new Set(['a', null, [h('i')]])), 3, 'an iterable is a list');
  assert.deepEqual(Children.map(['a'], () => true), [true], 'only null and undefined results are dropped');
});

test('children with the same key in different lists keep their own state through toArray', () => {
  const set = {};
  function Row({ label }) {
    const [n, s] = useState(0);
    set[label] = () => s(1);
    return h('span', null, label + n);
  }
  function App() {
    const [, force] = useState(0);
    set.force = () => force((x) => x + 1);
    return h('div', null, Children.toArray([h(Row, { key: 'x', label: 'A' }), [h(Row, { key: 'x', label: 'B' })]]));
  }
  const { container } = mount(h(App));
  act(() => { set.A(); set.B(); });
  act(() => set.force());
  // React 19.3.0: afterRerender=A1B1. (cbbfd764: A1B0, the second child was remounted.)
  assert.equal(container.textContent, 'A1B1');
});

test('the types react-is 18 reads: Provider, Consumer, Fragment, and a forwardRef\'s render', () => {
  const Ctx = createContext(1);
  // react-is 18.3.1 isContextProvider / isContextConsumer / isFragment compare element.type.$$typeof (or the type) with these.
  assert.equal(h(Ctx.Provider, { value: 1 }).type.$$typeof, Symbol.for('react.provider'));
  assert.equal(h(Ctx.Consumer, null, () => null).type.$$typeof, Symbol.for('react.context'));
  assert.equal(Ctx._currentValue, 1);
  assert.equal(React.Fragment, Symbol.for('react.fragment'));
  assert.equal(h(React.Fragment, null).type, Symbol.for('react.fragment'));
  const render = (props, ref) => h('i', { ref }, 'x');
  const Fwd = React.forwardRef(render);
  assert.equal(Fwd.render, render);
  assert.equal(Fwd.$$typeof, Symbol.for('react.forward_ref'));
  // They still render: a keyed fragment keeps its children's state, a consumer reads its provider.
  const { container } = mount(h(Ctx.Provider, { value: 7 }, h(React.Fragment, { key: 'k' }, h(Ctx.Consumer, null, (v) => h('b', null, v)), h(Fwd))));
  assert.equal(container.textContent, '7x');
});

// ---------------------------------------------------------------
// Smaller differences
// ---------------------------------------------------------------

test('componentDidCatch gets a component stack: the components from the one that threw to the root', () => {
  let info = null;
  function Bad() { throw new Error('bad render'); }
  function Wrapper() { return h('section', null, h(React.Fragment, null, h(Bad))); }
  const { container } = mount(h(Boundary, { onCatch: (error, i) => { info = i; } }, h(Wrapper)));
  assert.equal(container.textContent, 'caught bad render');
  // React 19.3.0 (development): "\n    at Bad (file:line)\n    at section\n    at Wrapper...". Here: names only, no host elements.
  assert.equal(info.componentStack, '\n    at Bad\n    at Wrapper\n    at Boundary');
});

test('useDeferredValue(value, initialValue) renders the initial value first, then the value', () => {
  const renders = [];
  function App() {
    const deferred = React.useDeferredValue('real', 'initial');
    renders.push(deferred);
    return h('i', null, deferred);
  }
  const { container } = mount(h(App));
  // React 19.3.0: renders=[initial,real] dom=real.
  assert.deepEqual(renders, ['initial', 'real']);
  assert.equal(container.textContent, 'real');
  assert.equal(React.useDeferredValue.length, 2);
});

test('getSnapshotBeforeUpdate is called after render() and before the component\'s DOM changes', () => {
  const log = [];
  let instance;
  class Scroller extends Component {
    constructor(props) { super(props); this.state = { n: 0 }; instance = this; }
    getSnapshotBeforeUpdate() { log.push('snapshot dom=' + this.el.textContent + ' rendered=' + this.rendered); return 'snap'; }
    componentDidUpdate(prevProps, prevState, snapshot) { log.push('didUpdate dom=' + this.el.textContent + ' ' + snapshot); }
    render() { this.rendered = this.state.n; log.push('render ' + this.state.n); return h('div', { ref: (el) => { if (el) this.el = el; } }, 'n=' + this.state.n); }
  }
  mount(h(Scroller));
  log.length = 0;
  act(() => instance.setState({ n: 1 }));
  // React 19.3.0: render 1 > gSBU dom=n=0 rendered=1 > cDU dom=n=1. (cbbfd764 took the snapshot before render().)
  assert.deepEqual(log, ['render 1', 'snapshot dom=n=0 rendered=1', 'didUpdate dom=n=1 snap']);
});
