// React itself, as libraries use it: the semantics compat runtimes get wrong.
import {
  Children, Component, Profiler, PureComponent, StrictMode, Suspense, cloneElement, createContext, forwardRef, isValidElement,
  lazy, memo, startTransition, use, useActionState, useCallback, useContext, useDeferredValue, useEffect, useEffectEvent, useId,
  useImperativeHandle, useLayoutEffect, useOptimistic, useRef, useState, useSyncExternalStore, useTransition,
} from 'react';
import { createPortal, flushSync, useFormStatus } from 'react-dom';

const log = [];
const note = (entry) => { log.push(entry); };
window.coreLog = log;
const Out = ({ id, children }) => <output id={id} style={{ display: 'block' }}>{children}</output>;

// ---- events through a portal ----
function PortalEvents() {
  const [bubbled, setBubbled] = useState(0);
  const [captured, setCaptured] = useState(0);
  const [stopped, setStopped] = useState(0);
  return (
    <div id="c-portal-parent" onClick={() => setBubbled((n) => n + 1)} onClickCapture={() => setCaptured((n) => n + 1)}>
      {createPortal(
        <div id="c-portal-inner">
          <button id="c-portal-btn">in portal</button>
          <button id="c-portal-stop" onClick={(e) => { e.stopPropagation(); setStopped((n) => n + 1); }}>stops</button>
        </div>,
        document.body,
      )}
      <Out id="c-portal">{bubbled}/{captured}/{stopped}</Out>
    </div>
  );
}

// ---- refs ----
function RefProp({ ref, label }) {
  return <input ref={ref} aria-label={label} defaultValue="plain" />;
}
const Handle = forwardRef(function Handle(_props, ref) {
  const [n, setN] = useState(0);
  useImperativeHandle(ref, () => ({ bump: () => setN((x) => x + 1), read: () => n }), [n]);
  return <span id="c-handle-n">{n}</span>;
});
function Refs() {
  const [show, setShow] = useState(true);
  const [seen, setSeen] = useState('');
  const propRef = useRef(null);
  const handle = useRef(null);
  const cleanupRef = useCallback((el) => {
    note('attach:' + (el ? el.tagName : 'null'));
    return () => note('cleanup');
  }, []);
  return (
    <div>
      {show && <b ref={cleanupRef}>ref</b>}
      <RefProp ref={propRef} label="ref-prop" />
      <Handle ref={handle} />
      <button id="c-ref-go" onClick={() => { handle.current.bump(); setShow(false); setSeen(propRef.current.value + ':' + typeof handle.current.read); }}>go</button>
      <Out id="c-ref">{seen}</Out>
    </div>
  );
}

// ---- context ----
const Theme = createContext('light');
const Level = createContext(0);
function ThemeLabel() { return <span className="c-theme">{use(Theme)}:{useContext(Level)}</span>; }
const Frozen = memo(function Frozen() { return <ThemeLabel />; });
function Contexts() {
  const [theme, setTheme] = useState('dark');
  return (
    <div>
      <Theme value={theme}>
        <Level.Provider value={1}>
          <Frozen />
          <Level value={2}><ThemeLabel /></Level>
          <Theme.Consumer>{(value) => <span className="c-theme">{value}!</span>}</Theme.Consumer>
        </Level.Provider>
      </Theme>
      <ThemeLabel />
      <button id="c-ctx-go" onClick={() => setTheme('blue')}>theme</button>
    </div>
  );
}

// ---- Suspense: use(promise), lazy ----
let resolveData;
const dataPromise = new Promise((resolve) => { resolveData = resolve; });
function Data() { return <span id="c-data">{use(dataPromise)}</span>; }
const LazyBox = lazy(() => new Promise((resolve) => setTimeout(() => resolve({ default: () => <span id="c-lazy">lazy loaded</span> }), 30)));
function Suspending() {
  const [n, setN] = useState(0);
  return (
    <div>
      <button id="c-sibling" onClick={() => setN(n + 1)}>sibling {n}</button>
      <Suspense fallback={<span id="c-fallback">waiting</span>}><Data /></Suspense>
      <Suspense fallback={<span id="c-lazy-fallback">loading</span>}><LazyBox /></Suspense>
      <button id="c-resolve" onClick={() => resolveData('resolved')}>resolve</button>
    </div>
  );
}

