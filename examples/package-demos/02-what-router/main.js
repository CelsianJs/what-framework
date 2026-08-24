import { mount, h } from 'what-core';
import { Router, NavLink, route, navigate } from 'what-router';

// Pages
function Home() {
  return h('div', { class: 'page' },
    h('h1', null, 'what-router'),
    h('p', { class: 'pkg' }, 'Client-side routing with dynamic params, nested layouts, and navigation.'),
    h('p', null, 'Navigate between pages using the links above. The URL changes, but no page reload happens.'),
    h('div', { class: 'card' },
      h('h3', null, 'Features'),
      h('p', null, '• Dynamic route params (/user/:id)'),
      h('p', null, '• Query string parsing'),
      h('p', null, '• Programmatic navigation'),
      h('p', null, '• NavLink with active class'),
    ),
  );
}

function About() {
  return h('div', { class: 'page' },
    h('h2', null, 'About'),
    h('p', null, 'This demo shows what-router handling client-side navigation without page reloads.'),
    h('p', null, 'Each route maps to a component function. The router swaps them reactively.'),
  );
}

const users = [
  { id: '1', name: 'Alice', role: 'Engineer' },
  { id: '2', name: 'Bob', role: 'Designer' },
  { id: '3', name: 'Charlie', role: 'PM' },
];

function Users() {
  return h('div', { class: 'page' },
    h('h2', null, 'Users'),
    h('p', null, 'Click a user to see dynamic route params in action:'),
    ...users.map(u =>
      h('div', { class: 'card' },
        h('h3', null, u.name),
        h('p', null, u.role),
        h('a', { href: `/users/${u.id}`, onclick: (e) => { e.preventDefault(); navigate(`/users/${u.id}`); } }, 'View profile →'),
      )
    ),
  );
}

function UserDetail() {
  const user = () => users.find(u => u.id === route.params().id);

  return h('div', { class: 'page' },
    h('h2', null, () => user() ? user().name : 'Not found'),
    () => user()
      ? h('div', null,
          h('p', null, () => `Role: ${user().role}`),
          h('p', null, h('span', { class: 'param' }, () => `Route param id = ${route.params().id}`)),
          h('button', {
            style: 'margin-top: 16px; padding: 8px 16px; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; color: #f0f0f0; cursor: pointer;',
            onclick: () => navigate('/users')
          }, '← Back to users'),
        )
      : h('p', null, 'User not found.'),
  );
}

function NotFound() {
  return h('div', { class: 'page' },
    h('h2', null, '404'),
    h('p', null, 'Page not found. Try the nav links above.'),
  );
}

// Nav layout
function Layout() {
  return h('div', null,
    h('nav', null,
      h(NavLink, { href: '/', activeClass: 'active' }, 'Home'),
      h(NavLink, { href: '/about', activeClass: 'active' }, 'About'),
      h(NavLink, { href: '/users', activeClass: 'active' }, 'Users'),
    ),
  );
}

// Routes
const routes = [
  { path: '/', component: Home },
  { path: '/about', component: About },
  { path: '/users', component: Users },
  { path: '/users/:id', component: UserDetail },
  { path: '*', component: NotFound },
];

function App() {
  return h('div', null,
    Layout(),
    h(Router, { routes }),
  );
}

mount(App, '#app');
console.log('✅ what-router demo running on port 4002');
