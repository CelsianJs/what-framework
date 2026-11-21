// Which checkout a smoke-app server belongs to. Several checkouts of this repo
// (and several agents) run smokes on one machine at once, each from its own
// temp workdir. smoke/run.mjs writes its checkout's path into the workdir it
// makes, and smoke/clean.mjs stops a server working in a run's workdir only
// when that run came from the same checkout.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export const WORKDIR_PREFIX = 'what-smoke-apps-';
const MARKER = '.what-smoke-repo';

/** Record that the run using `workRoot` was started from checkout `repo`. */
export function markWorkdir(workRoot, repo) {
  writeFileSync(join(workRoot, MARKER), repo);
}

/** The run workdir `cwd` is in, or null. */
export function workdirOf(cwd) {
  const parts = cwd.split(sep);
  const at = parts.findIndex((part) => part.startsWith(WORKDIR_PREFIX));
  return at === -1 ? null : parts.slice(0, at + 1).join(sep);
}

/**
 * Whether a process working in `cwd` is checkout `repo`'s: inside the checkout
 * (an app's dev server started by hand), or in the workdir of a smoke run that
 * checkout started.
 */
export function startedBy(cwd, repo) {
  if (!cwd) return false;
  if (cwd === repo || cwd.startsWith(repo + sep)) return true;
  const dir = workdirOf(cwd);
  if (dir === null) return false;
  try {
    return readFileSync(join(dir, MARKER), 'utf8') === repo;
  } catch {
    return false;
  }
}
