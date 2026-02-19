/**
 * Test: React Router v6 inside What Framework
 *
 * React Router tests:
 * - createBrowserRouter / RouterProvider
 * - useNavigate, useParams, useLocation, useSearchParams
 * - Nested routes with Outlet
 * - Context propagation through route tree
 * - useSyncExternalStore for history state
 *
 * We use MemoryRouter here since we're embedded in a test page.
 */
import { useState } from 'react';
import {
  MemoryRouter,
  Routes,
  Route,
  Link,
  Outlet,
  useParams,
  useLocation,
  useNavigate,
} from 'react-router-dom';

function Layout() {
  const location = useLocation();

  return (
    <div>
      <nav style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
        <Link
          to="/"
          style={{
            color: location.pathname === '/' ? '#6366f1' : '#333',
            fontWeight: location.pathname === '/' ? 'bold' : 'normal',
            textDecoration: 'none',
          }}
        >
          Home
        </Link>
        <Link
          to="/about"
          style={{
            color: location.pathname === '/about' ? '#6366f1' : '#333',
            fontWeight: location.pathname === '/about' ? 'bold' : 'normal',
            textDecoration: 'none',
          }}
        >
          About
        </Link>
        <Link
          to="/users/42"
          style={{
            color: location.pathname.startsWith('/users') ? '#6366f1' : '#333',
            fontWeight: location.pathname.startsWith('/users') ? 'bold' : 'normal',
            textDecoration: 'none',
          }}
        >
          User 42
        </Link>
      </nav>
      <div
        style={{
          padding: '12px',
          border: '1px solid #eee',
          borderRadius: '6px',
          background: '#fafafa',
          minHeight: '60px',
        }}
      >
        <Outlet />
      </div>
      <p
        style={{ fontSize: '12px', color: '#888', marginTop: '8px' }}
      >
        Current path: {location.pathname}
      </p>
    </div>
  );
}

function Home() {
  return <div><strong>Home Page</strong><p>Welcome to the router test.</p></div>;
}

function About() {
  const navigate = useNavigate();
  return (
    <div>
      <strong>About Page</strong>
      <p>Testing useNavigate:</p>
      <button
        onclick={() => navigate('/users/99')}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          border: '1px solid #ccc',
          background: '#f5f5f5',
          cursor: 'pointer',
        }}
      >
        Go to User 99
      </button>
    </div>
  );
}

function UserProfile() {
  const { userId } = useParams();
  const navigate = useNavigate();

  return (
    <div>
      <strong>User Profile</strong>
      <p>User ID: <code>{userId}</code></p>
      <button
        onclick={() => navigate('/')}
        style={{
          padding: '4px 12px',
          borderRadius: '4px',
          border: '1px solid #ccc',
          background: '#f5f5f5',
          cursor: 'pointer',
        }}
      >
        Back to Home
      </button>
    </div>
  );
}

export function RouterTest() {
  return (
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="about" element={<About />} />
          <Route path="users/:userId" element={<UserProfile />} />
        </Route>
      </Routes>
      <p style={{ color: 'green' }} id="router-status">React Router loaded OK</p>
    </MemoryRouter>
  );
}
