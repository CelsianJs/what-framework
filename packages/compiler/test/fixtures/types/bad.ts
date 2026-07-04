// Invalid what-compiler usage. Proves the plugin-option types are not blanket
// `any`: a string passed to the boolean `hot` option must error (TS2322).
import { what } from 'what-compiler';

export const plugin = what({ hot: 'yes-please' });
