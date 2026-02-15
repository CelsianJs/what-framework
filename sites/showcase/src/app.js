// Flux — What Framework Showcase App
import {
  h, mount, signal, computed, effect, batch,
  useState, useEffect, useRef,
  createContext, useContext,
  createStore, derived,
  announce,
  useLocalStorage,
} from '@what/core';
import { Router, Link, defineRoutes, route, navigate, useRoute } from '@what/router';

import { Dashboard } from './pages/dashboard.js';
import { Projects } from './pages/projects.js';
import { Team } from './pages/team.js';
import { Settings } from './pages/settings.js';

// ─── Global App Store ───
export const useAppStore = createStore({
  theme: 'dark',
  sidebarOpen: true,
  commandPaletteOpen: false,
  notifications: [],

  // Derived
  isDark: derived(state => state.theme === 'dark'),

  // Actions
  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
  },
  setTheme(t) {
    this.theme = t;
  },
  toggleSidebar() {
    this.sidebarOpen = !this.sidebarOpen;
  },
  openCommandPalette() {
    this.commandPaletteOpen = true;
  },
  closeCommandPalette() {
    this.commandPaletteOpen = false;
  },
  addNotification(msg, type = 'info') {
    const id = Date.now();
    this.notifications = [...this.notifications, { id, msg, type }];
    announce(msg);
    setTimeout(() => {
      this.notifications = this.notifications.filter(n => n.id !== id);
    }, 3000);
  },
});

// ─── Nav Items ───
const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: 'grid' },
  { href: '/projects', label: 'Projects', icon: 'kanban' },
  { href: '/team', label: 'Team', icon: 'people' },
  { href: '/settings', label: 'Settings', icon: 'gear' },
];

// ─── SVG Icons (inline for zero deps) ───
function Icon({ name, size = 16 }) {
  const icons = {
    grid: `<rect x="3" y="3" width="4" height="4" rx="1"/><rect x="9" y="3" width="4" height="4" rx="1"/><rect x="3" y="9" width="4" height="4" rx="1"/><rect x="9" y="9" width="4" height="4" rx="1"/>`,
    kanban: `<rect x="3" y="3" width="3" height="10" rx="1"/><rect x="8" y="3" width="3" height="6" rx="1"/><rect x="13" y="3" width="3" height="8" rx="1"/>`,
    people: `<circle cx="8" cy="5" r="2.5"/><path d="M3 14c0-2.8 2.2-5 5-5s5 2.2 5 5"/><circle cx="14" cy="6" r="2"/><path d="M16 14c0-1.7-1-3.2-2.5-3.8"/>`,
    gear: `<circle cx="8" cy="8" r="2.5"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M2.9 2.9l1.4 1.4m7.4 7.4l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"/>`,
    search: `<circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="15" y2="15"/>`,
    bell: `<path d="M8 2a4 4 0 014 4c0 4 2 5 2 5H2s2-1 2-5a4 4 0 014-4zm-1 12h2"/>`,
    plus: `<line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/>`,
    moon: `<path d="M14 10A7 7 0 016 2a7 7 0 108 8z"/>`,
    sun: `<circle cx="8" cy="8" r="3"/><path d="M8 1v2m0 10v2M1 8h2m10 0h2M2.9 2.9l1.4 1.4m7.4 7.4l1.4 1.4M13.1 2.9l-1.4 1.4M4.3 11.7l-1.4 1.4"/>`,
  };

  return h('svg', {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: 'sidebar-icon',
    dangerouslySetInnerHTML: { __html: icons[name] || '' },
  });
}

// ─── Command Palette ───
function CommandPalette() {
  const store = useAppStore();
  const [query, setQuery] = useState('');
  const [focusIdx, setFocusIdx] = useState(0);
  const inputRef = useRef(null);

  const commands = [
    { label: 'Go to Dashboard', shortcut: 'G D', action: () => navigate('/') },
    { label: 'Go to Projects', shortcut: 'G P', action: () => navigate('/projects') },
    { label: 'Go to Team', shortcut: 'G T', action: () => navigate('/team') },
    { label: 'Go to Settings', shortcut: 'G S', action: () => navigate('/settings') },
    { label: 'Toggle Theme', shortcut: 'T T', action: () => store.toggleTheme() },
    { label: 'Add New Task', shortcut: 'N T', action: () => { navigate('/projects'); store.addNotification('New task created', 'success'); } },
  ];

  const filtered = () => {
    const q = query.toLowerCase();
    return q ? commands.filter(c => c.label.toLowerCase().includes(q)) : commands;
  };

  const isOpen = store.commandPaletteOpen;

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    setQuery('');
    setFocusIdx(0);
  }, [isOpen]);

  const run = (cmd) => {
    store.closeCommandPalette();
    cmd.action();
  };

  const handleKeyDown = (e) => {
    const items = filtered();
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(i + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && items[focusIdx]) { run(items[focusIdx]); }
    if (e.key === 'Escape') { store.closeCommandPalette(); }
  };

  const filteredItems = filtered();

  return store.commandPaletteOpen
    ? h('div', {
        class: 'cmd-overlay',
        onClick: (e) => e.target === e.currentTarget && store.closeCommandPalette(),
        onKeyDown: handleKeyDown,
      },
        h('div', { class: 'cmd-palette', role: 'dialog', 'aria-label': 'Command palette' },
          h('div', { class: 'cmd-input' },
            h(Icon, { name: 'search', size: 16 }),
            h('input', {
              ref: inputRef,
              placeholder: 'Type a command...',
              value: query,
              onInput: (e) => { setQuery(e.target.value); setFocusIdx(0); },
            }),
          ),
          h('div', { class: 'cmd-results' },
            ...filteredItems.map((cmd, i) =>
              h('div', {
                class: `cmd-item${i === focusIdx ? ' focused' : ''}`,
                onClick: () => run(cmd),
                onMouseEnter: () => setFocusIdx(i),
              },
                h('span', { class: 'cmd-item-label' }, cmd.label),
                h('span', { class: 'cmd-item-shortcut' }, cmd.shortcut),
              )
            ),
          ),
          h('div', { class: 'cmd-footer' },
            h('span', null, h('kbd', null, '↑↓'), ' navigate'),
            h('span', null, h('kbd', null, '↵'), ' select'),
            h('span', null, h('kbd', null, 'esc'), ' close'),
          ),
        ),
      )
    : null;
}

