// Exposes the REAL What Framework as window.What for the docs live demos
// (replaces the old fake inline mock). Bundled to a classic IIFE so the demo
// <script>s can read window.What synchronously.
import { signal, computed, effect, batch, onMount, onCleanup } from 'what-framework';
import { spring } from 'what-framework/motion';
window.What = { signal, computed, effect, batch, onMount, onCleanup, spring };
