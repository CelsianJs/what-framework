// Presentation helpers shared by the console page and the detail panel.
// Client-safe.

/**
 * Clock time in UTC. Deliberately NOT "3 minutes ago": a relative label computed
 * from Date.now() differs between the server render and the hydration a moment
 * later, which is a hydration mismatch the framework would be right to warn
 * about and an app has no way to win.
 */
export function clock(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

export function shortDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
