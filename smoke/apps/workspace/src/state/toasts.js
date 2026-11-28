// The toast region's state: a queue of messages that dismiss themselves.

import { createStore } from 'what-framework';

let nextId = 1;

export const useToasts = createStore({
  items: [],
  push(text, tone = 'info') {
    const id = nextId++;
    this.items = [...this.items, { id, text, tone }];
    setTimeout(() => useToasts().dismiss(id), 5000);
    return id;
  },
  dismiss(id) {
    this.items = this.items.filter((t) => t.id !== id);
  },
});
