// What Framework — JSX Dev Runtime
// Same as jsx-runtime but used in development mode by Vite. jsxDEV's extra
// arguments (static-children flag, source, self) are not used.

import { Fragment } from './h.js';
import { jsx } from './jsx-runtime.js';

export { Fragment };

// jsx/jsxs too: some bundlers use them even in dev.
export { jsx, jsx as jsxDEV };
export const jsxs = jsx;
