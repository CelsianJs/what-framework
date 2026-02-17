import { mount } from 'what-framework';
import { Router, enableScrollRestoration } from 'what-framework/router';
import { routes } from './routes.js';
import './styles.css';

enableScrollRestoration();
mount(<Router routes={routes} />, '#app');
