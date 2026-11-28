import { hydrate } from 'what-framework';
import { Dashboard } from './Dashboard.jsx';

hydrate(<Dashboard />, document.getElementById('main'));
window.ready = true;
