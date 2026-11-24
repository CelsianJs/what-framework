import { useState } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';

function Layout() {
  const location = useLocation();
  const [n, setN] = useState(0);
  return (
    <div>
      <NavLink id="rd-home" to="/" end className={({ isActive }) => (isActive ? 'on' : 'off')}>Home</NavLink>
      <NavLink id="rd-items" to="/items" className={({ isActive }) => (isActive ? 'on' : 'off')}>Items</NavLink>
      <Link id="rd-old" to="/old">Old</Link>
      <span id="rd-path">{location.pathname}</span>
      <button id="rd-n" onClick={() => setN(n + 1)}>{n}</button>
      <Outlet />
    </div>
  );
}

function Items() {
  const navigate = useNavigate();
  return (
    <div>
      <h1 id="rd-page">items</h1>
      <Link id="rd-item-7" to="/items/7" state={{ from: 'list' }}>seven</Link>
      <button id="rd-go" onClick={() => navigate('/items/9', { replace: true })}>nine</button>
    </div>
  );
}

function Item() {
  const { id } = useParams();
  const location = useLocation();
  return <h1 id="rd-page">item {id} from {location.state?.from ?? 'nowhere'}</h1>;
}

export default function Fixture() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<h1 id="rd-page">home</h1>} />
          <Route path="items" element={<Items />} />
          <Route path="items/:id" element={<Item />} />
          <Route path="old" element={<Navigate to="/items" replace />} />
          <Route path="*" element={<h1 id="rd-page">not found</h1>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
