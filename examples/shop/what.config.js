// What Framework app config. `what build` / `what start` read this to pick a
// deploy adapter and ISR defaults.
export default {
  adapter: 'node', // 'node' | 'vercel' | 'cloudflare' | 'static'
  isr: {
    store: 'memory', // 'memory' | 'filesystem' | 'redis'
    defaultRevalidate: 60,
  },
};
