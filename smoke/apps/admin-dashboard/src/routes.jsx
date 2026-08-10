// The route table.
//
// Middleware is SYNC by contract: the Router inspects the return value rather
// than awaiting it. Returning a string redirects, which is how the sign-in gate
// works, and reading session() here also subscribes the router's reactive region
// to it, so signing out re-matches and bounces you to /signin immediately.

import { nestedRoutes } from 'what-router';

import { session } from './state/session.js';

import Overview from './pages/Overview.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Customers from './pages/Customers.jsx';
import Reports, { ReportsSkeleton } from './pages/Reports.jsx';
import Diagnostics, { RouteCrash } from './pages/Diagnostics.jsx';
import { SettingsLayout } from './pages/SettingsLayout.jsx';
import Profile from './pages/Profile.jsx';
import Team from './pages/Team.jsx';
import SignIn from './pages/SignIn.jsx';

const requireSession = ({ path }) =>
  (session() ? undefined : `/signin?next=${encodeURIComponent(path)}`);

const protect = (list) => list.map((r) => ({ ...r, middleware: [requireSession, ...(r.middleware ?? [])] }));

export const routes = [
  ...protect([
    { path: '/', component: Overview },
    { path: '/orders', component: Orders },
    { path: '/orders/:id', component: OrderDetail },
    { path: '/customers', component: Customers },
    { path: '/reports', component: Reports, loading: ReportsSkeleton },
    { path: '/diagnostics', component: Diagnostics, error: RouteCrash },
    ...nestedRoutes('/settings', [
      { path: '/profile', component: Profile },
      { path: '/team', component: Team },
    ], { layout: SettingsLayout }),
  ]),
  { path: '/signin', component: SignIn },
];
