// Field Guide: an engineering handbook whose chapters are code-split routes.
// Client-only; index.html ships an empty #app.

import './styles.css';

import { mount } from 'what-framework';
import { Router } from 'what-router';

import { NotFound } from './pages.jsx';
import { routes } from './routes.jsx';
import { Shell } from './shell.jsx';

mount(<Router routes={routes} fallback={NotFound} globalLayout={Shell} />, '#app');
