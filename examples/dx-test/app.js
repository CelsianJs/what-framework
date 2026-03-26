// DX Test App — exercises core What Framework h() API patterns
// Tests: useSignal, useComputed, lists, conditionals, store, useEffect, batch

import {
  h, mount,
  batch,
  createStore, derived,
  useSignal, useEffect, useRef, useComputed,
} from '../../packages/core/src/index.js';

// ==========================================
// Test 1: useSignal & useComputed
// ==========================================
// useSignal returns a signal. Read with sig(), write with sig.set().
// Components run ONCE — use reactive function children for dynamic content.
function TestState() {
  const count = useSignal(0);
  const doubled = useComputed(() => count() * 2);

  return h('section', null,
    h('h2', null, 'Test 1: useSignal & useComputed'),
    h('p', null, 'Count: ', () => count()),
    h('p', null, 'Doubled: ', () => doubled()),
    h('p', null, 'Status: ', () => count() > 5 ? 'High!' : 'Low'),
    h('button', { onClick: () => count.set(c => c + 1) }, 'Increment'),
    h('button', { onClick: () => count.set(0) }, 'Reset'),
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

  return h('section', null,
    h('h2', null, 'Test 2: List Rendering'),
    h('div', { style: 'display:flex;gap:8px;margin-bottom:12px' },
      h('input', {
        type: 'text',
        placeholder: 'New item...',
        value: () => newItem(),
        onInput: (e) => newItem.set(e.target.value),
        onKeydown: (e) => e.key === 'Enter' && addItem(),
      }),
      h('button', { onClick: addItem }, 'Add'),
    ),
    h('p', null, 'Items: ', () => items().length),
    () => items().map(item => h('div', {
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
// Use reactive function children for conditionals in run-once model.
function TestConditional() {
  const isLoggedIn = useSignal(false);
  const showDetails = useSignal(false);

  return h('section', null,
    h('h2', null, 'Test 3: Conditional Rendering'),
    h('button', {
      onClick: () => isLoggedIn.set(v => !v),
    }, () => isLoggedIn() ? 'Log Out' : 'Log In'),
    () => isLoggedIn()
      ? h('div', null,
          h('p', null, 'Welcome back!'),
          h('button', {
            onClick: () => showDetails.set(v => !v),
          }, () => showDetails() ? 'Hide Details' : 'Show Details'),
          () => showDetails()
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
    h('p', null, 'Theme: ', () => store.theme),
    h('p', null, 'Is Dark: ', () => String(store.isDark)),
    h('p', null, 'Notifications: ', () => store.notifications.length),
    h('button', { onClick: () => store.toggleTheme() }, 'Toggle Theme'),
    h('button', { onClick: () => store.addNotification('Hello at ' + new Date().toLocaleTimeString()) }, 'Add Notification'),
    h('button', { onClick: () => store.clearNotifications() }, 'Clear'),
    () => store.notifications.map(n =>
      h('div', { style: 'padding:2px 0;font-size:13px' }, n.message)
    ),
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

  return h('section', null,
    h('h2', null, 'Test 5: useEffect & useRef'),
    h('p', null, 'Timer: ', () => (timer() / 10).toFixed(1) + 's'),
    h('button', { onClick: () => running.set(r => !r) }, () => running() ? 'Stop' : 'Start'),
    h('button', { onClick: () => { timer.set(0); running.set(false); } }, 'Reset'),
  );
}

// ==========================================
// Test 6: useSignal & Batch
// ==========================================
// Read with sig(), write with sig.set(). batch() groups writes.
function TestBatch() {
  const a = useSignal(0);
  const b = useSignal(0);

  return h('section', null,
    h('h2', null, 'Test 6: useSignal & Batch'),
    h('p', null, () => `A: ${a()} + B: ${b()} = ${a() + b()}`),
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
    h('p', { style: 'color:gray' }, 'Testing core patterns with the h() API'),
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
