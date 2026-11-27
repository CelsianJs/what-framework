// Mixed Desk: a trading desk being moved off React. The shell, the router
// and the store are native What; the screens still use React libraries
// (recharts, TanStack Table, react-window, react-hook-form, Radix, sonner,
// framer-motion, and react-toastify, react-dropzone, React Flow,
// @hello-pangea/dnd, react-intl, react-spring, valtio and embla outside the
// compatibility matrix) as plain JSX tags.
// Client-only; index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';
import { Router } from 'what-router';

import { Shell } from './shell.jsx';
import { routes, NotFound } from './routes.jsx';
import * as store from './store.js';

window.__desk = store;

mount(<Router routes={routes} fallback={NotFound} globalLayout={Shell} />, '#app');
