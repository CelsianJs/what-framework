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
  await tick(60);
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
