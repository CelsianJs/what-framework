// Keep history by numeric record id. A later signal write cannot rewrite a
// cause already captured by a reader, and old runs don't retain the graph.
const MAX_HISTORY = 2048;
const MAX_ANSWER = 32;
const MAX_INPUTS = 24;

export function createCauseHistory(describe, dependencies, describeEvent) {
  let users = 0;
  let cursor = 0;
  let origin = null;
  let writes = new WeakMap();
  let checks = new WeakMap();
  let readsAtRun = new WeakMap();
  let lastRun = new WeakMap();
  let latest = new WeakMap();
  let commits = new WeakMap();
  const records = new Array(MAX_HISTORY);

  function lookup(ref) {
    const step = records[ref % MAX_HISTORY];
    return step?.ref === ref ? step : undefined;
  }

  function arm() {
    users++;
    let armed = true;
    return () => {
      if (!armed) return;
      armed = false;
      if (--users) return;
      records.fill(undefined);
      writes = new WeakMap();
      checks = new WeakMap();
      readsAtRun = new WeakMap();
      lastRun = new WeakMap();
      latest = new WeakMap();
      commits = new WeakMap();
    };
  }

  function record(kind, subject, causes, extra = {}) {
    const ref = ++cursor;
    const links = [...new Set(causes.filter(Boolean))];
    records[ref % MAX_HISTORY] = {
      ref, kind, subject, ...extra,
      ...(links.length ? { causes: links.slice(0, MAX_INPUTS) } : {}),
      ...(links.length > MAX_INPUTS ? { omittedInputs: links.length - MAX_INPUTS } : {}),
    };
    return ref;
  }

  function withOrigin(next, fn) {
    const prev = origin;
    origin = next;
    try { return fn(); } finally { origin = prev; }
  }

  function write(handle, writer) {
    const event = typeof window !== 'undefined' ? window.event : null;
    const target = event && (event.currentTarget instanceof Element
      ? event.currentTarget : event.target instanceof Element ? event.target : null);
    const from = writer
      ? { kind: 'effect', ...describe(writer) }
      : origin || (event ? describeEvent(event, target) : { kind: 'external' });
    writes.set(handle, record('write', describe(handle), [writer && latest.get(writer)], { origin: from }));
  }

  function begin(node, causes, parent) {
    latest.set(node, record('run', describe(node), [parent && latest.get(parent), commits.get(node), ...(causes || []).map((dep) => writes.get(dep))]));
    commits.delete(node);
  }

  function ran(node, computed, causes, reads = []) {
    if (computed) {
      latest.set(node, record('evaluate', describe(node), (causes || []).map((dep) => writes.get(dep))));
    }
    lastRun.set(node, latest.get(node));
    readsAtRun.set(node, { reads: reads.slice(0, MAX_INPUTS).map(describe), omittedReads: Math.max(0, reads.length - MAX_INPUTS) });
  }

  function change(node, kind) {
    const read = latest.get(node);
    const step = lookup(read);
    const settled = kind !== 'async-landing' && step?.kind === 'evaluate';
    if (settled) step.kind = kind;
    const ref = settled ? read : record(kind, describe(node), [read]);
    if (kind !== 'equal') writes.set(node, ref);
    checks.set(node, ref);
  }

  function skip(node) {
    const previous = lastRun.get(node);
    const observed = latest.get(node);
    // A direct computed may have stayed cached after a deeper value
    // compared equal. Find the first checked computed on each upstream path.
    const seen = new Set(dependencies(node));
    const checked = [];
    for (const dep of seen) {
      if (seen.size > MAX_HISTORY) break;
      const ref = checks.get(dep);
      if (ref > (observed || 0)) checked.push(ref);
      else if (typeof dep !== 'function') for (const input of dependencies(dep)) seen.add(input);
    }
    latest.set(node, record('skip', describe(node), [commits.get(node), ...checked], { reason: 'unchanged-dependencies', previousRun: previous }));
    commits.delete(node);
  }

  function commit(held, subject) {
    const ref = record('transition-commit', subject, []);
    for (const node of held) commits.set(node, ref);
  }

  function mount(owner, parent) {
    latest.set(owner, record('mount', describe(owner), [parent && latest.get(parent)]));
  }

  function explain(nodes, owner) {
    const roots = nodes.map(({ node, runCount }) => {
      const ref = latest.get(node);
      const captured = readsAtRun.get(node);
      const deps = captured ? null : dependencies(node);
      const reads = captured?.reads || deps.slice(0, MAX_INPUTS).map(describe);
      const omittedReads = captured?.omittedReads ?? Math.max(0, deps.length - MAX_INPUTS);
      return {
        ...describe(node), runs: runCount,
        ...(ref ? { ref } : { reason: 'no-recorded-run' }),
        reads,
        ...(omittedReads ? { omittedReads } : {}),
      };
    });
    const mountRef = owner && latest.get(owner);
    const next = new Set(roots.flatMap((root) => root.ref ? [root.ref] : []));
    if (mountRef) next.add(mountRef);
    const graph = [];
    let omitted = 0;
    for (const ref of next) {
      const step = lookup(ref);
      if (!step || graph.length === MAX_ANSWER) {
        omitted++;
        continue;
      }
      graph.push(step);
      for (const link of step.causes || []) next.add(link);
    }
    return { targets: roots, ...(mountRef ? { mountRef } : {}), graph, ...(omitted ? { omitted } : {}) };
  }

  return { get armed() { return users > 0; }, arm, withOrigin, write, begin, ran, change, skip, commit, mount, explain };
}
