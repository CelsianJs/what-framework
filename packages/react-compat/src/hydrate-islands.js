/**
 * what-react/hydrate-islands: importing it installs island hydration
 * (mixed.js _hydrateIslands). what-react's Vite plugin adds
 * `import 'what-react/hydrate-islands'` to every module what-compiler compiles
 * for hydration. An import is evaluated before the body of the module that
 * imports it, so the islands adopt the server's HTML even when that module
 * calls hydrate() itself, at its top level. A call added to the module would
 * run after such a hydrate(), which had then replaced every island.
 */
import { _hydrateIslands } from './mixed.js';

_hydrateIslands();