// ---- actions: useTransition, useOptimistic, useActionState, forms ----
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function Submit() {
  const { pending } = useFormStatus();
  return <button id="c-form-submit" type="submit">{pending ? 'sending' : 'send'}</button>;
}
function Actions() {
  const [likes, setLikes] = useState(1);
  const [optimistic, addOptimistic] = useOptimistic(likes, (current, add) => current + add);
  const [isPending, start] = useTransition();
  const [seen, setSeen] = useState('');
  const [result, formAction, formPending] = useActionState(async (previous, formData) => {
    await wait(120);
    return { count: previous.count + 1, name: formData.get('name') };
  }, { count: 0, name: '' });
  useEffect(() => { setSeen((s) => (s.endsWith(`${optimistic}${isPending ? 'p' : ''}`) ? s : `${s} ${optimistic}${isPending ? 'p' : ''}`)); }, [optimistic, isPending]);
  return (
    <div>
      <button id="c-like" onClick={() => start(async () => { addOptimistic(1); await wait(120); startTransition(() => setLikes((n) => n + 1)); })}>like {optimistic}{isPending ? ' (saving)' : ''}</button>
      <Out id="c-like-seen">{seen.trim()}</Out>
      <form action={formAction} id="c-form">
        <input id="c-form-name" name="name" defaultValue="" />
        <Submit />
      </form>
      <Out id="c-form-out">{result.count}:{result.name}:{String(formPending)}</Out>
    </div>
  );
}

// ---- class components ----
const Ambient = createContext('ctx');
class Counter extends Component {
  static contextType = Ambient;
  constructor(props, context) {
    super(props, context);
    this.state = { n: 0, fromContext: context };
    this.renders = 0;
  }
  shouldComponentUpdate(nextProps, nextState) { return nextState.n !== this.state.n || nextProps.label !== this.props.label; }
  componentDidUpdate(prevProps, prevState) { note(`didUpdate ${prevState.n}->${this.state.n} ${prevProps.label}`); }
  bump() { this.setState((s) => ({ n: s.n + 1 }), () => note('setState callback sees ' + document.querySelector('#c-class-n').textContent)); }
  render() {
    this.renders++;
    return <span id="c-class-n">{this.state.n}:{this.state.fromContext}:{this.context}:{this.renders}:{this.props.label}</span>;
  }
}
class Pure extends PureComponent {
  renders = 0;
  render() { this.renders++; return <span id="c-pure">{this.props.value}:{this.renders}</span>; }
}
function Classes() {
  const ref = useRef(null);
  const [tick, setTick] = useState(0);
  return (
    <Ambient value="given">
      <Counter ref={ref} label="L" />
      <Pure value="same" />
      <button id="c-class-bump" onClick={() => ref.current.bump()}>bump</button>
      <button id="c-class-tick" onClick={() => setTick(tick + 1)}>parent {tick}</button>
    </Ambient>
  );
}

// ---- reconciliation: slots and keys ----
function Reconcile() {
  const [hint, setHint] = useState(true);
  const [rows, setRows] = useState(['a', 'b', 'c']);
  return (
    <div>
      <div id="c-slot">
        {hint ? <em key="hint">hint</em> : null}
        <input id="c-slot-input" defaultValue="" />
      </div>
      <div id="c-list">
        {rows.map((row) => <input key={row} className="c-row" defaultValue={row} />)}
        <input id="c-after-list" defaultValue="" />
      </div>
      <button id="c-hint" onClick={() => setHint(!hint)}>hint</button>
      <button id="c-rows" onClick={() => setRows(['d', 'c', 'a', 'b'])}>rows</button>
    </div>
  );
}

// ---- DOM props and events ----
function Dom() {
  const [text, setText] = useState('ab');
  const [checked, setChecked] = useState(false);
  const [events, setEvents] = useState([]);
  const push = (entry) => setEvents((list) => [...list, entry]);
  const id = useId();
  return (
    <div onFocus={(e) => push('focus:' + e.type + ':' + e.target.id)} onBlur={(e) => push('blur:' + e.type)}>
      <label htmlFor={id} id="c-label">label</label>
      <input id={id} data-testid="c-id-input" />
      <input id="c-digits" value={text} onChange={(e) => { if (/^[a-z]*$/.test(e.target.value)) setText(e.target.value); }} />
      <input id="c-locked" type="checkbox" checked={checked} onChange={() => {}} />
      <button id="c-unlock" onClick={() => setChecked(true)}>check</button>
      <div
        id="c-styled" className="one two" style={{ width: 120, opacity: 0.5, '--gap': '4px', lineHeight: 2, marginTop: 3 }}
        data-flag={false} aria-hidden={false} aria-busy tabIndex={-1} hidden={false} draggable
        dangerouslySetInnerHTML={{ __html: '<i>raw</i>' }}
      />
      <svg id="c-svg" viewBox="0 0 10 10" width="20"><circle cx="5" cy="5" r="4" strokeWidth={2} fillOpacity={0.5} className="dot" /></svg>
      <button id="c-dbl" onDoubleClick={() => push('dbl')} onKeyDown={(e) => push('key:' + e.key + ':' + e.nativeEvent.constructor.name)}>dbl</button>
      <Out id="c-events">{events.join(' ')}</Out>
      <Out id="c-text">{text}</Out>
    </div>
  );
}