// ─── Toast Notifications ───
function Toasts() {
  const store = useAppStore();

  return h('div', { class: 'toast-container', 'aria-live': 'polite' },
    ...store.notifications.map(n =>
      h('div', { key: n.id, class: 'toast' },
        h('span', { class: `toast-dot ${n.type}` }),
        h('span', null, n.msg),
      )
    ),
  );
}

// ─── Sidebar ───
function Sidebar() {
  const store = useAppStore();

  return h('aside', { class: 'sidebar' },
    // Header
    h('div', { class: 'sidebar-header' },
      h('div', { class: 'sidebar-logo' }, 'F'),
      h('span', { class: 'sidebar-title' }, 'Flux'),
      h('span', { class: 'sidebar-badge' }, 'What.js'),
    ),

    // Navigation
    h('nav', { class: 'sidebar-nav' },
      h('div', { class: 'sidebar-section' },
        h('div', { class: 'sidebar-section-title' }, 'Navigation'),
        ...NAV_ITEMS.map(item =>
          h(Link, {
            href: item.href,
            class: `sidebar-link${route.path === item.href || (item.href !== '/' && route.path.startsWith(item.href)) ? ' active' : ''}`,
          },
            h(Icon, { name: item.icon }),
            item.label,
            item.href === '/projects' ? h('span', { class: 'sidebar-count' }, '12') : null,
          )
        ),
      ),

      // Quick actions section
      h('div', { class: 'sidebar-section' },
        h('div', { class: 'sidebar-section-title' }, 'Quick Actions'),
        h('button', {
          class: 'sidebar-link',
          style: { width: '100%', border: 'none', background: 'none', textAlign: 'left', cursor: 'pointer', color: 'var(--text-secondary)', font: 'inherit' },
          onClick: () => store.openCommandPalette(),
        },
          h(Icon, { name: 'search' }),
          'Search',
          h('span', { class: 'sidebar-count', style: { fontFamily: 'var(--font-mono)', fontSize: '10px' } }, '⌘K'),
        ),
      ),
    ),

    // Footer
    h('div', { class: 'sidebar-footer' },
      h('div', { class: 'sidebar-avatar' }, 'EV'),
      h('div', { class: 'sidebar-user' },
        h('div', { class: 'sidebar-user-name' }, 'Elena Vasquez'),
        h('div', { class: 'sidebar-user-role' }, 'Lead Engineer'),
      ),
    ),
  );
}

// ─── Header ───
function Header() {
  const store = useAppStore();
  const { path } = useRoute();

  const p = path();
  const pageTitle = p === '/' ? 'Dashboard'
    : p === '/projects' ? 'Projects'
    : p === '/team' ? 'Team'
    : p === '/settings' ? 'Settings'
    : 'Flux';

  return h('header', { class: 'main-header' },
    h('div', { class: 'main-header-left' },
      h('h1', null, pageTitle),
    ),
    h('div', { class: 'main-header-right' },
      h('button', {
        class: 'btn btn-ghost btn-icon',
        onClick: () => store.openCommandPalette(),
        title: 'Search (⌘K)',
        'aria-label': 'Open command palette',
      }, h(Icon, { name: 'search' })),
      h('button', {
        class: 'btn btn-ghost btn-icon',
        onClick: () => { store.toggleTheme(); store.addNotification(`Switched to ${store.isDark ? 'light' : 'dark'} theme`, 'info'); },
        title: 'Toggle theme',
        'aria-label': 'Toggle theme',
      }, h(Icon, { name: store.isDark ? 'moon' : 'sun' })),
    ),
  );
}

// ─── Layout ───
function Shell({ children }) {
  const store = useAppStore();

  // Apply theme to document
  const theme = store.theme;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Keyboard shortcut: Cmd+K for command palette
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (store.commandPaletteOpen) {
          store.closeCommandPalette();
        } else {
          store.openCommandPalette();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return h('div', { class: 'app-layout' },
    h(Sidebar),
    h('div', { class: 'main-area' },
      h(Header),
      h('main', { class: 'main-content' }, children),
    ),
    h(CommandPalette),
    h(Toasts),
  );
}

// ─── Routes ───
const routes = defineRoutes({
  '/': { component: Dashboard, layout: Shell },
  '/projects': { component: Projects, layout: Shell },
  '/team': { component: Team, layout: Shell },
  '/settings': { component: Settings, layout: Shell },
});

function NotFound() {
  return h('div', { class: 'empty-state' },
    h('div', { class: 'empty-state-icon' }, '404'),
    h('div', { class: 'empty-state-title' }, 'Page not found'),
    h('div', { class: 'empty-state-desc' }, 'The page you\'re looking for doesn\'t exist.'),
    h('div', { class: 'mt-4' },
      h(Link, { href: '/', class: 'btn btn-primary' }, 'Back to Dashboard'),
    ),
  );
}

function App() {
  return h(Router, { routes, fallback: NotFound });
}

mount(h(App), '#app');
