/**
 * what-react/claim-islands: importing it installs island hydration without
 * adoption (mixed.js _claimIslands): each React island of a page the server
 * rendered takes the server's region for its own and renders over it in the
 * browser. What what-react's Vite plugin imports instead of
 * what-react/hydrate-islands with `reactCompat({ hydrateIslands: false })`,
 * in every module what-compiler compiles for hydration; an import is
 * evaluated before the code of the module that has it.
 */
import { _claimIslands } from './mixed.js';

_claimIslands();
