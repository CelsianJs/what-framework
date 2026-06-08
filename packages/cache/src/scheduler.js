// Poll/scheduled regeneration — keeps the cache warm regardless of traffic.
// Runs in the long-lived Node adapter process. Self-rescheduling setTimeout
// (no drift/overlap), jitter (anti-thundering-herd after a restart), a global
// concurrency cap, and it joins the engine's in-flight lock so a scheduled tick
// during a traffic-triggered regeneration is a no-op.

export function createScheduler(engine, options = {}) {
  const {
    maxConcurrent = 4,
    random = Math.random,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    logger = console,
  } = options;

  const tasks = [];   // { route, intervalMs, timer }
  const queue = [];
  let running = false;
  let active = 0;

  function jittered(intervalMs) {
    return Math.round(intervalMs * (1 + random() * 0.1));
  }

  function schedule(task) {
    task.timer = setTimer(() => fire(task), jittered(task.intervalMs));
    if (task.timer && typeof task.timer.unref === 'function') task.timer.unref();
  }

  function fire(task) {
    if (!running) return;
    if (active < maxConcurrent) runTask(task);
    else queue.push(task);
  }

  async function runTask(task) {
    active++;
    try {
      await engine.regenerate(task.route);
    } catch (e) {
      logger.error?.('[what-cache] scheduled regenerate failed:', e);
    } finally {
      active--;
      if (running) schedule(task);
      drain();
    }
  }

  function drain() {
    while (running && active < maxConcurrent && queue.length) {
      runTask(queue.shift());
    }
  }

  return {
    register(route, { intervalMs }) {
      tasks.push({ route, intervalMs, timer: null });
      return this;
    },
    start() {
      running = true;
      for (const t of tasks) schedule(t);
      return this;
    },
    stop() {
      running = false;
      for (const t of tasks) if (t.timer != null) clearTimer(t.timer);
      queue.length = 0;
      return this;
    },
    _tasks: tasks,
  };
}
