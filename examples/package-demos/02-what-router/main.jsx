// what-router demo — Client-side routing with JSX
// Demonstrates: Router, NavLink, route params, programmatic navigation

import { mount } from 'what-core';
import { Router, NavLink, route, navigate } from 'what-router';

// Pages
function Home() {
  return (
    <div class="page">
      <h1>what-router</h1>
      <p class="pkg">Client-side routing with dynamic params, nested layouts, and navigation.</p>
      <p>Navigate between pages using the links above. The URL changes, but no page reload happens.</p>
      <div class="card">
        <h3>Features</h3>
        <p>Dynamic route params (/user/:id)</p>
        <p>Query string parsing</p>
        <p>Programmatic navigation</p>
        <p>NavLink with active class</p>
      </div>
    </div>
  );
}

function About() {
  return (
    <div class="page">
      <h2>About</h2>
      <p>This demo shows what-router handling client-side navigation without page reloads.</p>
      <p>Each route maps to a component function. The router swaps them reactively.</p>
    </div>
  );
}

const users = [
  { id: '1', name: 'Alice', role: 'Engineer' },
  { id: '2', name: 'Bob', role: 'Designer' },
  { id: '3', name: 'Charlie', role: 'PM' },
];

function Users() {
  return (
    <div class="page">
      <h2>Users</h2>
      <p>Click a user to see dynamic route params in action:</p>
      {users.map(u => (
        <div class="card">
          <h3>{u.name}</h3>
          <p>{u.role}</p>
          <a
            href={`/users/${u.id}`}
            onclick={(e) => { e.preventDefault(); navigate(`/users/${u.id}`); }}
          >View profile &rarr;</a>
        </div>
      ))}
    </div>
  );
}

function UserDetail() {
  const user = () => users.find(u => u.id === route.params().id);

  return (
    <div class="page">
      <h2>{() => user() ? user().name : 'Not found'}</h2>
      {() => user()
        ? (
          <div>
            <p>{() => `Role: ${user().role}`}</p>
            <p><span class="param">{() => `Route param id = ${route.params().id}`}</span></p>
            <button
              style="margin-top: 16px; padding: 8px 16px; border: 1px solid #333; border-radius: 6px; background: #1a1a1a; color: #f0f0f0; cursor: pointer;"
              onclick={() => navigate('/users')}
            >&larr; Back to users</button>
          </div>
        )
        : <p>User not found.</p>
      }
    </div>
  );
}

function NotFound() {
  return (
    <div class="page">
      <h2>404</h2>
      <p>Page not found. Try the nav links above.</p>
    </div>
  );
}

// Nav layout
function Layout() {
  return (
    <div>
      <nav>
        <NavLink href="/" activeClass="active">Home</NavLink>
        <NavLink href="/about" activeClass="active">About</NavLink>
        <NavLink href="/users" activeClass="active">Users</NavLink>
      </nav>
    </div>
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
  return (
    <div>
      <Layout />
      <Router routes={routes} />
    </div>
  );
}

mount(<App />, '#app');
console.log('what-router demo running');
