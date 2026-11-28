import { useState } from 'react';
import {
  Form, Link, NavLink, Outlet, RouterProvider, createBrowserRouter, useActionData, useLoaderData, useNavigate,
  useNavigation, useParams, useRouteError, useSearchParams,
} from 'react-router';

function Layout() {
  const navigation = useNavigation();
  const [clicks, setClicks] = useState(0);
  return (
    <div>
      <nav>
        <NavLink id="rr-home" to="/" end>Home</NavLink>
        <NavLink id="rr-users" to="/users">Users</NavLink>
        <NavLink id="rr-about" to="/about">About</NavLink>
        <Link id="rr-missing" to="/nope">Missing</Link>
      </nav>
      <button id="rr-layout-state" onClick={() => setClicks(clicks + 1)}>layout {clicks}</button>
      <span id="rr-nav-state">{navigation.state}</span>
      <Outlet />
    </div>
  );
}

function Users() {
  return (
    <section>
      <h1 id="rr-page">users</h1>
      <Link id="rr-user-1" to="/users/1">one</Link>
      <Link id="rr-user-2" to="2">two</Link>
      <Outlet />
    </section>
  );
}

function User() {
  const item = useLoaderData();
  const { id } = useParams();
  return <p id="rr-user">user {id}: {item}</p>;
}

function About() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const result = useActionData();
  return (
    <section>
      <h1 id="rr-page">about tab={params.get('tab') ?? 'none'}</h1>
      <button id="rr-tab" onClick={() => setParams({ tab: 'b' })}>tab b</button>
      <button id="rr-back" onClick={() => navigate(-1)}>back</button>
      <button id="rr-go" onClick={() => navigate('/users/1')}>go to user 1</button>
      <Form method="post">
        <input id="rr-name" name="name" />
        <button id="rr-send" type="submit">send</button>
      </Form>
      <span id="rr-action">{result ? result.greeting : ''}</span>
    </section>
  );
}

function Oops() {
  const error = useRouteError();
  return <p id="rr-error">{error.status} {error.statusText}<Link id="rr-recover" to="/">home</Link></p>;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    errorElement: <Oops />,
    children: [
      { index: true, element: <h1 id="rr-page">home</h1> },
      {
        path: 'users',
        element: <Users />,
        children: [{
          path: ':id',
          element: <User />,
          loader: async ({ params }) => (await (await fetch(`/api/user?n=${params.id}`)).json()).items[0],
        }],
      },
      {
        path: 'about',
        element: <About />,
        action: async ({ request }) => ({ greeting: `hello ${(await request.formData()).get('name')}` }),
      },
    ],
  },
]);

export default function Fixture() {
  return <RouterProvider router={router} />;
}
