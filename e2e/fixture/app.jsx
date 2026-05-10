import { signal, computed, effect, batch, h, mount, ErrorBoundary } from 'what-core';
import { Router, Link, navigate, route, isSafeUrl } from 'what-router';

// === Shared state (module-scope signals) ===
const count = signal(0, 'count');
const name = signal('World', 'name');
const items = signal([
  { id: 1, text: 'First item' },
  { id: 2, text: 'Second item' },
  { id: 3, text: 'Third item' },
], 'items');

// === Derived state ===
const doubled = computed(() => count() * 2);
const itemCount = computed(() => items().length);

// === Counter Component ===
function Counter() {
  return h('div', { 'data-testid': 'counter' },
    h('h2', {}, 'Counter'),
    h('p', { 'data-testid': 'count-display' }, () => `Count: ${count()}`),
    h('p', { 'data-testid': 'doubled-display' }, () => `Doubled: ${doubled()}`),
    h('button', { 'data-testid': 'increment-btn', onclick: () => count(c => c + 1) }, 'Increment'),
    h('button', { 'data-testid': 'decrement-btn', onclick: () => count(c => c - 1) }, 'Decrement'),
    h('button', { 'data-testid': 'reset-btn', onclick: () => count(0) }, 'Reset'),
  );
}

// === Greeting Component (reactive text binding) ===
function Greeting() {
  return h('div', { 'data-testid': 'greeting' },
    h('h2', {}, 'Greeting'),
    h('p', { 'data-testid': 'greeting-text' }, () => `Hello, ${name()}!`),
    h('input', {
      'data-testid': 'name-input',
      type: 'text',
      value: name(),
      oninput: (e) => name(e.target.value),
    }),
  );
}

// === List Component ===
function ItemList() {
  const newItemText = signal('', 'newItemText');

  function addItem() {
    const text = newItemText().trim();
    if (!text) return;
    items(prev => [...prev, { id: Date.now(), text }]);
    newItemText('');
  }

  function removeItem(id) {
    items(prev => prev.filter(item => item.id !== id));
  }

  return h('div', { 'data-testid': 'item-list' },
    h('h2', {}, 'Items'),
    h('p', { 'data-testid': 'item-count' }, () => `${itemCount()} items`),
    h('div', {},
      h('input', {
        'data-testid': 'new-item-input',
        type: 'text',
        placeholder: 'New item...',
        value: newItemText(),
        oninput: (e) => newItemText(e.target.value),
        onkeydown: (e) => e.key === 'Enter' && addItem(),
      }),
      h('button', { 'data-testid': 'add-item-btn', onclick: addItem }, 'Add'),
    ),
    h('ul', { 'data-testid': 'items-ul' },
      () => items().map(item =>
        h('li', { key: item.id, 'data-testid': `item-${item.id}` },
          h('span', {}, item.text),
          h('button', {
            'data-testid': `remove-${item.id}`,
            onclick: () => removeItem(item.id),
          }, 'x'),
        )
      ),
    ),
  );
}

// === Batch Update Component ===
function BatchUpdater() {
  const a = signal(0, 'batchA');
  const b = signal(0, 'batchB');
  const sum = computed(() => a() + b());

  return h('div', { 'data-testid': 'batch-updater' },
    h('h2', {}, 'Batch Updates'),
    h('p', { 'data-testid': 'batch-sum' }, () => `Sum: ${sum()}`),
    h('button', {
      'data-testid': 'batch-btn',
      onclick: () => batch(() => { a(10); b(20); }),
    }, 'Set A=10, B=20'),
  );
}

// === Error Boundary Test ===
// Tests TWO scenarios:
// 1. A boundary that catches an error during initial render (always-broken component)
// 2. A boundary that renders children successfully (no error)

function BrokenComponent() {
  throw new Error('Intentional render error for testing');
}

function ErrorFallback({ error }) {
  return h('div', { 'data-testid': 'error-fallback', class: 'error-display' },
    h('p', {}, 'Something went wrong:'),
    h('p', { 'data-testid': 'error-message' }, () => error?.message || 'Unknown error'),
  );
}

function ErrorBoundaryTest() {
  return h('div', { 'data-testid': 'error-boundary-test' },
    h('h2', {}, 'Error Boundary'),
    // Boundary with a working child — should show the child
    h(ErrorBoundary, { fallback: ErrorFallback },
      h('p', { 'data-testid': 'no-error' }, 'No error yet'),
    ),
    // Boundary with a broken child — should show fallback
    h(ErrorBoundary, { fallback: ErrorFallback },
      h(BrokenComponent, {}),
    ),
  );
}

// === Route pages ===
function HomePage() {
  return h('div', { 'data-testid': 'home-page' },
    h('h1', {}, 'Home'),
    h('p', {}, 'Welcome to the E2E test fixture.'),
    h(Counter, {}),
    h(Greeting, {}),
    h(ItemList, {}),
    h(BatchUpdater, {}),
    h(ErrorBoundaryTest, {}),
  );
}

function AboutPage() {
  return h('div', { 'data-testid': 'about-page' },
    h('h1', {}, 'About'),
    h('p', {}, 'This is the about page.'),
  );
}

function UserPage({ params }) {
  return h('div', { 'data-testid': 'user-page' },
    h('h1', {}, () => `User: ${params?.id || 'unknown'}`),
    h('p', { 'data-testid': 'user-id' }, () => params?.id || 'none'),
  );
}

function NotFoundPage() {
  return h('div', { 'data-testid': 'not-found-page' },
    h('h1', {}, '404'),
    h('p', {}, 'Page not found.'),
  );
}

// === Navigation ===
function Nav() {
  return h('nav', { 'data-testid': 'nav' },
    h(Link, { href: '/', 'data-testid': 'nav-home' }, 'Home'),
    h(Link, { href: '/about', 'data-testid': 'nav-about' }, 'About'),
    h(Link, { href: '/users/42', 'data-testid': 'nav-user' }, 'User 42'),
  );
}

// === App Root ===
const routes = [
  { path: '/', component: HomePage },
  { path: '/about', component: AboutPage },
  { path: '/users/:id', component: UserPage },
];

function App() {
  return h('div', { id: 'app-root' },
    h(Nav, {}),
    h('main', { 'data-testid': 'main-content' },
      Router({ routes, fallback: NotFoundPage }),
    ),
  );
}

mount(h(App, {}), '#app');

// Expose for test assertions
window.__TEST_SIGNALS__ = { count, name, items, doubled, itemCount };
window.__TEST_NAVIGATE__ = navigate;
window.__TEST_ROUTE__ = route;
window.__TEST_IS_SAFE_URL__ = isSafeUrl;
