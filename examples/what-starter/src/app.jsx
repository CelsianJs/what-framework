// App entry point
// Routes are auto-discovered from src/pages/ by the file router.
// No manual route definitions needed.

import { mount } from 'what-framework';
import { FileRouter } from 'what-framework/router';
import { routes } from 'virtual:what-routes';

mount(<FileRouter routes={routes} />, '#app');
