// Types for `what-devtools/panel`.
import type { VNode } from 'what-core';

/**
 * The in-page devtools panel. Mount it anywhere in a dev build; it reads from
 * the same stores `installDevTools()` populates.
 */
export function DevPanel(): VNode<any> | null;
export default DevPanel;
