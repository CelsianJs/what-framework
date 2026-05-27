import { mount, signal, effect, computed, onMount, onCleanup, useRef, batch, ErrorBoundary, createResource, mapArray, untrack } from 'what-framework';
// devtools bootstrap is now injected by the what-devtools-mcp Vite plugin
// (see vite.config.js). No manual install needed.
import {
  todos, filter, newText, filteredTodos, counts,
  addTodo, toggleTodo, removeTodo, clearDone,
} from './store.js';

// --- Test 1: Basic counter with signal + computed ---
function Counter() {
  const count = signal(0, 'counter');
  const doubled = () => count() * 2;
  const parity = () => count() % 2 === 0 ? 'even' : 'odd';

  return (
    <div class="section">
      <h2>Test 1: Counter</h2>
      <div class="flex">
        <button onClick={() => count(c => c - 1)}>-</button>
        <span style="font-size:24px;font-weight:700;min-width:60px;text-align:center">
          {() => count()}
        </span>
        <button onClick={() => count(c => c + 1)}>+</button>
      </div>
      <p class="text-muted mt">
        Doubled: {() => doubled()} | Parity: {() => parity()}
      </p>
    </div>
  );
}

// --- Test 2: Two-way input binding ---
function InputTest() {
  const name = signal('', 'name');
  const upper = () => name().toUpperCase();

  return (
    <div class="section">
      <h2>Test 2: Two-Way Input</h2>
      <div class="flex">
        <input
          type="text"
          placeholder="Type your name..."
          value={name}
          onInput={(e) => name(e.target.value)}
          style="flex:1"
        />
      </div>
      <p class="text-muted mt">
        Hello, {() => name() || 'stranger'}! (UPPER: {() => upper()})
      </p>
    </div>
  );
}

// --- Test 3: Conditional rendering ---
function ConditionalTest() {
  const show = signal(true, 'show');
  const mode = signal('a', 'mode');

  return (
    <div class="section">
      <h2>Test 3: Conditional Rendering</h2>
      <div class="flex">
        <button onClick={() => show(s => !s)}>
          {() => show() ? 'Hide' : 'Show'}
        </button>
        <button onClick={() => mode(m => m === 'a' ? 'b' : m === 'b' ? 'c' : 'a')}>
          Mode: {() => mode()}
        </button>
      </div>
      <div class="mt">
        {() => show() ? <p>I am visible!</p> : <p style="opacity:0.3">Hidden content</p>}
      </div>
      <div class="mt">
        {() => {
          const m = mode();
          if (m === 'a') return <span class="tag" style="background:#6366f1">Mode A</span>;
          if (m === 'b') return <span class="tag" style="background:#f59e0b">Mode B</span>;
          return <span class="tag" style="background:#22c55e">Mode C</span>;
        }}
      </div>
    </div>
  );
}

// --- Test 4: Todo list with module-scope signals ---
function TodoItem({ todo }) {
  return (
    <div class="flex" style="padding:8px 0;border-bottom:1px solid var(--border)">
      <input
        type="checkbox"
        checked={todo.done}
        onChange={() => toggleTodo(todo.id)}
      />
      <span style={`flex:1;${todo.done ? 'text-decoration:line-through;opacity:0.5' : ''}`}>
        {todo.text}
      </span>
      <button
        onClick={() => removeTodo(todo.id)}
        style="background:var(--danger);padding:4px 10px;font-size:12px"
      >x</button>
    </div>
  );
}

function TodoApp() {
  return (
    <div class="section">
      <h2>Test 4: Todo List (module-scope signals)</h2>
      <div class="flex">
        <input
          type="text"
          placeholder="New todo..."
          value={newText}
          onInput={(e) => newText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTodo(); }}
          style="flex:1"
        />
        <button onClick={addTodo}>Add</button>
      </div>
      <div class="flex mt">
        <button onClick={() => filter('all')} style={() => `padding:4px 12px;font-size:12px;background:${filter() === 'all' ? 'var(--accent)' : 'transparent'};border:1px solid var(--border)`}>
          All ({() => counts().total})
        </button>
        <button onClick={() => filter('active')} style={() => `padding:4px 12px;font-size:12px;background:${filter() === 'active' ? 'var(--accent)' : 'transparent'};border:1px solid var(--border)`}>
          Active ({() => counts().active})
        </button>
        <button onClick={() => filter('done')} style={() => `padding:4px 12px;font-size:12px;background:${filter() === 'done' ? 'var(--accent)' : 'transparent'};border:1px solid var(--border)`}>
          Done ({() => counts().done})
        </button>
        <button onClick={clearDone} style="background:var(--danger);font-size:12px;padding:4px 12px">
          Clear Done
        </button>
      </div>
      <div class="mt">
        {() => {
          const items = filteredTodos();
          if (items.length === 0) {
            return <p class="text-muted" style="padding:16px 0;text-align:center">No todos</p>;
          }
          return items.map(todo => <TodoItem key={todo.id} todo={todo} />);
        }}
      </div>
    </div>
  );
}

// --- Test 5: useRef + onMount ---
function RefTest() {
  const inputRef = useRef(null);
  const measured = signal('', 'measured');

  onMount(() => {
    if (inputRef.current) {
      measured(`Input width: ${inputRef.current.offsetWidth}px`);
    }
  });

  return (
    <div class="section">
      <h2>Test 5: Refs + onMount</h2>
      <input ref={inputRef} type="text" placeholder="Measure me" style="width:100%" />
      <p class="text-muted mt">{() => measured()}</p>
    </div>
  );
}

// --- Test 6: Dynamic styles + class toggling ---
function StyleTest() {
  const hue = signal(230, 'hue');
  const active = signal(false, 'active');

  return (
    <div class="section">
      <h2>Test 6: Dynamic Styles</h2>
      <div class="flex">
        <input
          type="range"
          min="0"
          max="360"
          value={hue}
          onInput={(e) => hue(Number(e.target.value))}
        />
        <button onClick={() => active(a => !a)}>
          {() => active() ? 'Deactivate' : 'Activate'}
        </button>
      </div>
      <div
        class="mt"
        style={() => `padding:20px;border-radius:8px;background:hsl(${hue()}, 60%, 30%);border:2px solid ${active() ? 'var(--success)' : 'transparent'};transition:all 0.3s`}
      >
        <p>Hue: {() => hue()}</p>
        <p>Active: {() => String(active())}</p>
      </div>
    </div>
  );
}

// --- Test 7: Effect with cleanup ---
function TimerTest() {
  const seconds = signal(0, 'timer');
  const running = signal(false, 'running');

  effect(() => {
    if (!running()) return;
    const id = setInterval(() => seconds(s => s + 1), 1000);
    return () => clearInterval(id);
  });

  return (
    <div class="section">
      <h2>Test 7: Effect + Cleanup (Timer)</h2>
      <div class="flex">
        <span style="font-size:32px;font-weight:700;font-variant-numeric:tabular-nums;min-width:80px">
          {() => seconds()}s
        </span>
        <button onClick={() => running(r => !r)}>
          {() => running() ? 'Pause' : 'Start'}
        </button>
        <button onClick={() => { running(false); seconds(0); }} style="background:var(--danger)">
          Reset
        </button>
      </div>
    </div>
  );
}

