// DX Test App — exercises core What Framework h() VDOM API patterns
// Tests: useState, useMemo, lists, conditionals, store, useEffect, useSignal, batch

import {
  h, mount,
  batch,
  createStore, derived,
  useState, useSignal, useEffect, useRef, useMemo,
} from '../../packages/core/src/index.js';

// ==========================================
// Test 1: useState & useMemo
// ==========================================
// useState returns [value, setter] — plain values, not signals.
// The component re-renders via effect when state changes.
function TestState() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);
  const message = count > 5 ? 'High!' : 'Low';

  return h('section', null,
    h('h2', null, 'Test 1: useState & useMemo'),
    h('p', null, 'Count: ', count),
    h('p', null, 'Doubled: ', doubled),
    h('p', null, 'Status: ', message),
    h('button', { onClick: () => setCount(c => c + 1) }, 'Increment'),
    h('button', { onClick: () => setCount(0) }, 'Reset'),
  );
}

// ==========================================
// Test 2: List Rendering
// ==========================================
// Use .map() for lists — the reconciler handles keyed updates.
function TestList() {
  const [items, setItems] = useState([
    { id: 1, text: 'Learn What Framework' },
    { id: 2, text: 'Build something cool' },
    { id: 3, text: 'Ship it' },
  ]);
  const [newItem, setNewItem] = useState('');
  const nextIdRef = useRef(4);

  const addItem = () => {
    if (!newItem.trim()) return;
    setItems(prev => [...prev, { id: nextIdRef.current++, text: newItem }]);
    setNewItem('');
  };

  const removeItem = (id) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  return h('section', null,
    h('h2', null, 'Test 2: List Rendering'),
    h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' },
      h('input', {
        type: 'text',
        placeholder: 'New item...',
        value: newItem,
        onInput: (e) => setNewItem(e.target.value),
        onKeydown: (e) => e.key === 'Enter' && addItem(),
      }),
      h('button', { onClick: addItem }, 'Add'),
    ),
    h('p', null, 'Items: ', items.length),
    ...items.map(item => h('div', {
      key: item.id,
      style: 'display:flex;gap:8px;align-items:center;padding:4px 0',
    },
      h('span', null, item.text),
      h('button', {
        onClick: () => removeItem(item.id),
        style: 'font-size:12px',
      }, 'x'),
    )),
  );
}

// ==========================================
// Test 3: Conditional Rendering
// ==========================================
// Plain ternaries work — component re-renders produce new vnodes.
function TestConditional() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  return h('section', null,
    h('h2', null, 'Test 3: Conditional Rendering'),
    h('button', {
      onClick: () => setIsLoggedIn(v => !v),
    }, isLoggedIn ? 'Log Out' : 'Log In'),
    isLoggedIn
      ? h('div', null,
          h('p', null, 'Welcome back!'),
          h('button', {
            onClick: () => setShowDetails(v => !v),
          }, showDetails ? 'Hide Details' : 'Show Details'),
          showDetails
            ? h('p', { style: 'color:green' }, 'Here are your secret details...')
            : null,
        )
      : h('p', { style: 'color:gray' }, 'Please log in to continue.'),
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

  return h('section', null,
    h('h2', null, 'Test 4: Store (Global State)'),
    h('p', null, 'Theme: ', store.theme),
    h('p', null, 'Is Dark: ', String(store.isDark)),
    h('p', null, 'Notifications: ', store.notifications.length),
    h('button', { onClick: () => store.toggleTheme() }, 'Toggle Theme'),
    h('button', { onClick: () => store.addNotification('Hello at ' + new Date().toLocaleTimeString()) }, 'Add Notification'),
    h('button', { onClick: () => store.clearNotifications() }, 'Clear'),
    ...store.notifications.map(n =>
      h('div', { style: 'padding:2px 0;font-size:13px' }, n.message)
    ),
  );
}

// ==========================================
// Test 5: useEffect & useRef (Timer)
// ==========================================
// useState values are plain — no () to call them.
// useEffect deps are plain values — comparison works naturally.
function TestHooks() {
  const [timer, setTimer] = useState(0);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setTimer(t => t + 1);
      }, 100);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  return h('section', null,
    h('h2', null, 'Test 5: useEffect & useRef'),
    h('p', null, 'Timer: ', (timer / 10).toFixed(1), 's'),
    h('button', { onClick: () => setRunning(r => !r) }, running ? 'Stop' : 'Start'),
    h('button', { onClick: () => { setTimer(0); setRunning(false); } }, 'Reset'),
  );
}

// ==========================================
// Test 6: useSignal & Batch
// ==========================================
// useSignal returns a raw signal (persists across re-renders).
// Read with sig(), write with sig.set(). batch() groups writes.
function TestBatch() {
  const a = useSignal(0);
  const b = useSignal(0);
  const renderCountRef = useRef(0);
  renderCountRef.current++;

  const aVal = a();
  const bVal = b();
  const sum = aVal + bVal;

  return h('section', null,
    h('h2', null, 'Test 6: useSignal & Batch'),
    h('p', null, 'A: ', aVal, ' + B: ', bVal, ' = ', sum),
    h('p', { style: 'font-size:13px;color:gray' }, 'Render count: ', renderCountRef.current),
    h('button', {
      onClick: () => {
        a.set(v => v + 1);
        b.set(v => v + 1);
      }
    }, 'Increment Both (unbatched)'),
    h('button', {
      onClick: () => {
        batch(() => {
          a.set(v => v + 1);
          b.set(v => v + 1);
        });
      }
    }, 'Increment Both (batched)'),
  );
}

// ==========================================
// App Shell
// ==========================================
function App() {
  return h('div', { style: 'max-width:600px;margin:0 auto;padding:20px;font-family:system-ui' },
    h('h1', null, 'What Framework DX Test'),
    h('p', { style: 'color:gray' }, 'Testing core patterns with the h() VDOM API'),
    h('hr', null),
    h(TestState),
    h('hr', null),
    h(TestList),
    h('hr', null),
    h(TestConditional),
    h('hr', null),
    h(TestStore),
    h('hr', null),
    h(TestHooks),
    h('hr', null),
    h(TestBatch),
  );
}

// Mount — h(App) creates a vnode, mount expects a vnode not a bare function
mount(h(App), document.getElementById('app'));
