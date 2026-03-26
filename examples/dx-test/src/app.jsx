// DX Test App — exercises core What Framework patterns with JSX
// Tests: useSignal, useComputed, lists, conditionals, store, useEffect, batch

import {
  mount, batch,
  createStore, derived,
  useSignal, useEffect, useRef, useComputed,
} from 'what-framework';

// ==========================================
// Test 1: useSignal & useComputed
// ==========================================
// useSignal returns a signal. Read with sig(), write with sig.set().
// Components run ONCE — use reactive function children for dynamic content.
function TestState() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return (
    <section>
      <h2>Test 1: useSignal & useComputed</h2>
      <p>Count: {() => count()}</p>
      <p>Doubled: {() => doubled()}</p>
      <p>Status: {() => count() > 5 ? 'High!' : 'Low'}</p>
      <button onClick={() => count.set(c => c + 1)}>Increment</button>
      <button onClick={() => count.set(0)}>Reset</button>
    </section>
  );
}

// ==========================================
// Test 2: List Rendering
// ==========================================
// Use reactive function children with .map() for lists.
function TestList() {
  const items = useSignal([
    { id: 1, text: 'Learn What Framework' },
    { id: 2, text: 'Build something cool' },
    { id: 3, text: 'Ship it' },
  ]);
  const newItem = useSignal('');
  const nextIdRef = useRef(4);

  const addItem = () => {
    const text = newItem.peek();
    if (!text.trim()) return;
    items.set(prev => [...prev, { id: nextIdRef.current++, text }]);
    newItem.set('');
  };

  const removeItem = (id) => {
    items.set(prev => prev.filter(item => item.id !== id));
  };

  return (
    <section>
      <h2>Test 2: List Rendering</h2>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input
          type="text"
          placeholder="New item..."
          value={() => newItem()}
          onInput={(e) => newItem.set(e.target.value)}
          onKeydown={(e) => e.key === 'Enter' && addItem()}
        />
        <button onClick={addItem}>Add</button>
      </div>
      <p>Items: {() => items().length}</p>
      {() => items().map(item => (
        <div
          key={item.id}
          style="display:flex;gap:8px;align-items:center;padding:4px 0"
        >
          <span>{item.text}</span>
          <button
            onClick={() => removeItem(item.id)}
            style="font-size:12px"
          >x</button>
        </div>
      ))}
    </section>
  );
}

// ==========================================
// Test 3: Conditional Rendering
// ==========================================
// Use reactive function children for conditionals in run-once model.
function TestConditional() {
  const isLoggedIn = useSignal(false);
  const showDetails = useSignal(false);

  return (
    <section>
      <h2>Test 3: Conditional Rendering</h2>
      <button onClick={() => isLoggedIn.set(v => !v)}>
        {() => isLoggedIn() ? 'Log Out' : 'Log In'}
      </button>
      {() => isLoggedIn()
        ? (
          <div>
            <p>Welcome back!</p>
            <button onClick={() => showDetails.set(v => !v)}>
              {() => showDetails() ? 'Hide Details' : 'Show Details'}
            </button>
            {() => showDetails()
              ? <p style="color:green">Here are your secret details...</p>
              : null}
          </div>
        )
        : <p style="color:gray">Please log in to continue.</p>
      }
    </section>
  );
}

// ==========================================
// Test 4: Store (Global State)
// ==========================================
// createStore takes one definition object. Actions use `this` (proxy).
// Returns a hook-like function.
const useAppStore = createStore({
  theme: 'light',
  notifications: [],
  isDark: derived(state => state.theme === 'dark'),
  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
  },
  addNotification(message) {
    this.notifications = [...this.notifications, { id: Date.now(), message }];
  },
  clearNotifications() {
    this.notifications = [];
  },
});

function TestStore() {
  const store = useAppStore();

  return (
    <section>
      <h2>Test 4: Store (Global State)</h2>
      <p>Theme: {() => store.theme}</p>
      <p>Is Dark: {() => String(store.isDark)}</p>
      <p>Notifications: {() => store.notifications.length}</p>
      <button onClick={() => store.toggleTheme()}>Toggle Theme</button>
      <button onClick={() => store.addNotification('Hello at ' + new Date().toLocaleTimeString())}>
        Add Notification
      </button>
      <button onClick={() => store.clearNotifications()}>Clear</button>
      {() => store.notifications.map(n => (
        <div style="padding:2px 0;font-size:13px">{n.message}</div>
      ))}
    </section>
  );
}

// ==========================================
// Test 5: useEffect & useRef (Timer)
// ==========================================
// useSignal returns a signal. useEffect runs side effects.
function TestHooks() {
  const timer = useSignal(0);
  const running = useSignal(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running()) {
      intervalRef.current = setInterval(() => {
        timer.set(t => t + 1);
      }, 100);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running()]);

  return (
    <section>
      <h2>Test 5: useEffect & useRef</h2>
      <p>Timer: {() => (timer() / 10).toFixed(1) + 's'}</p>
      <button onClick={() => running.set(r => !r)}>
        {() => running() ? 'Stop' : 'Start'}
      </button>
      <button onClick={() => { timer.set(0); running.set(false); }}>Reset</button>
    </section>
  );
}

// ==========================================
// Test 6: useSignal & Batch
// ==========================================
// Read with sig(), write with sig.set(). batch() groups writes.
function TestBatch() {
  const a = useSignal(0);
  const b = useSignal(0);

  return (
    <section>
      <h2>Test 6: useSignal & Batch</h2>
      <p>{() => `A: ${a()} + B: ${b()} = ${a() + b()}`}</p>
      <button onClick={() => {
        a.set(v => v + 1);
        b.set(v => v + 1);
      }}>
        Increment Both (unbatched)
      </button>
      <button onClick={() => {
        batch(() => {
          a.set(v => v + 1);
          b.set(v => v + 1);
        });
      }}>
        Increment Both (batched)
      </button>
    </section>
  );
}

// ==========================================
// App Shell
// ==========================================
function App() {
  return (
    <div style="max-width:600px;margin:0 auto;padding:20px;font-family:system-ui">
      <h1>What Framework DX Test</h1>
      <p style="color:gray">Testing core patterns with JSX</p>
      <hr />
      <TestState />
      <hr />
      <TestList />
      <hr />
      <TestConditional />
      <hr />
      <TestStore />
      <hr />
      <TestHooks />
      <hr />
      <TestBatch />
    </div>
  );
}

// Mount the app
mount(<App />, '#app');