// --- Test 8: Component props + children ---
function Card({ title, children }) {
  return (
    <div class="section">
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}

function Badge({ label, color }) {
  return (
    <span class="tag" style={`background:${color};margin:0 4px`}>{label}</span>
  );
}

function PropsTest() {
  const color = signal('#6366f1', 'badgeColor');
  const label = signal('Hello', 'badgeLabel');

  return (
    <Card title="Test 8: Props + Children">
      <div class="flex">
        <input
          type="text"
          value={label}
          onInput={(e) => label(e.target.value)}
          placeholder="Badge text"
          style="flex:1"
        />
        <input
          type="color"
          value={color}
          onInput={(e) => color(e.target.value)}
        />
      </div>
      <div class="mt">
        <Badge label={() => label()} color={() => color()} />
        <Badge label="Static" color="#22c55e" />
      </div>
    </Card>
  );
}

// --- Test 9: Nested list with add/remove from middle ---
function ListTest() {
  const items = signal([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
    { id: 3, name: 'Gamma' },
  ], 'items');
  let nextId = 4;

  const addAtStart = () => items(prev => [{ id: nextId++, name: `Item ${nextId - 1}` }, ...prev]);
  const addAtEnd = () => items(prev => [...prev, { id: nextId++, name: `Item ${nextId - 1}` }]);
  const removeFirst = () => items(prev => prev.slice(1));
  const removeLast = () => items(prev => prev.slice(0, -1));
  const reverse = () => items(prev => [...prev].reverse());

  return (
    <div class="section">
      <h2>Test 9: List Mutations</h2>
      <div class="flex">
        <button onClick={addAtStart}>+ Start</button>
        <button onClick={addAtEnd}>+ End</button>
        <button onClick={removeFirst} style="background:var(--danger)">- First</button>
        <button onClick={removeLast} style="background:var(--danger)">- Last</button>
      </div>
      <div class="flex mt">
        <button onClick={reverse}>Reverse</button>
        <span class="text-muted">Count: {() => items().length}</span>
      </div>
      <div class="mt">
        {() => items().map(item => (
          <div class="flex" style="padding:4px 0;border-bottom:1px solid var(--border)">
            <span style="font-variant-numeric:tabular-nums;min-width:30px;color:var(--muted)">#{item.id}</span>
            <span style="flex:1">{item.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Test 10: Deeply nested reactivity ---
function NestedReactivity() {
  const user = signal({ name: 'Alice', age: 30 }, 'user');

  return (
    <div class="section">
      <h2>Test 10: Object Signal</h2>
      <div class="flex">
        <input
          type="text"
          value={() => user().name}
          onInput={(e) => user(u => ({ ...u, name: e.target.value }))}
          placeholder="Name"
          style="flex:1"
        />
        <button onClick={() => user(u => ({ ...u, age: u.age + 1 }))}>
          Age: {() => user().age}
        </button>
      </div>
      <p class="text-muted mt">
        {() => `${user().name} is ${user().age} years old`}
      </p>
    </div>
  );
}

// --- Test 11: Spread props ---
// NOTE: Destructured props lose Proxy reactivity. Use `props.x` for reactive values.
function StyledBox(props) {
  const { children, style, ...rest } = props;
  return (
    <div style={() => `padding:12px;border-radius:8px;${typeof style === 'function' ? style() : style || ''}`} {...rest}>
      {children}
    </div>
  );
}

function SpreadTest() {
  const color = signal('#6366f1', 'spreadColor');

  return (
    <div class="section">
      <h2>Test 11: Spread Props</h2>
      <div class="flex">
        <input
          type="color"
          value={color}
          onInput={(e) => color(e.target.value)}
        />
      </div>
      <div class="mt">
        <StyledBox
          style={() => `background:${color()}`}
          data-testid="spread-box"
          class="text-muted"
        >
          Spread props box (color: {() => color()})
        </StyledBox>
      </div>
    </div>
  );
}

// --- Test 12: SVG rendering ---
function SvgTest() {
  const radius = signal(40, 'svgRadius');
  const hue = signal(200, 'svgHue');

  return (
    <div class="section">
      <h2>Test 12: SVG</h2>
      <div class="flex">
        <input
          type="range" min="10" max="60"
          value={radius}
          onInput={(e) => radius(Number(e.target.value))}
        />
        <input
          type="range" min="0" max="360"
          value={hue}
          onInput={(e) => hue(Number(e.target.value))}
        />
      </div>
      <svg width="140" height="140" viewBox="0 0 140 140" style="display:block;margin:8px auto">
        <circle
          cx="70" cy="70"
          r={() => radius()}
          fill={() => `hsl(${hue()}, 70%, 50%)`}
          stroke="white" stroke-width="2"
        />
        <text x="70" y="75" text-anchor="middle" fill="white" font-size="14">
          {() => `r=${radius()}`}
        </text>
      </svg>
    </div>
  );
}

// --- Test 13: Boolean / disabled attributes ---
function BooleanAttrTest() {
  const disabled = signal(false, 'disabled');
  const checked = signal(true, 'checked');

  return (
    <div class="section">
      <h2>Test 13: Boolean Attrs</h2>
      <div class="flex">
        <button onClick={() => disabled(d => !d)}>
          Toggle disabled: {() => String(disabled())}
        </button>
        <button onClick={() => checked(c => !c)}>
          Toggle checked: {() => String(checked())}
        </button>
      </div>
      <div class="flex mt">
        <input
          type="text"
          placeholder="I can be disabled"
          disabled={() => disabled()}
          style="flex:1"
        />
        <input
          type="checkbox"
          checked={() => checked()}
          onChange={() => checked(c => !c)}
        />
      </div>
    </div>
  );
}

// --- Test 14: Component returning fragment (multiple roots) ---
function MultiRoot() {
  return [
    <span class="tag" style="background:#6366f1">Root A</span>,
    <span class="tag" style="background:#f59e0b;margin-left:4px">Root B</span>,
    <span class="tag" style="background:#22c55e;margin-left:4px">Root C</span>,
  ];
}

function FragmentTest() {
  const show = signal(true, 'fragShow');

  return (
    <div class="section">
      <h2>Test 14: Multi-Root Component</h2>
      <div class="flex">
        <button onClick={() => show(s => !s)}>
          {() => show() ? 'Hide' : 'Show'} Fragment
        </button>
      </div>
      <div class="mt">
        {() => show() ? <MultiRoot /> : <span class="text-muted">Hidden</span>}
      </div>
    </div>
  );
}

// --- Test 15: Deep signal passing (grandchild reactivity) ---
function GrandChild({ value, onBump }) {
  return (
    <div class="flex" style="padding:8px;border:1px solid var(--border);border-radius:4px">
      <span style="flex:1">GrandChild sees: {value}</span>
      <button onClick={onBump} style="font-size:12px;padding:4px 8px">Bump</button>
    </div>
  );
}

function MiddleChild({ count, onBump }) {
  return (
    <div style="padding:8px;border:1px dashed var(--border);border-radius:4px">
      <p class="text-muted" style="margin-bottom:8px">MiddleChild (pass-through)</p>
      <GrandChild value={() => `${count()} clicks`} onBump={onBump} />
    </div>
  );
}

function DeepPropTest() {
  const count = signal(0, 'deepCount');

  return (
    <div class="section">
      <h2>Test 15: Deep Prop Drilling</h2>
      <MiddleChild count={count} onBump={() => count(c => c + 1)} />
    </div>
  );
}

// --- Test 16: className reactivity ---
function ClassNameTest() {
  const active = signal(false, 'clsActive');
  const size = signal('normal', 'clsSize');

  return (
    <div class="section">
      <h2>Test 16: className Reactivity</h2>
      <div class="flex">
        <button onClick={() => active(a => !a)}>
          Active: {() => String(active())}
        </button>
        <button onClick={() => size(s => s === 'normal' ? 'large' : s === 'large' ? 'small' : 'normal')}>
          Size: {() => size()}
        </button>
      </div>
      <div
        class={() => `tag ${active() ? 'active' : ''} ${size()}`}
        style="margin-top:8px;padding:12px;border:2px solid var(--border);transition:all 0.2s"
      >
        class = {() => `"tag ${active() ? 'active' : ''} ${size()}"`}
      </div>
    </div>
  );
}

// --- Test 17: Rapid signal updates (stress test) ---
function StressTest() {
  const count = signal(0, 'stress');
  const items = signal([], 'stressItems');

  const addMany = () => {
    const start = count();
    const newItems = [];
    for (let i = 0; i < 100; i++) {
      newItems.push({ id: start + i, label: `Item ${start + i}` });
    }
    items(prev => [...prev, ...newItems]);
    count(start + 100);
  };

  const clearAll = () => {
    items([]);
    count(0);
  };

  return (
    <div class="section">
      <h2>Test 17: Stress (100-item batch)</h2>
      <div class="flex">
        <button onClick={addMany}>Add 100 Items</button>
        <button onClick={clearAll} style="background:var(--danger)">Clear</button>
        <span class="text-muted">Total: {() => items().length}</span>
      </div>
      <div class="mt" style="max-height:200px;overflow-y:auto">
        {() => items().map(item => (
          <div style="padding:2px 0;font-size:12px;border-bottom:1px solid var(--border)">
            #{item.id}: {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Test 18: Component swap (dynamic component) ---
function PanelA() {
  return <div style="padding:16px;background:#1e1b4b;border-radius:4px">Panel A content</div>;
}
function PanelB() {
  const tick = signal(0, 'panelBTick');
  effect(() => {
    const id = setInterval(() => tick(t => t + 1), 500);
    return () => clearInterval(id);
  });
  return <div style="padding:16px;background:#1b2e1b;border-radius:4px">Panel B (tick: {() => tick()})</div>;
}
function PanelC() {
  return <div style="padding:16px;background:#2e1b1b;border-radius:4px">Panel C — static</div>;
}

function ComponentSwap() {
  const panels = [PanelA, PanelB, PanelC];
  const idx = signal(0, 'panelIdx');

  return (
    <div class="section">
      <h2>Test 18: Component Swap</h2>
      <div class="flex">
        <button onClick={() => idx(i => (i + 1) % 3)}>
          Next Panel ({() => ['A', 'B', 'C'][idx()]})
        </button>
      </div>
      <div class="mt">
        {() => {
          const Panel = panels[idx()];
          return <Panel />;
        }}
      </div>
    </div>
  );
}

// --- Test 19: onCleanup (unmount detection) ---
function CleanupChild({ id, onUnmount }) {
  onCleanup(() => {
    onUnmount(id);
  });
  return <span class="tag" style="background:#6366f1">Child {id}</span>;
}

function CleanupTest() {
  const count = signal(3, 'cleanupCount');
  const log = signal([], 'cleanupLog');

  const handleUnmount = (id) => {
    log(prev => [...prev, `Unmounted #${id}`]);
  };

  return (
    <div class="section">
      <h2>Test 19: onCleanup</h2>
      <div class="flex">
        <button onClick={() => count(c => c + 1)}>Add</button>
        <button onClick={() => count(c => Math.max(0, c - 1))} style="background:var(--danger)">Remove</button>
        <button onClick={() => log([])}>Clear Log</button>
      </div>
      <div class="flex mt">
        {() => Array.from({ length: count() }, (_, i) => (
          <CleanupChild id={i} onUnmount={handleUnmount} />
        ))}
      </div>
      <p class="text-muted mt">{() => log().join(', ') || 'No unmounts yet'}</p>
    </div>
  );
}

// --- Test 20: Form controls (select, textarea, radio) ---
function FormTest() {
  const select = signal('b', 'formSelect');
  const textarea = signal('Hello\nWorld', 'formTextarea');
  const radio = signal('opt1', 'formRadio');

  return (
    <div class="section">
      <h2>Test 20: Form Controls</h2>
      <div class="flex">
        <select value={select} onChange={(e) => select(e.target.value)} style="flex:1">
          <option value="a">Option A</option>
          <option value="b">Option B</option>
          <option value="c">Option C</option>
        </select>
        <span class="text-muted">Selected: {() => select()}</span>
      </div>
      <div class="mt">
        <textarea
          value={textarea}
          onInput={(e) => textarea(e.target.value)}
          rows="3"
          style="width:100%;resize:vertical"
        />
        <p class="text-muted">Chars: {() => textarea().length}</p>
      </div>
      <div class="flex mt">
        <label style="display:flex;align-items:center;gap:4px">
          <input type="radio" name="test20" value="opt1" checked={() => radio() === 'opt1'} onChange={() => radio('opt1')} />
          Option 1
        </label>
        <label style="display:flex;align-items:center;gap:4px">
          <input type="radio" name="test20" value="opt2" checked={() => radio() === 'opt2'} onChange={() => radio('opt2')} />
          Option 2
        </label>
        <label style="display:flex;align-items:center;gap:4px">
          <input type="radio" name="test20" value="opt3" checked={() => radio() === 'opt3'} onChange={() => radio('opt3')} />
          Option 3
        </label>
        <span class="text-muted">Radio: {() => radio()}</span>
      </div>
    </div>
  );
}

// --- Test 21: Batch updates ---
function BatchTest() {
  const a = signal(0, 'batchA');
  const b = signal(0, 'batchB');
  const renderCount = signal(0, 'batchRenders');

  const derivedSum = () => {
    renderCount(c => c + 1);
    return a() + b();
  };

  const unbatched = () => {
    a(v => v + 1);
    b(v => v + 1);
  };

  const batched = () => {
    batch(() => {
      a(v => v + 1);
      b(v => v + 1);
    });
  };

  return (
    <div class="section">
      <h2>Test 21: Batch Updates</h2>
      <div class="flex">
        <button onClick={unbatched}>Unbatched +1</button>
        <button onClick={batched}>Batched +1</button>
        <button onClick={() => { a(0); b(0); renderCount(0); }} style="background:var(--danger)">Reset</button>
      </div>
      <p class="text-muted mt">
        a={() => a()} b={() => b()} sum={derivedSum} renders={() => renderCount()}
      </p>
    </div>
  );
}

// --- Test 22: ErrorBoundary (catches component-time throws) ---
function Bomb() {
  throw new Error('Kaboom!');
}

function ErrorTest() {
  const showBomb = signal(false, 'showBomb');

  return (
    <div class="section">
      <h2>Test 22: ErrorBoundary</h2>
      <div class="flex">
        <button onClick={() => showBomb(s => !s)}>
          {() => showBomb() ? 'Hide Bomb' : 'Mount Bomb'}
        </button>
      </div>
      <div class="mt">
        <ErrorBoundary fallback={({ error, reset }) => <div style="color:var(--danger);padding:8px;border:1px solid var(--danger);border-radius:4px">Caught: {error.message} <button onClick={reset} style="font-size:11px;padding:2px 8px">Reset</button></div>}>
          {() => showBomb() ? <Bomb /> : <span class="tag" style="background:#22c55e">Safe</span>}
        </ErrorBoundary>
      </div>
    </div>
  );
}

// --- Test 23: Conditional list (Show/For pattern via reactive expressions) ---
function ControlFlowTest() {
  const visible = signal(true, 'cfShow');
  const items = signal(['Apple', 'Banana', 'Cherry', 'Date'], 'cfItems');

  return (
    <div class="section">
      <h2>Test 23: Conditional List</h2>
      <div class="flex">
        <button onClick={() => visible(v => !v)}>
          Toggle Show ({() => String(visible())})
        </button>
        <button onClick={() => items(prev => [...prev, `Fruit ${prev.length + 1}`])}>Add Fruit</button>
        <button onClick={() => items(prev => prev.slice(0, -1))} style="background:var(--danger)">Remove</button>
      </div>
      <div class="mt">
        {() => {
          if (!visible()) return <p class="text-muted">Hidden</p>;
          const list = items();
          if (list.length === 0) return <p class="text-muted">Empty list</p>;
          return list.map((item, i) => (
            <div style="padding:4px 0;border-bottom:1px solid var(--border)">
              {i}. {item}
            </div>
          ));
        }}
      </div>
    </div>
  );
}

// --- Test 24: Async data (createResource) ---
function fakeApi(query) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: 1, name: `${query} Result 1` },
        { id: 2, name: `${query} Result 2` },
        { id: 3, name: `${query} Result 3` },
      ]);
    }, 800);
  });
}

function AsyncTest() {
  const query = signal('hello', 'asyncQuery');
  const [data, { loading, error, refetch }] = createResource(() => fakeApi(query()));

  return (
    <div class="section">
      <h2>Test 24: createResource</h2>
      <div class="flex">
        <input
          type="text"
          value={query}
          onInput={(e) => query(e.target.value)}
          placeholder="Search query"
          style="flex:1"
        />
        <button onClick={refetch}>Refetch</button>
      </div>
      <div class="mt">
        {() => {
          if (loading()) return <p class="text-muted">Loading...</p>;
          if (error()) return <p style="color:var(--danger)">Error: {error().message}</p>;
          const results = data();
          if (!results) return <p class="text-muted">No data</p>;
          return results.map(item => (
            <div style="padding:4px 0;border-bottom:1px solid var(--border)">
              #{item.id}: {item.name}
            </div>
          ));
        }}
      </div>
    </div>
  );
}

// --- Test 25: Keyed list reorder ---
// Uses mapArray with key function for proper DOM reuse across reorders.
// Each KeyedItem has local state (localCount) that should persist through shuffles.
function KeyedItem({ item, onRemove }) {
  const localCount = signal(0, 'keyedLocal');
  return (
    <div class="flex" style="padding:6px 0;border-bottom:1px solid var(--border)">
      <span style="min-width:24px;color:var(--muted)">#{() => item().id}</span>
      <span style="flex:1">{() => item().name}</span>
      <button onClick={() => localCount(c => c + 1)} style="font-size:11px;padding:2px 6px;background:transparent;border:1px solid var(--border)">
        local:{() => localCount()}
      </button>
      <button onClick={() => onRemove(item().id)} style="font-size:11px;padding:2px 6px;background:var(--danger)">x</button>
    </div>
  );
}

function KeyedReorderTest() {
  let nextId = 5;
  const items = signal([
    { id: 1, name: 'Alpha' },
    { id: 2, name: 'Beta' },
    { id: 3, name: 'Gamma' },
    { id: 4, name: 'Delta' },
  ], 'keyedItems');

  const shuffle = () => {
    items(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  };

  const addRandom = () => {
    items(prev => {
      const pos = Math.floor(Math.random() * (prev.length + 1));
      const copy = [...prev];
      copy.splice(pos, 0, { id: nextId++, name: `New-${nextId - 1}` });
      return copy;
    });
  };

  const removeItem = (id) => items(prev => prev.filter(item => item.id !== id));

  // mapArray with key: proper keyed reconciliation that preserves component instances
  const keyedList = mapArray(items, (item, idx) => {
    return <KeyedItem item={item} onRemove={removeItem} />;
  }, { key: item => item.id });

  return (
    <div class="section">
      <h2>Test 25: Keyed Reorder</h2>
      <div class="flex">
        <button onClick={shuffle}>Shuffle</button>
        <button onClick={addRandom}>Insert Random</button>
        <button onClick={() => items(prev => [...prev].reverse())}>Reverse</button>
        <span class="text-muted">Count: {() => items().length}</span>
      </div>
      <div class="mt">
        {keyedList}
      </div>
    </div>
  );
}

// --- Test 26: Inline ternary + nested component in expression ---
function StatusBadge({ status }) {
  return (
    <span class="tag" style={() => `background:${status() === 'ok' ? '#22c55e' : status() === 'warn' ? '#f59e0b' : '#ef4444'}`}>
      {() => status().toUpperCase()}
    </span>
  );
}

function InlineExprTest() {
  const status = signal('ok', 'inlineStatus');
  const items = signal([1, 2, 3], 'inlineItems');

  return (
    <div class="section">
      <h2>Test 26: Inline Expressions</h2>
      <div class="flex">
        <button onClick={() => status(s => s === 'ok' ? 'warn' : s === 'warn' ? 'error' : 'ok')}>
          Cycle Status
        </button>
        <button onClick={() => items(prev => [...prev, prev.length + 1])}>Add Item</button>
        <StatusBadge status={status} />
      </div>
      <div class="mt">
        {() => items().length > 0
          ? items().map(n => <span class="tag" style="background:var(--border);margin:2px">{n}</span>)
          : <p class="text-muted">Empty</p>
        }
      </div>
      <p class="text-muted mt">
        {() => `Status is ${status()}, ${items().length} items, ${status() === 'ok' ? 'all clear' : 'attention needed'}`}
      </p>
    </div>
  );
}

// --- Test 27: <For> component (compiler-lowered mapArray) ---
function ForComponentTest() {
  const fruits = signal([
    { id: 1, name: 'Apple' },
    { id: 2, name: 'Banana' },
    { id: 3, name: 'Cherry' },
  ], 'forFruits');
  let nextId = 4;

  const addFruit = () => {
    const names = ['Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew'];
    fruits(prev => [...prev, { id: nextId++, name: names[(nextId - 5) % names.length] }]);
  };

  return (
    <div class="section">
      <h2>Test 27: For Component</h2>
      <div class="flex">
        <button onClick={addFruit}>Add</button>
        <button onClick={() => fruits(prev => [...prev].reverse())}>Reverse</button>
        <button onClick={() => fruits([])}>Clear</button>
        <span class="text-muted">Count: {() => fruits().length}</span>
      </div>
      <div class="mt">
        <For each={fruits} key={item => item.id}>
          {(item) => <span class="tag" style="margin:2px">{() => item().name}</span>}
        </For>
      </div>
    </div>
  );
}

// --- Test 28: <Show> reactive conditional ---
function ShowTest() {
  const visible = signal(true, 'showVisible');
  const mode = signal('a', 'showMode');

  return (
    <div class="section">
      <h2>Test 28: Show Component</h2>
      <div class="flex">
        <button onClick={() => visible(v => !v)}>Toggle: {() => visible() ? 'ON' : 'OFF'}</button>
        <button onClick={() => mode(m => m === 'a' ? 'b' : 'a')}>Mode: {() => mode()}</button>
      </div>
      <div class="mt">
        <Show when={visible}>
          <p style="color:var(--accent)">I am conditionally visible!</p>
        </Show>
      </div>
      <div class="mt">
        <Show when={() => mode() === 'a'} fallback={<span class="tag" style="background:var(--danger)">Mode B fallback</span>}>
          <span class="tag" style="background:var(--accent)">Mode A content</span>
        </Show>
      </div>
    </div>
  );
}

// --- Test 29: Auto-lowered .map() with key (compiler DX) ---
// The compiler should auto-detect .map() + key prop and use mapArray for efficient keyed reconciliation.
function AutoMapTest() {
  const colors = signal([
    { id: 1, label: 'Red', hex: '#ef4444' },
    { id: 2, label: 'Green', hex: '#22c55e' },
    { id: 3, label: 'Blue', hex: '#3b82f6' },
  ], 'autoMapColors');
  let nextId = 4;

  return (
    <div class="section">
      <h2>Test 29: Auto .map() Keying</h2>
      <div class="flex">
        <button onClick={() => colors(prev => [...prev, { id: nextId++, label: `Color-${nextId-1}`, hex: '#888' }])}>Add</button>
        <button onClick={() => colors(prev => [...prev].reverse())}>Reverse</button>
        <span class="text-muted">Count: {() => colors().length}</span>
      </div>
      <div class="flex mt" style="flex-wrap:wrap;gap:4px">
        {() => colors().map(c => <span key={c.id} class="tag" style={() => `background:${c.hex}`}>{c.label}</span>)}
      </div>
    </div>
  );
}

// --- Test 30: Effect Cleanup (cleanup fn called on re-run and dispose) ---
function EffectCleanupTest() {
  const source = signal('A', 'effectSrc');
  const log = signal([], 'effectLog');

  const appendLog = (msg) => log(prev => [...prev, msg]);

  // Effect that returns a cleanup function
  effect(() => {
    const val = source();
    appendLog(`run:${val}`);
    return () => appendLog(`cleanup:${val}`);
  });

  return (
    <div class="section">
      <h2>Test 30: Effect Cleanup</h2>
      <div class="flex">
        <button onClick={() => source(s => s === 'A' ? 'B' : s === 'B' ? 'C' : 'A')}>
          Next ({() => source()})
        </button>
        <button onClick={() => log([])} style="background:var(--danger)">Clear</button>
      </div>
      <p class="text-muted mt" style="font-family:monospace;font-size:12px">
        {() => log().join(' → ') || 'Click Next to see effect cleanup lifecycle'}
      </p>
    </div>
  );
}

// --- Test 31: Computed chains (diamond problem) ---
function DiamondTest() {
  const base = signal(1, 'diamond');
  const left = () => base() * 2;
  const right = () => base() * 3;
  const combined = () => left() + right();
  const runCount = signal(0, 'diamondRuns');

  effect(() => {
    combined();
    runCount(c => c + 1);
  });

  return (
    <div class="section">
      <h2>Test 31: Diamond Reactivity</h2>
      <div class="flex">
        <button onClick={() => base(b => b + 1)}>base++</button>
        <button onClick={() => { base(1); runCount(0); }} style="background:var(--danger)">Reset</button>
      </div>
      <p class="text-muted mt">
        base={()=> base()} left={()=> left()} right={()=> right()} combined={()=> combined()} effectRuns={()=> runCount()}
      </p>
      <p class="text-muted" style="font-size:11px">
        (Effect should fire once per base change, not twice — no diamond glitch)
      </p>
    </div>
  );
}

// --- Test 32: Dynamic component swapping (with local state + cleanup) ---
function SwapView1() {
  const local = signal(0, 'swapV1');
  onCleanup(() => console.log('[Test32] View1 unmounted'));
  return (
    <div style="padding:12px;border:2px solid #6366f1;border-radius:4px">
      <strong style="color:#6366f1">View 1 (Counter)</strong>
      <button onClick={() => local(c => c + 1)} style="margin-left:8px;font-size:11px">
        clicks: {() => local()}
      </button>
    </div>
  );
}

function SwapView2() {
  const text = signal('', 'swapV2');
  onCleanup(() => console.log('[Test32] View2 unmounted'));
  return (
    <div style="padding:12px;border:2px solid #f59e0b;border-radius:4px">
      <strong style="color:#f59e0b">View 2 (Input)</strong>
      <input
        type="text"
        placeholder="Type here..."
        value={text}
        onInput={(e) => text(e.target.value)}
        style="margin-left:8px;font-size:12px"
      />
      <span class="text-muted" style="margin-left:4px">{() => text().length} chars</span>
    </div>
  );
}

function SwapView3() {
  const items = signal([1, 2, 3], 'swapV3');
  onCleanup(() => console.log('[Test32] View3 unmounted'));
  return (
    <div style="padding:12px;border:2px solid #22c55e;border-radius:4px">
      <strong style="color:#22c55e">View 3 (List)</strong>
      <span class="text-muted" style="margin-left:8px">{() => items().join(', ')}</span>
      <button onClick={() => items(p => [...p, p.length + 1])} style="margin-left:8px;font-size:11px">+</button>
    </div>
  );
}

function DynamicSwapTest() {
  const views = ['View1', 'View2', 'View3'];
  const current = signal(0, 'swapIdx');

  return (
    <div class="section">
      <h2>Test 32: Dynamic Component Swap</h2>
      <div class="flex">
        <button onClick={() => current(c => (c + 1) % 3)}>
          Next ({() => views[current()]})
        </button>
      </div>
      <div class="mt">
        {() => {
          const idx = current();
          if (idx === 0) return <SwapView1 />;
          if (idx === 1) return <SwapView2 />;
          return <SwapView3 />;
        }}
      </div>
    </div>
  );
}

// --- Test 33: Reactive SVG (animated path + transforms) ---
function ReactiveSvgTest() {
  const angle = signal(0, 'svgAngle');
  const scale = signal(1, 'svgScale');
  const points = signal(5, 'svgPoints');

  const starPath = () => {
    const n = points();
    const cx = 60, cy = 60, outerR = 50, innerR = 25;
    let d = '';
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI * i) / n - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    return d + 'Z';
  };

  return (
    <div class="section">
      <h2>Test 33: Reactive SVG</h2>
      <div class="flex">
        <button onClick={() => angle(a => a + 30)}>Rotate +30°</button>
        <button onClick={() => scale(s => s === 1 ? 1.3 : 1)}>
          Scale: {() => scale().toFixed(1)}x
        </button>
        <button onClick={() => points(p => p >= 8 ? 3 : p + 1)}>
          Points: {() => points()}
        </button>
      </div>
      <svg width="120" height="120" viewBox="0 0 120 120" style="margin-top:8px;background:var(--border);border-radius:4px">
        <path
          d={starPath}
          fill="#6366f1"
          stroke="#818cf8"
          stroke-width="2"
          transform={() => `rotate(${angle()} 60 60) scale(${scale()})`}
          transform-origin="60 60"
        />
      </svg>
    </div>
  );
}

// --- Test 34: Untrack (opt out of reactive tracking) ---
function UntrackTest() {
  const tracked = signal(0, 'tracked');
  const untracked_val = signal(0, 'untracked');
  const effectRuns = signal(0, 'untrackRuns');

  effect(() => {
    tracked();
    untrack(() => untracked_val());
    effectRuns(c => c + 1);
  });

  return (
    <div class="section">
      <h2>Test 34: Untrack</h2>
      <div class="flex">
        <button onClick={() => tracked(t => t + 1)}>
          Tracked: {() => tracked()}
        </button>
        <button onClick={() => untracked_val(u => u + 1)}>
          Untracked: {() => untracked_val()}
        </button>
      </div>
      <p class="text-muted mt">
        Effect runs: {() => effectRuns()} (should only increase when Tracked changes)
      </p>
    </div>
  );
}

// --- Test 35: Nested mapArray (nested keyed lists) ---
function NestedMapTest() {
  const groups = signal([
    { id: 1, name: 'Fruits', items: ['Apple', 'Banana'] },
    { id: 2, name: 'Veggies', items: ['Carrot', 'Broccoli'] },
  ], 'nestedGroups');
  let nextGroupId = 3;

  const addGroup = () => {
    groups(prev => [...prev, {
      id: nextGroupId++,
      name: `Group ${nextGroupId - 1}`,
      items: ['Item 1'],
    }]);
  };

  const addItem = (groupId) => {
    groups(prev => prev.map(g =>
      g.id === groupId
        ? { ...g, items: [...g.items, `Item ${g.items.length + 1}`] }
        : g
    ));
  };

  const removeGroup = (groupId) => {
    groups(prev => prev.filter(g => g.id !== groupId));
  };

  const keyedGroups = mapArray(groups, (group) => {
    return (
      <div style="padding:8px;border:1px solid var(--border);border-radius:4px;margin-bottom:4px">
        <div class="flex">
          <strong>{() => group().name}</strong>
          <button onClick={() => addItem(group().id)} style="font-size:10px;padding:2px 6px;margin-left:auto">+ item</button>
          <button onClick={() => removeGroup(group().id)} style="font-size:10px;padding:2px 6px;background:var(--danger)">x</button>
        </div>
        <div style="margin-top:4px;padding-left:12px">
          {() => group().items.map((item, i) => (
            <span class="tag" style="margin:2px;background:var(--border)">{item}</span>
          ))}
        </div>
      </div>
    );
  }, { key: g => g.id });

  return (
    <div class="section">
      <h2>Test 35: Nested Lists</h2>
      <div class="flex">
        <button onClick={addGroup}>Add Group</button>
        <button onClick={() => groups(prev => [...prev].reverse())}>Reverse</button>
        <span class="text-muted">Groups: {() => groups().length}</span>
      </div>
      <div class="mt">
        {keyedGroups}
      </div>
    </div>
  );
}

// --- Test 36: Style object (pass object instead of string) ---
function StyleObjectTest() {
  const hue = signal(200, 'styleHue');
  const size = signal(16, 'styleSize');
  const bold = signal(false, 'styleBold');

  return (
    <div class="section">
      <h2>Test 36: Dynamic Styles</h2>
      <div class="flex">
        <button onClick={() => hue(h => (h + 40) % 360)}>Hue: {() => hue()}</button>
        <button onClick={() => size(s => s >= 24 ? 12 : s + 2)}>Size: {() => size()}px</button>
        <button onClick={() => bold(b => !b)}>Bold: {() => String(bold())}</button>
      </div>
      <p class="mt" style={() => `color:hsl(${hue()} 80% 50%);font-size:${size()}px;font-weight:${bold() ? 700 : 400}`}>
        This text reacts to all three style signals at once.
      </p>
    </div>
  );
}

// --- Test 37: computed() memoization ---
function ComputedMemoTest() {
  const a = signal(1, 'compA');
  const b = signal(10, 'compB');
  let computeCount = 0;
  const expensive = computed(() => {
    computeCount++;
    return a() * b();
  });
  const computeRuns = signal(0, 'computeRuns');

  const readResult = () => {
    const val = expensive();
    computeRuns(computeCount);
    return val;
  };

  return (
    <div class="section">
      <h2>Test 37: Computed Memo</h2>
      <div class="flex">
        <button onClick={() => a(v => v + 1)}>a++: {() => a()}</button>
        <button onClick={() => b(v => v + 10)}>b+10: {() => b()}</button>
        <button onClick={readResult}>Read (force eval)</button>
      </div>
      <p class="text-muted mt">
        expensive={() => expensive()} computeRuns={() => computeRuns()}
      </p>
      <p class="text-muted" style="font-size:11px">
        (computed should NOT re-run when read multiple times without dep changes)
      </p>
    </div>
  );
}

// --- Test 38: Event modifiers (preventDefault, stopPropagation) ---
// Uses '__' delimiter for JSX-safe event modifiers (e.g., onSubmit__preventDefault)
function EventModTest() {
  const log = signal([], 'evtLog');
  const append = (msg) => log(prev => [...prev.slice(-4), msg]);

  return (
    <div class="section">
      <h2>Test 38: Event Modifiers</h2>
      <form onSubmit__preventDefault={(e) => append('form submitted (no reload)')}>
        <div class="flex">
          <input type="text" placeholder="Press Enter to submit" style="flex:1" />
          <button type="submit">Submit</button>
        </div>
      </form>
      <div class="flex mt">
        <div onClick={() => append('outer clicked')} style="padding:8px;border:1px solid var(--border);border-radius:4px">
          <button onClick__stopPropagation={() => append('inner clicked (no bubble)')}>
            Click (stopPropagation)
          </button>
        </div>
        <button onClick__once={() => append('once! (disabled after)')}>
          Click Once
        </button>
      </div>
      <p class="text-muted mt" style="font-family:monospace;font-size:12px">
        {() => log().join(' | ') || 'Interact to see events'}
      </p>
    </div>
  );
}

// --- Test 39: Mini App (tabs + local state per tab) ---
function TabContent({ tab }) {
  const items = signal([], 'tabItems');
  const input = signal('', 'tabInput');
  let nextId = 1;

  const add = () => {
    const text = input();
    if (!text.trim()) return;
    items(prev => [...prev, { id: nextId++, text, done: false }]);
    input('');
  };

  const toggle = (id) => {
    items(prev => prev.map(item =>
      item.id === id ? { ...item, done: !item.done } : item
    ));
  };

  const remove = (id) => items(prev => prev.filter(item => item.id !== id));

  const doneCount = () => items().filter(i => i.done).length;

  return (
    <div style="padding:12px;border:1px solid var(--border);border-radius:4px">
      <div class="flex">
        <input
          type="text"
          placeholder={() => `Add to ${tab}...`}
          value={input}
          onInput={(e) => input(e.target.value)}
          onKeydown={(e) => { if (e.key === 'Enter') add(); }}
          style="flex:1"
        />
        <button onClick={add}>+</button>
      </div>
      <div class="mt">
        {() => {
          const list = items();
          if (list.length === 0) return <p class="text-muted">No items in {tab}</p>;
          return list.map(item => (
            <div class="flex" style="padding:4px 0;border-bottom:1px solid var(--border)">
              <input type="checkbox" checked={item.done} onChange={() => toggle(item.id)} />
              <span style={() => item.done ? 'text-decoration:line-through;opacity:0.5;flex:1' : 'flex:1'}>
                {item.text}
              </span>
              <button onClick={() => remove(item.id)} style="font-size:10px;padding:2px 6px;background:var(--danger)">x</button>
            </div>
          ));
        }}
      </div>
      <p class="text-muted" style="font-size:11px;margin-top:4px">
        {() => `${doneCount()}/${items().length} done`}
      </p>
    </div>
  );
}

function MiniAppTest() {
  const tabs = ['Work', 'Personal', 'Ideas'];
  const activeTab = signal(0, 'activeTab');

  return (
    <div class="section">
      <h2>Test 39: Mini App (Tabbed Todo)</h2>
      <div class="flex" style="border-bottom:2px solid var(--border);margin-bottom:8px">
        {tabs.map((tab, i) => (
          <button
            onClick={() => activeTab(i)}
            style={() => `border-radius:4px 4px 0 0;border-bottom:2px solid ${activeTab() === i ? 'var(--accent)' : 'transparent'};background:${activeTab() === i ? 'var(--accent)' : 'transparent'};color:${activeTab() === i ? 'white' : 'inherit'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      {() => <TabContent tab={tabs[activeTab()]} />}
    </div>
  );
}

// --- Test 40: Effect error recovery ---
function EffectErrorTest() {
  const value = signal(0, 'errVal');
  const errorLog = signal([], 'errLog');
  const shouldThrow = signal(false, 'shouldThrow');

  effect(() => {
    const v = value();
    if (shouldThrow()) {
      shouldThrow(false);
      throw new Error(`Effect exploded at value=${v}`);
    }
    errorLog(prev => [...prev.slice(-3), `ok:${v}`]);
  });

  return (
    <div class="section">
      <h2>Test 40: Effect Errors</h2>
      <div class="flex">
        <button onClick={() => value(v => v + 1)}>Increment: {() => value()}</button>
        <button onClick={() => { shouldThrow(true); value(v => v + 1); }} style="background:var(--danger)">
          Throw on next
        </button>
      </div>
      <p class="text-muted mt" style="font-family:monospace;font-size:12px">
        {() => errorLog().join(' → ') || 'No activity'}
      </p>
      <p class="text-muted" style="font-size:11px">
        (After throw, effect should still work on next change)
      </p>
    </div>
  );
}

// --- Test 41: Data-* and aria-* attributes ---
function AccessibilityTest() {
  const expanded = signal(false, 'ariaExp');
  const count = signal(0, 'dataCount');

  return (
    <div class="section">
      <h2>Test 41: ARIA + Data Attrs</h2>
      <div class="flex">
        <button
          onClick={() => expanded(e => !e)}
          aria-expanded={() => String(expanded())}
          aria-label="Toggle panel"
          data-testid="toggle-btn"
          data-count={() => count()}
        >
          {() => expanded() ? 'Collapse' : 'Expand'}
        </button>
        <button onClick={() => count(c => c + 1)} data-testid="count-btn">
          Count: {() => count()}
        </button>
      </div>
      <div
        role="region"
        aria-hidden={() => String(!expanded())}
        style={() => `overflow:hidden;max-height:${expanded() ? '200px' : '0'};transition:max-height 0.3s;border:1px solid var(--border);border-radius:4px;margin-top:8px`}
      >
        <p style="padding:12px">
          Panel content. Count is {() => count()}.
        </p>
      </div>
    </div>
  );
}

// --- Test 42: Derived signal chains (multi-level computed) ---
function DerivedChainTest() {
  const firstName = signal('John', 'firstName');
  const lastName = signal('Doe', 'lastName');
  const fullName = computed(() => `${firstName()} ${lastName()}`);
  const greeting = computed(() => `Hello, ${fullName()}!`);
  const charCount = computed(() => greeting().length);

  return (
    <div class="section">
      <h2>Test 42: Computed Chain</h2>
      <div class="flex">
        <input
          type="text"
          value={firstName}
          onInput={(e) => firstName(e.target.value)}
          placeholder="First name"
          style="flex:1"
        />
        <input
          type="text"
          value={lastName}
          onInput={(e) => lastName(e.target.value)}
          placeholder="Last name"
          style="flex:1"
        />
      </div>
      <p class="mt">
        {() => greeting()} <span class="text-muted">({() => charCount()} chars)</span>
      </p>
    </div>
  );
}

// --- Test 43: Portal pattern (render children into a different DOM node) ---
function PortalTest() {
  const showModal = signal(false, 'modal');

  return (
    <div class="section">
      <h2>Test 43: Modal Pattern</h2>
      <div class="flex">
        <button onClick={() => showModal(true)}>Open Modal</button>
      </div>
      {() => showModal() ? (
        <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000" onClick={(e) => { if (e.target === e.currentTarget) showModal(false); }}>
          <div style="background:var(--bg);padding:24px;border-radius:8px;min-width:300px;border:1px solid var(--border)">
            <h3 style="margin:0 0 12px">Modal Dialog</h3>
            <p class="text-muted">This is a modal rendered via conditional in the component tree.</p>
            <div class="flex" style="margin-top:16px;justify-content:flex-end">
              <button onClick={() => showModal(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// --- Test 44: Deeply nested prop drilling (4 levels) ---
function Level4({ label, onAction }) {
  const local = signal(0, 'l4');
  return (
    <div style="padding:4px 8px;border-left:2px solid #22c55e">
      <span style="font-size:11px">{() => label()} (local:{() => local()})</span>
      <button onClick={() => { local(c => c + 1); onAction(`${label()} clicked`); }} style="font-size:10px;padding:1px 4px;margin-left:4px">+</button>
    </div>
  );
}
function Level3({ label, onAction }) {
  return (
    <div style="padding:4px 8px;border-left:2px solid #f59e0b">
      <span style="font-size:11px;color:var(--muted)">L3: {() => label()}</span>
      <Level4 label={() => `${label()}-leaf`} onAction={onAction} />
    </div>
  );
}
function Level2({ label, onAction }) {
  return (
    <div style="padding:4px 8px;border-left:2px solid #6366f1">
      <span style="font-size:11px;color:var(--muted)">L2: {() => label()}</span>
      <Level3 label={label} onAction={onAction} />
    </div>
  );
}
function DeepNestTest() {
  const name = signal('Root', 'deepName');
  const log = signal([], 'deepLog');

  return (
    <div class="section">
      <h2>Test 44: Deep Nesting (4 levels)</h2>
      <div class="flex">
        <input type="text" value={name} onInput={(e) => name(e.target.value)} style="flex:1" placeholder="Change root label" />
        <button onClick={() => log([])} style="background:var(--danger);font-size:11px">Clear</button>
      </div>
      <div class="mt">
        <Level2 label={name} onAction={(msg) => log(prev => [...prev.slice(-3), msg])} />
      </div>
      <p class="text-muted mt" style="font-size:11px;font-family:monospace">
        {() => log().join(' | ') || 'Click leaf buttons'}
      </p>
    </div>
  );
}

// --- Test 45: Unkeyed list reconciliation ---
function UnkeyedListTest() {
  const items = signal(['A', 'B', 'C', 'D', 'E'], 'unkeyed');

  const shuffle = () => {
    items(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    });
  };

  // Unkeyed: item and idx are both raw values (not signal accessors)
  const unkeyedList = mapArray(items, (item, idx) => {
    return (
      <div class="flex" style="padding:4px 0;border-bottom:1px solid var(--border)">
        <span style="min-width:24px;color:var(--muted);font-size:11px">{idx}</span>
        <span style="flex:1">{item}</span>
      </div>
    );
  });

  return (
    <div class="section">
      <h2>Test 45: Unkeyed Reorder</h2>
      <div class="flex">
        <button onClick={shuffle}>Shuffle</button>
        <button onClick={() => items(p => [...p, String.fromCharCode(65 + p.length)])}>Add</button>
        <button onClick={() => items(p => p.slice(0, -1))} style="background:var(--danger)">Pop</button>
        <button onClick={() => items(p => [...p].reverse())}>Reverse</button>
        <span class="text-muted">{() => items().length} items</span>
      </div>
      <div class="mt">{unkeyedList}</div>
    </div>
  );
}

// --- Test 46: Async effect with AbortController ---
function AsyncEffectTest() {
  const query = signal('', 'asyncQ');
  const result = signal(null, 'asyncResult');
  const loading = signal(false, 'asyncLoading');
  const abortCount = signal(0, 'abortCount');

  effect(() => {
    const q = query();
    if (!q || q.length < 2) { result(null); return; }

    loading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!controller.signal.aborted) {
        result({ query: q, items: [`${q}-result-1`, `${q}-result-2`, `${q}-result-3`] });
        loading(false);
      }
    }, 500);

    return () => {
      controller.abort();
      clearTimeout(timer);
      abortCount(c => c + 1);
      loading(false);
    };
  });

  return (
    <div class="section">
      <h2>Test 46: Async Effect + Cleanup</h2>
      <div class="flex">
        <input
          type="text"
          value={query}
          onInput={(e) => query(e.target.value)}
          placeholder="Type to search (debounce via cleanup)..."
          style="flex:1"
        />
        <span class="text-muted" style="font-size:11px">aborts: {() => abortCount()}</span>
      </div>
      <div class="mt">
        {() => {
          if (loading()) return <p class="text-muted">Searching...</p>;
          const r = result();
          if (!r) return <p class="text-muted">Type 2+ chars to search</p>;
          return r.items.map(item => (
            <div style="padding:4px 0;border-bottom:1px solid var(--border)">{item}</div>
          ));
        }}
      </div>
    </div>
  );
}

// --- Test 47: Complex form with validation ---
function FormValidationTest() {
  const form = signal({ email: '', password: '', agree: false }, 'formData');
  const submitted = signal(null, 'formSubmit');
  const touched = signal({}, 'formTouched');

  const errors = () => {
    const f = form();
    const e = {};
    if (!f.email.includes('@')) e.email = 'Must contain @';
    if (f.password.length < 4) e.password = 'Min 4 chars';
    if (!f.agree) e.agree = 'Must agree';
    return e;
  };

  const isValid = () => Object.keys(errors()).length === 0;

  const update = (field, value) => form(f => ({ ...f, [field]: value }));
  const touch = (field) => touched(t => ({ ...t, [field]: true }));

  const handleSubmit = () => {
    touched({ email: true, password: true, agree: true });
    if (isValid()) submitted(form());
  };

  return (
    <div class="section">
      <h2>Test 47: Form Validation</h2>
      <div style="display:grid;gap:8px">
        <div>
          <input
            type="email"
            placeholder="Email"
            value={() => form().email}
            onInput={(e) => update('email', e.target.value)}
            onBlur={() => touch('email')}
            style={() => `width:100%;${touched().email && errors().email ? 'border-color:var(--danger)' : ''}`}
          />
          {() => touched().email && errors().email ? <span style="color:var(--danger);font-size:11px">{errors().email}</span> : null}
        </div>
        <div>
          <input
            type="password"
            placeholder="Password (4+ chars)"
            value={() => form().password}
            onInput={(e) => update('password', e.target.value)}
            onBlur={() => touch('password')}
            style={() => `width:100%;${touched().password && errors().password ? 'border-color:var(--danger)' : ''}`}
          />
          {() => touched().password && errors().password ? <span style="color:var(--danger);font-size:11px">{errors().password}</span> : null}
        </div>
        <div class="flex">
          <input type="checkbox" checked={() => form().agree} onChange={(e) => update('agree', e.target.checked)} />
          <span style="font-size:12px">I agree to terms</span>
          {() => touched().agree && errors().agree ? <span style="color:var(--danger);font-size:11px;margin-left:8px">{errors().agree}</span> : null}
        </div>
        <button onClick={handleSubmit} style={() => `width:100%;${isValid() ? '' : 'opacity:0.5'}`}>
          Submit {() => isValid() ? '✓' : ''}
        </button>
      </div>
      {() => submitted() ? <p style="color:#22c55e;margin-top:8px;font-size:12px">Submitted: {JSON.stringify(submitted())}</p> : null}
    </div>
  );
}

// --- Test 48: Nested ternary + template literal in JSX (compiler stress) ---
function CompilerStressTest() {
  const level = signal(0, 'csLevel');
  const mode = signal('light', 'csMode');

  return (
    <div class="section">
      <h2>Test 48: Compiler Stress</h2>
      <div class="flex">
        <button onClick={() => level(l => (l + 1) % 4)}>Level: {() => level()}</button>
        <button onClick={() => mode(m => m === 'light' ? 'dark' : 'light')}>Mode: {() => mode()}</button>
      </div>
      <div class="mt" style={() => `padding:12px;border-radius:4px;background:${mode() === 'dark' ? '#1e293b' : '#f1f5f9'};color:${mode() === 'dark' ? '#e2e8f0' : '#1e293b'}`}>
        {() => level() === 0
          ? <span>Level 0: Basic</span>
          : level() === 1
            ? <span style="font-weight:700">Level 1: <em>Bold + Italic</em></span>
            : level() === 2
              ? <div><span style="color:#ef4444">Level 2:</span> <span style="color:#22c55e">Multi-element</span></div>
              : <div style="border:2px dashed var(--accent);padding:8px;border-radius:4px">Level 3: Boxed content in {() => mode()} mode</div>
        }
      </div>
    </div>
  );
}

// --- Test 49: Multiple unmount + remount cycle ---
function Ephemeral({ id, onCleanup: reportCleanup }) {
  const ticks = signal(0, `eph-${id}`);
  const timer = setInterval(() => ticks(c => c + 1), 100);
  onCleanup(() => {
    clearInterval(timer);
    reportCleanup(id);
  });
  return (
    <div style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:11px">
      #{id} ticks:{() => ticks()}
    </div>
  );
}

function MountCycleTest() {
  const count = signal(3, 'cycleCount');
  const generation = signal(0, 'cycleGen');
  const cleanupLog = signal([], 'cycleLog');

  const remount = () => {
    generation(g => g + 1);
  };

  return (
    <div class="section">
      <h2>Test 49: Mount/Unmount Cycle</h2>
      <div class="flex">
        <button onClick={() => count(c => Math.min(c + 1, 8))}>+</button>
        <button onClick={() => count(c => Math.max(c - 1, 0))}>-</button>
        <button onClick={remount}>Remount (gen:{() => generation()})</button>
        <button onClick={() => cleanupLog([])} style="font-size:11px;background:var(--danger)">Clear log</button>
        <span class="text-muted">{() => count()} items</span>
      </div>
      <div class="flex mt" style="flex-wrap:wrap;gap:4px">
        {() => {
          const gen = generation();
          return Array.from({ length: count() }, (_, i) => (
            <Ephemeral id={`${gen}-${i}`} onCleanup={(id) => cleanupLog(prev => [...prev.slice(-5), `cleaned:${id}`])} />
          ));
        }}
      </div>
      <p class="text-muted mt" style="font-size:11px;font-family:monospace">
        {() => cleanupLog().join(' | ') || 'Reduce count or remount to see cleanup'}
      </p>
    </div>
  );
}

// --- Test 50: SVG with reactive gradients + clip path ---
function SvgGradientTest() {
  const progress = signal(50, 'svgProg');
  const hue = signal(200, 'svgHue');

  return (
    <div class="section">
      <h2>Test 50: SVG Gradients + Clip</h2>
      <div class="flex">
        <input type="range" min="0" max="100" value={progress} onInput={(e) => progress(+e.target.value)} style="flex:1" />
        <span class="text-muted" style="min-width:40px">{() => progress()}%</span>
        <button onClick={() => hue(h => (h + 60) % 360)}>Hue:{() => hue()}</button>
      </div>
      <svg width="200" height="24" viewBox="0 0 200 24" style="margin-top:8px">
        <defs>
          <linearGradient id="prog-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color={() => `hsl(${hue()} 80% 50%)`} />
            <stop offset="100%" stop-color={() => `hsl(${(hue() + 60) % 360} 80% 50%)`} />
          </linearGradient>
          <clipPath id="prog-clip">
            <rect x="0" y="0" width={() => progress() * 2} height="24" rx="4" />
          </clipPath>
        </defs>
        <rect x="0" y="0" width="200" height="24" rx="4" fill="var(--border)" />
        <rect x="0" y="0" width="200" height="24" rx="4" fill="url(#prog-grad)" clip-path="url(#prog-clip)" />
        <text x="100" y="16" text-anchor="middle" fill="white" font-size="11" font-weight="bold">
          {() => `${progress()}%`}
        </text>
      </svg>
    </div>
  );
}

// --- Test 51: Inline mapArray in JSX (compiler regression) ---
function InlineMapArrayTest() {
  const items = signal([
    { id: 'a', text: 'Alpha' },
    { id: 'b', text: 'Beta' },
    { id: 'c', text: 'Gamma' },
  ], 'inlineMapItems');

  return (
    <div class="section">
      <h2>Test 51: Inline mapArray (compiler fix)</h2>
      <div>
        {mapArray(items, (item) => (
          <div class="flex" style="padding:2px 0">
            <span>{item.text}</span>
            <button onClick={() => items(prev => prev.filter(i => i.id !== item.id))} style="font-size:10px">×</button>
          </div>
        ), { key: item => item.id, raw: true })}
      </div>
      <div class="flex" style="margin-top:4px">
        <button onClick={() => items(prev => [...prev, { id: `d${Date.now()}`, text: `Item-${prev.length + 1}` }])}>Add</button>
        <button onClick={() => items(prev => [...prev].reverse())}>Reverse</button>
        <span class="text-muted">{() => items().length} items</span>
      </div>
    </div>
  );
}

// --- Test 52: Select value binding ---
function SelectValueTest() {
  const selected = signal('opt2', 'selectVal');
  return (
    <div class="section">
      <h2>Test 52: Select Initial Value</h2>
      <div class="flex">
        <select value={selected} onChange={(e) => selected(e.target.value)}>
          <option value="opt1">Option 1</option>
          <option value="opt2">Option 2 (default)</option>
          <option value="opt3">Option 3</option>
        </select>
        <span class="text-muted">Selected: {() => selected()}</span>
      </div>
    </div>
  );
}

// --- Test 53: Full form controls (radio groups, multi-checkbox, range, textarea) ---
function FormControlsTest() {
  const color = signal('green', 'radioColor');
  const toppings = signal({ cheese: true, peppers: false, onions: false }, 'toppings');
  const size = signal(50, 'sizeRange');
  const notes = signal('', 'notes');

  const summary = computed(() => {
    const t = toppings();
    const active = Object.entries(t).filter(([, v]) => v).map(([k]) => k);
    return `${color()} | ${active.join(',') || 'none'} | size:${size()}`;
  });

  function toggleTopping(name) {
    toppings(prev => ({ ...prev, [name]: !prev[name] }));
  }

  return (
    <div class="section">
      <h2>Test 53: Form Controls Suite</h2>
      <div class="flex" style="gap:16px;align-items:flex-start">
        <div>
          <strong style="font-size:11px">Radio:</strong>
          {['red', 'green', 'blue'].map(c => (
            <label class="flex" style="gap:4px;font-size:12px">
              <input type="radio" name="color53" value={c}
                checked={() => color() === c}
                onChange={() => color(c)} />
              {c}
            </label>
          ))}
        </div>
        <div>
          <strong style="font-size:11px">Checkboxes:</strong>
          {['cheese', 'peppers', 'onions'].map(t => (
            <label class="flex" style="gap:4px;font-size:12px">
              <input type="checkbox"
                checked={() => toppings()[t]}
                onChange={() => toggleTopping(t)} />
              {t}
            </label>
          ))}
        </div>
        <div style="flex:1">
          <strong style="font-size:11px">Range: {() => size()}</strong>
          <input type="range" min="0" max="100" value={size}
            onInput={(e) => size(+e.target.value)} style="width:100%" />
          <textarea placeholder="Notes..." value={notes}
            onInput={(e) => notes(e.target.value)}
            style="width:100%;height:40px;margin-top:4px" />
        </div>
      </div>
      <p class="text-muted">{() => summary()}</p>
    </div>
  );
}

// --- Test 54: Async abort + race condition ---
function AsyncAbortTest() {
  const query = signal('', 'abortQuery');
  const result = signal(null, 'abortResult');
  const aborts = signal(0, 'abortCount');
  const inflight = signal(false, 'inflight');

  let ctrl = null;

  effect(() => {
    const q = query();
    if (q.length < 2) { result(null); return; }

    if (ctrl) { ctrl.abort(); aborts(n => n + 1); }
    ctrl = new AbortController();
    const sig = ctrl.signal;
    inflight(true);

    const delay = 200 + Math.random() * 300;
    const timer = setTimeout(() => {
      if (sig.aborted) return;
      result({ query: q, items: [`${q}-result-1`, `${q}-result-2`], ms: Math.round(delay) });
      inflight(false);
      ctrl = null;
    }, delay);

    return () => { clearTimeout(timer); };
  });

  onCleanup(() => { if (ctrl) ctrl.abort(); });

  return (
    <div class="section">
      <h2>Test 54: Async Abort + Race</h2>
      <div class="flex">
        <input type="text" placeholder="Type fast to trigger aborts..."
          value={query} onInput={(e) => query(e.target.value)} style="flex:1" />
        <span class="text-muted">aborts:{() => aborts()}</span>
        {() => inflight() ? <span class="loading">searching...</span> : null}
      </div>
      {() => result() ? (
        <div class="mt">
          <span class="text-muted">query:"{() => result().query}" ({() => result().ms}ms)</span>
          <div>{() => result().items.join(', ')}</div>
        </div>
      ) : null}
    </div>
  );
}

// --- Test 55: Nested teardown chain ---
function NestedTeardownTest() {
  const show = signal(true, 'tearShow');
  const log = signal([], 'tearLog');

  function addLog(msg) { log(prev => [...prev, msg]); }

  function Outer() {
    const timer = setInterval(() => {}, 1000);
    onCleanup(() => { clearInterval(timer); addLog('outer-cleanup'); });
    return (
      <div style="padding:4px;border:1px solid var(--border);border-radius:4px">
        <span class="text-muted">Outer</span>
        <Middle />
      </div>
    );
  }

  function Middle() {
    onCleanup(() => addLog('middle-cleanup'));
    return (
      <div style="padding:4px;margin-top:4px;border:1px dashed var(--border);border-radius:4px">
        <span class="text-muted">Middle</span>
        <Inner label="A" />
        <Inner label="B" />
      </div>
    );
  }

  function Inner({ label }) {
    const ticks = signal(0, `inner${label}Ticks`);
    const timer = setInterval(() => ticks(n => n + 1), 100);
    onCleanup(() => { clearInterval(timer); addLog(`inner-${label}-cleanup`); });
    return <span style="margin:0 4px" class="perf">{label}:{() => ticks()}</span>;
  }

  return (
    <div class="section">
      <h2>Test 55: Nested Teardown</h2>
      <div class="flex">
        <button onClick={() => show(v => !v)}>
          {() => show() ? 'Unmount All' : 'Remount'}
        </button>
        <button class="ghost" onClick={() => log([])}>Clear Log</button>
      </div>
      <div class="mt">
        {() => show() ? <Outer /> : <span class="text-muted">unmounted</span>}
      </div>
      <p class="text-muted mt">{() => log().length ? log().join(' → ') : 'Mount/unmount to see cleanup order'}</p>
    </div>
  );
}

// --- Test 56: Keyed list splice + move ---
function KeyedSpliceTest() {
  let nextId = 6;
  const items = signal([
    { id: 1, text: 'One' }, { id: 2, text: 'Two' }, { id: 3, text: 'Three' },
    { id: 4, text: 'Four' }, { id: 5, text: 'Five' },
  ], 'spliceItems');

  function spliceMid() {
    items(prev => {
      const arr = [...prev];
      arr.splice(2, 1, { id: nextId++, text: `New-${nextId - 1}` });
      return arr;
    });
  }
  function moveFirstToEnd() {
    items(prev => [...prev.slice(1), prev[0]]);
  }
  function swapEnds() {
    items(prev => {
      const arr = [...prev];
      [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];
      return arr;
    });
  }

  return (
    <div class="section">
      <h2>Test 56: Keyed Splice + Move</h2>
      <div class="flex">
        <button onClick={spliceMid}>Splice Mid</button>
        <button onClick={moveFirstToEnd}>Move First→End</button>
        <button onClick={swapEnds}>Swap Ends</button>
        <span class="text-muted">{() => items().length} items</span>
      </div>
      <div class="mt">
        {mapArray(items, (item) => (
          <span class="badge" style="margin:2px;background:var(--border)">{item.text}</span>
        ), { key: item => item.id, raw: true })}
      </div>
    </div>
  );
}

// --- Test 57: SVG foreignObject + animated transform ---
function SvgForeignObjectTest() {
  const angle = signal(0, 'fObjAngle');
  const label = signal('Hello SVG', 'fObjLabel');

  const timer = setInterval(() => angle(a => a + 2), 50);
  onCleanup(() => clearInterval(timer));

  return (
    <div class="section">
      <h2>Test 57: SVG foreignObject + Transform</h2>
      <div class="flex">
        <input type="text" value={label} onInput={(e) => label(e.target.value)} style="width:150px" />
        <button onClick={() => angle(0)}>Reset</button>
        <span class="perf">{() => angle()}°</span>
      </div>
      <svg width="200" height="100" viewBox="0 0 200 100" style="margin-top:8px">
        <rect width="200" height="100" fill="var(--surface)" rx="4" />
        <g transform={() => `rotate(${angle()}, 100, 50)`}>
          <circle cx="100" cy="50" r="30" fill="none" stroke="var(--accent)" stroke-width="2" />
          <line x1="100" y1="20" x2="100" y2="50" stroke="var(--accent)" stroke-width="2" />
        </g>
        <foreignObject x="10" y="70" width="180" height="30">
          <div style="font-size:11px;color:var(--text);text-align:center">
            {() => label()}
          </div>
        </foreignObject>
      </svg>
    </div>
  );
}

// --- Test 58: Compiler — inline filter+map chain ---
function InlineFilterMapTest() {
  const items = signal([
    { id: 1, text: 'Apple', cat: 'fruit' },
    { id: 2, text: 'Carrot', cat: 'veggie' },
    { id: 3, text: 'Banana', cat: 'fruit' },
    { id: 4, text: 'Broccoli', cat: 'veggie' },
    { id: 5, text: 'Cherry', cat: 'fruit' },
  ], 'filterItems');
  const showCat = signal('all', 'showCat');

  const filtered = computed(() => {
    const c = showCat();
    return c === 'all' ? items() : items().filter(i => i.cat === c);
  });

  return (
    <div class="section">
      <h2>Test 58: Computed Filter + mapArray</h2>
      <div class="flex">
        {['all', 'fruit', 'veggie'].map(c => (
          <button class={() => showCat() === c ? '' : 'ghost'} onClick={() => showCat(c)}>
            {c}
          </button>
        ))}
        <span class="text-muted">{() => filtered().length} shown</span>
      </div>
      <div class="mt">
        {mapArray(filtered, (item) => (
          <div class="flex" style="padding:2px 0">
            <span>{item.text}</span>
            <span class="badge" style={() => item.cat === 'fruit' ? 'background:#22c55e30;color:#22c55e' : 'background:#6366f130;color:#6366f1'}>
              {item.cat}
            </span>
            <button style="font-size:10px;padding:1px 4px"
              onClick={() => items(prev => prev.filter(i => i.id !== item.id))}>×</button>
          </div>
        ), { key: item => item.id, raw: true })}
      </div>
    </div>
  );
}

// --- App ---
function App() {
  return (
    <div>
      <h1>What Framework DX Testbed</h1>
      <Counter />
      <InputTest />
      <ConditionalTest />
      <TodoApp />
      <RefTest />
      <StyleTest />
      <TimerTest />
      <PropsTest />
      <ListTest />
      <NestedReactivity />
      <SpreadTest />
      <SvgTest />
      <BooleanAttrTest />
      <FragmentTest />
      <DeepPropTest />
      <ClassNameTest />
      <StressTest />
      <ComponentSwap />
      <CleanupTest />
      <FormTest />
      <BatchTest />
      <ErrorTest />
      <ControlFlowTest />
      <AsyncTest />
      <KeyedReorderTest />
      <InlineExprTest />
      <ForComponentTest />
      <ShowTest />
      <AutoMapTest />
      <EffectCleanupTest />
      <DiamondTest />
      <DynamicSwapTest />
      <ReactiveSvgTest />
      <UntrackTest />
      <NestedMapTest />
      <StyleObjectTest />
      <ComputedMemoTest />
      <EventModTest />
      <MiniAppTest />
      <EffectErrorTest />
      <AccessibilityTest />
      <DerivedChainTest />
      <PortalTest />
      <DeepNestTest />
      <UnkeyedListTest />
      <AsyncEffectTest />
      <FormValidationTest />
      <CompilerStressTest />
      <MountCycleTest />
      <SvgGradientTest />
      <InlineMapArrayTest />
      <SelectValueTest />
      <FormControlsTest />
      <AsyncAbortTest />
      <NestedTeardownTest />
      <KeyedSpliceTest />
      <SvgForeignObjectTest />
      <InlineFilterMapTest />
    </div>
  );
}

mount(<App />, '#app');