// ---- hooks ----
const store = { value: 1, listeners: new Set() };
window.coreStore = { set(v) { store.value = v; store.listeners.forEach((l) => l()); } };
const subscribe = (listener) => { store.listeners.add(listener); return () => store.listeners.delete(listener); };
function Order({ name, children }) {
  useLayoutEffect(() => { note('layout ' + name); return () => note('layout cleanup ' + name); });
  useEffect(() => { note('effect ' + name); return () => note('effect cleanup ' + name); });
  return children ?? null;
}
function Hooks() {
  const value = useSyncExternalStore(subscribe, () => store.value);
  const [query, setQuery] = useState('a');
  const deferred = useDeferredValue(query);
  const [shown, setShown] = useState(true);
  const [sync, setSync] = useState('');
  const [count, setCount] = useState(0);
  const onTick = useEffectEvent(() => note('event sees ' + count));
  useEffect(() => { onTick(); }, [query]);
  const extra = Children.toArray([<i key="x">x</i>, null, 'text', [<b key="y">y</b>]]);
  const cloned = cloneElement(<a href="#old" className="old">link</a>, { className: 'new', id: 'c-cloned' });
  return (
    <div>
      <Out id="c-store">{value}</Out>
      <Out id="c-deferred">{query}/{deferred}</Out>
      <button id="c-query" onClick={() => { setCount(5); startTransition(() => setQuery(query + 'b')); }}>query</button>
      {shown && <Order name="parent"><Order name="child" /></Order>}
      <button id="c-unmount" onClick={() => setShown(false)}>unmount</button>
      <button id="c-sync" onClick={() => { flushSync(() => setCount((c) => c + 1)); setSync(document.querySelector('#c-count').textContent); }}>sync</button>
      <Out id="c-count">{count}</Out>
      <Out id="c-sync-out">{sync}</Out>
      <Out id="c-children">{extra.length}:{Children.count([1, null, [2, 3]])}:{String(isValidElement(cloned))}</Out>
      {cloned}
      <Profiler id="p" onRender={() => {}}><StrictMode><span id="c-wrapped">wrapped</span></StrictMode></Profiler>
    </div>
  );
}

// ---- error boundaries ----
class Boundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() { return this.state.error ? <span id={this.props.id}>caught {this.state.error.message}</span> : this.props.children; }
}
function Thrower({ when }) { if (when) throw new Error('render'); return <span>fine</span>; }
function EffectThrower({ when }) { useEffect(() => { if (when) throw new Error('effect'); }, [when]); return <span>fine</span>; }
function Errors() {
  const [a, setA] = useState(false);
  const [b, setB] = useState(false);
  return (
    <div>
      <Boundary id="c-err-render"><Thrower when={a} /></Boundary>
      <Boundary id="c-err-effect"><EffectThrower when={b} /></Boundary>
      <button id="c-throw-render" onClick={() => setA(true)}>throw in render</button>
      <button id="c-throw-effect" onClick={() => setB(true)}>throw in effect</button>
    </div>
  );
}

// ---- concurrent behaviour (kept apart: what-react renders synchronously) ----
let resolveLate;
function Stateful({ suspend }) {
  const [n, setN] = useState(0);
  if (suspend) use(suspend);
  return <button id="c-keep" onClick={() => setN(n + 1)}>kept {n}</button>;
}
function Concurrent() {
  const [promise, setPromise] = useState(null);
  return (
    <div>
      <Suspense fallback={<span id="c-keep-fallback">suspended</span>}><Stateful suspend={promise} /></Suspense>
      <button id="c-suspend" onClick={() => setPromise(new Promise((resolve) => { resolveLate = resolve; }))}>suspend</button>
      <button id="c-resume" onClick={() => resolveLate('done')}>resume</button>
    </div>
  );
}

export default function Fixture() {
  return (
    <div>
      <PortalEvents />
      <Refs />
      <Contexts />
      <Suspending />
      <Actions />
      <Classes />
      <Reconcile />
      <Dom />
      <Hooks />
      <Errors />
      <Concurrent />
    </div>
  );
}
