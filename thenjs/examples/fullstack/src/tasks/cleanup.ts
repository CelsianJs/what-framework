// Cron task — auto-discovered by ThenJS
// Cleans up completed tasks older than 1 hour

export const schedule = 'every 5m';

export function handler() {
  console.log('[cron:cleanup] Running cleanup of completed tasks...');
  // In a real app, this would query the database
  // and remove stale records
}
