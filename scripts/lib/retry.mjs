// Generic retry-with-backoff helper.
//
// Built for scripts/verify-registry-install.mjs: `npm install <pkg>@<version>`
// immediately after `npm publish` reliably 404s for a few minutes while the
// npm registry/CDN propagates the freshly published tarball and dist-tag —
// this is not a real failure, just replication lag. Retrying the same
// operation a handful of times with backoff self-heals without masking a
// genuine publish failure (which still fails after the final attempt).
//
// Kept generic (no npm-specific code) so it's independently unit-testable.

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @template T
 * @param {(attempt: number) => T | Promise<T>} task - the operation to retry.
 *   Receives the 1-based attempt number. Throw to signal failure.
 * @param {object} [options]
 * @param {number} [options.attempts=5] - total attempts (>= 1) before giving up.
 * @param {number[]} [options.delaysMs=[30000,60000,90000,120000]] - delay before
 *   each retry, indexed by (attempt - 1). The last entry is reused if there are
 *   more retries than entries.
 * @param {(info: { attempt: number, attempts: number, delayMs: number, error: unknown }) => void | Promise<void>} [options.onRetry]
 *   called after a failed attempt, before sleeping — use for logging.
 * @param {(ms: number) => Promise<void>} [options.sleep] - injectable for tests.
 * @returns {Promise<T>}
 */
export async function retryWithBackoff(task, options = {}) {
  const attempts = options.attempts ?? 5;
  const delaysMs = options.delaysMs ?? [30_000, 60_000, 90_000, 120_000];
  const onRetry = options.onRetry ?? (() => {});
  const sleep = options.sleep ?? defaultSleep;

  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`retryWithBackoff: attempts must be a positive integer, got ${attempts}`);
  }

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      const delayMs = delaysMs[Math.min(attempt - 1, delaysMs.length - 1)];
      await onRetry({ attempt, attempts, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
