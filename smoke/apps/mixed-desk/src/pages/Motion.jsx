// framer-motion: a list of motion items in AnimatePresence, driven by a What
// signal. A removed item plays its exit, then leaves the DOM.

import { signal } from 'what-framework';
import { AnimatePresence, motion } from 'framer-motion';

export const items = signal([1, 2, 3]);
let next = 4;

export function Motion() {
  return (
    <section data-route="motion">
      <h1>Watchlist</h1>
      <button type="button" data-motion-add onClick={() => items([...items(), next++])}>add</button>
      <button type="button" data-motion-remove onClick={() => items(items().slice(1))}>remove first</button>
      <span data-motion-model>{items().join(',')}</span>
      <ul class="motion-list" data-motion-list>
        <AnimatePresence>
          {items().map((i) => (
            <motion.li key={i} data-motion-item={i} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.12 }}>
              item {i}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}
