/**
 * Core MCP tools for what-devtools-mcp: orientation, state, diagnostics, the
 * event cursor, cache, and the two state writes.
 *
 * Every live tool targets one page session (see bridge.js). Lists are built
 * from the tracked registry; a late install can miss entries. Value previews
 * are shortened, and long lists page with offset/limit.
 */

import { z } from 'zod';
import { createResponder, previewValue, isNamed, pageText, sessionParam, UNTRUSTED_NOTE } from './respond.js';
import { describeToolAvailability } from './tool-registry.js';
import { getErrorDefinition } from './catalogue.js';
import { HYDRATION_FIXES } from './hydration-fixes.js';

// What each what_events type filter selects.
const EVENT_TYPES = {
  diagnostic: ['diagnostic'],
  error: ['error:captured'],
  write: ['signal:updated'],
  run: ['effect:run'],
  mount: ['component:mounted', 'component:unmounted'],
  lifecycle: ['signal:created', 'signal:disposed', 'effect:created', 'effect:disposed'],
  page: ['page:connected', 'page:reconnected', 'page:closed'],
  async: ['async:start', 'async:land', 'async:unresolved', 'async:ready', 'async:errored'],
  transition: ['transition:open', 'transition:commit', 'transition:merged'],
  optimistic: ['optimistic:add', 'optimistic:drop'],
  suspense: ['suspense:waiting', 'suspense:revealed', 'suspense:disposed'],
  hydration: ['hydration:complete'],
  action: ['action'],
};

export function sourceFields(entry) {
  return { ...(entry.owner ? { owner: entry.owner } : {}), ...(entry.loc ? { loc: entry.loc } : {}) };
}

export function asyncFields(entry) {
  if (!entry.async) return {};
  const { lastError, ...state } = entry.async;
  return { async: { ...state, ...(lastError !== undefined ? { lastError: pageText(lastError, 300) } : {}) } };
}

export function sourceSuffix(data) {
  return `${data.owner ? ` in ${data.owner}` : ''}${data.loc ? ` at ${data.loc}` : ''}`;
}

/** "App > [Header, TodoList > [TodoItem ×20]]", grouping same-name siblings. */
export function componentTreeLine(components, maxDepth = 2) {
  if (!components || components.length === 0) return '(empty)';
  const byId = new Map(components.map((c) => [c.id, { ...c, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  function group(nodes, depth) {
    const byName = new Map();
    for (const n of nodes) {
      const name = n.name || `component_${n.id}`;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(n);
    }
    return [...byName].map(([name, list]) => {
      let label = list.length > 1 ? `${name} ×${list.length}` : name;
      const kids = list.flatMap((n) => n.children);
      if (kids.length) label += depth < maxDepth ? ` > [${group(kids, depth + 1)}]` : ` > [${kids.length}…]`;
      return label;
    }).join(', ');
  }
  return group(roots, 1);
}

/** Reader count per signal id, from the effects' and computeds' dependency lists. */
export function subscriberCounts(effects) {
  const counts = new Map();
  for (const e of effects || []) {
    for (const id of e.depSignalIds || []) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

const DEFAULT_PENDING_MS = 5000;

export function stalledWork(state, pendingMs = DEFAULT_PENDING_MS) {
  const now = Date.now();
  const flights = state.effects.filter((e) => e.async?.inFlight).map((e) => ({
    kind: 'async', id: e.id, name: e.name, ...sourceFields(e), ...e.async.inFlight, status: e.async.status,
  }));
  const stalled = [...flights, ...(state.work || [])]
    .map((entry) => ({ ...entry, ageMs: Math.max(0, now - entry.startedAt) }))
    .filter((entry) => entry.ageMs >= pendingMs).sort((a, b) => b.ageMs - a.ageMs);
  return stalled.length ? { count: stalled.length, work: stalled.slice(0, 10) } : null;
}

export function registryCoverage(state) {
  if (!state.droppedBeforeInstall) return {};
  return {
    registry: {
      truncated: true,
      tracked: { signals: state.signals.length, effects: state.effects.length, components: state.components.length },
      droppedBeforeInstall: state.droppedBeforeInstall,
    },
  };
}

/** Remember the names a state answer carries, so event lines can name ids. */
export function learnNames(session, state) {
  for (const s of state.signals || []) session.names.signals.set(s.id, s.name);
  for (const e of state.effects || []) session.names.effects.set(e.id, e.name);
  for (const c of state.components || []) session.names.components.add(c.name);
}

function label(map, id) {
  const name = map.get(id);
  return name ? `${name}#${id}` : `#${id}`;
}

/** The reasons an effect ran, as "name#id" labels: changed signals, then changed computeds. */
export function causeLabels(data, names) {
  if (!data.causeSignalIds && !data.causeComputedIds) return null;
  return [
    ...(data.causeSignalIds || []).map((id) => label(names.signals, id)),
    ...(data.causeComputedIds || []).map((id) => label(names.effects, id)),
  ];
}

/** One line per event, e.g. `#41 write count=5`, `#42 run syncTitle#3 (4) ← count#1`. */
export function formatEvent(entry, names) {
  const { seq, event, data = {} } = entry;
  switch (event) {
    case 'signal:updated': {
      const value = previewValue(data.value, 60);
      const by = data.writerEffectId != null ? ` by ${label(names.effects, data.writerEffectId)}` : '';
      return `#${seq} write ${data.name || label(names.signals, data.id)}=${JSON.stringify(value)}${by}${sourceSuffix(data)}`;
    }
    case 'effect:run': {
      const causes = causeLabels(data, names);
      return `#${seq} run ${data.name ? `${data.name}#${data.id}` : label(names.effects, data.id)} (${data.runCount})${causes?.length ? ` ← ${causes.join(', ')}` : ''}${sourceSuffix(data)}`;
    }
    case 'signal:created': return `#${seq} +signal #${data.id} ${data.name || ''}${sourceSuffix(data)}`.trimEnd();
    case 'signal:disposed': return `#${seq} -signal ${label(names.signals, data.id)}${sourceSuffix(data)}`;
    case 'effect:created': return `#${seq} +${data.kind || 'effect'} #${data.id} ${data.name || ''}${sourceSuffix(data)}`.trimEnd();
    case 'effect:disposed': return `#${seq} -effect ${label(names.effects, data.id)}${sourceSuffix(data)}`;
    case 'component:mounted': return `#${seq} mount <${data.name}> #${data.id}${sourceSuffix(data)}`;
    case 'component:unmounted': return `#${seq} unmount #${data.id}${sourceSuffix(data)}`;
    case 'error:captured': return `#${seq} error ${data.type || ''}${data.code ? ` ${data.code}` : ''}: ${pageText(data.message, 160)}${sourceSuffix(data)}`;
    case 'diagnostic': return `#${seq} ${data.code}${data.count > 1 ? ` ×${data.count}` : ''} ${pageText(data.message, 200)}`;
    case 'action':
      return `#${seq} action ${pageText(data.name, 160)} ${data.outcome === 'ok' ? 'ok' : 'error'}`;
    case 'page:connected': return `#${seq} page connected`;
    case 'page:reconnected': return `#${seq} page reconnected (events while disconnected are missing)`;
    case 'page:closed': return `#${seq} page closed`;
    default: return `#${seq} ${event}`;
  }
}

/** Read the page's whole registry. Resolves with the state and the cursor it describes. */
export async function fetchState(bridge, session) {
  const { data, seq } = await bridge.request(session, 'state');
  if (!data || data.error || !Array.isArray(data.signals)) throw new Error(data?.error || 'The page sent no state; refresh it.');
  learnNames(session, data);
  return { state: data, seq };
}

/**
 * The cursor for an answer built from what the bridge holds: after a sync the
 * page has flushed everything it did, so the session's watermark covers it.
 */
export async function syncedSeq(bridge, session) {
  if (session.socket === null) return session.lastSeq;
  const { seq } = await bridge.request(session, 'sync');
  return seq;
}

/**
 * Make sure the session can name the effects and signals these events or
 * errors mention: ids created before the page connected are only learned from
 * a state read, so one is made when a name is missing.
 */
export async function ensureNames(bridge, session, items) {
  if (session.socket === null) return;
  const { signals, effects } = session.names;
  const missing = items.some((item) => {
    /** @type {Record<string, any>} */
    const d = { ...item, ...(item.data || {}) };
    return (d.writerEffectId != null && !effects.has(d.writerEffectId)) ||
      (d.effectId != null && !effects.has(d.effectId)) ||
      (d.causeSignalIds || []).some((id) => !signals.has(id)) ||
      (d.causeComputedIds || []).some((id) => !effects.has(id));
  });
  if (missing) await fetchState(bridge, session);
}

/** The events an action caused: those in (since, seq], formatted, at most `max` lines. */
export async function actionEvents(bridge, session, since, seq, max = 10) {
  if (since === undefined) return {};
  const caused = bridge.getEvents(session, { after: since }).events.filter((e) => e.seq <= seq);
  if (!caused.length) return { since, events: [] };
  await ensureNames(bridge, session, caused.slice(0, max));
  const names = session.names;
  return {
    since,
    events: caused.slice(0, max).map((e) => formatEvent(e, names)),
    ...(caused.length > max ? { more: caused.length - max } : {}),
  };
}

function page(rows, offset, limit) {
  const start = Math.max(0, offset || 0);
  const slice = rows.slice(start, start + limit);
  return { slice, ...(start + limit < rows.length ? { next: start + limit } : {}) };
}

function diagnosticSummary(bridge, session) {
  const counts = {};
  for (const d of bridge.getDiagnostics(session)) counts[d.code] = (counts[d.code] || 0) + (d.count || 1);
  return counts;
}

export function registerTools(server, bridge) {
  const { ok, fail, target } = createResponder(bridge);

  async function withState(id, run) {
    const { session, err } = target(id);
    if (err) return err;
    try {
      const { state, seq } = await fetchState(bridge, session);
      return await run({ session, state, seq });
    } catch (e) {
      return fail(e.message);
    }
  }

  // --- Orientation ---

  server.tool(
    'what_connection_status',
    'Orient in one call: the connected pages (sessions), and for the page: URL/title/route, counts, the diagnostics and errors it reported (first lines, with codes), the key signals with values, stalled async work, and the component tree two levels deep. Call first.',
    { session: sessionParam(z) },
    async ({ session: id }) => {
      const sessions = bridge.listSessions();
      const live = sessions.filter((s) => s.live);
      const refused = bridge.refusals().map((r) => ({ origin: r.origin, reason: r.reason }));
      const extras = refused.length ? { refused } : {};
      if (!live.length && !id) {
        const { total, available } = describeToolAvailability(false);
        return ok({
          connected: false,
          hint: 'No browser connected. Open or refresh the app in a browser with the dev server running (the what-devtools-mcp Vite plugin connects it), then call again.',
          offlineTools: available.map((t) => t.name),
          toolCount: total,
          ...extras,
        });
      }
      if (live.length > 1 && !id) {
        return ok({
          connected: true,
          sessions: live.map((s) => ({ id: s.id, url: s.url, title: pageText(s.title, 120) })),
          hint: 'More than one page is connected. Pass session to every live tool; what_connection_status({session}) orients in one.',
          ...extras,
        });
      }
      const { session, err } = target(id);
      if (err) return err;
      try {
        const { state, seq } = await fetchState(bridge, session);
        const { data: info } = await bridge.request(session, 'app-info');
        const signals = state.signals;
        const subs = subscriberCounts(state.effects);
        const keySignals = signals
          .filter((s) => isNamed(s.name) && !s.name.startsWith('what-router:'))
          .sort((a, b) => (subs.get(b.id) || 0) - (subs.get(a.id) || 0) || a.id - b.id)
          .slice(0, 8)
          .map((s) => ({ id: s.id, name: s.name, ...sourceFields(s), value: previewValue(s.value, 60), subs: subs.get(s.id) || 0 }));

        const diagnostics = bridge.getDiagnostics(session).sort((a, b) => b.seq - a.seq);
        const errors = bridge.getErrors(session).slice().reverse();
        const issues = [
          ...diagnostics.slice(0, 5).map((d) => `${d.code}${d.count > 1 ? ` ×${d.count}` : ''} ${pageText(d.message, 140)}`),
          ...errors.slice(0, 3).map((e) => `${e.code || 'ERR_RUNTIME'} ${e.type || 'error'}: ${pageText(e.message, 140)}`),
        ];
        const stalled = stalledWork(state);
        const hidden = Math.max(0, diagnostics.length - 5) + Math.max(0, errors.length - 3);
        return ok({
          connected: true,
          session: session.id,
          ...(live.length > 1 ? { otherSessions: live.filter((s) => s.id !== session.id).map((s) => s.id) } : {}),
          app: info && !info.error ? { url: info.url, title: pageText(info.title, 120), route: info.route } : null,
          hydration: state.hydration || { hydrated: false },
          counts: { signals: signals.length, effects: state.effects.filter((e) => e.kind !== 'computed').length, computeds: state.effects.filter((e) => e.kind === 'computed').length, components: state.components.length },
          diagnostics: diagnosticSummary(bridge, session),
          errors: errors.length,
          ...(issues.length ? { issues, ...(hidden ? { moreIssues: hidden } : {}), hint: 'what_errors gives each with its fix; what_fix({error}) the worked example.', note: UNTRUSTED_NOTE } : {}),
          ...(stalled ? { stalled } : {}),
          ...registryCoverage(state),
          keySignals,
          tree: componentTreeLine(state.components, 2),
          ...extras,
        }, seq);
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  // --- State ---

  server.tool(
    'what_signals',
    'Signals with current values and async computeds with status, in-flight run and last error. Filter by name regex or id; named signals come first. Values are previews; one id returns a longer preview. Pages with offset.',
    {
      filter: z.string().optional().describe('Regex on signal names (ignored if id is set)'),
      id: z.number().optional().describe('One writable signal by signal id'),
      effectId: z.number().optional().describe('One async computed by its effect id'),
      limit: z.number().optional().default(20).describe('Max signals (default 20, max 100)'),
      offset: z.number().optional().default(0).describe('Skip this many matches (from a previous answer\'s next)'),
      named_only: z.boolean().optional().default(false).describe('Drop signals without a debug name'),
      session: sessionParam(z),
    },
    async ({ filter, id, effectId, limit, offset, named_only, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      if (id != null && effectId != null) return fail('Pass a signal id or an async computed effectId.');
      const asyncNodes = state.effects.filter((e) => e.async);
      if (effectId != null) {
        const node = asyncNodes.find((e) => e.id === effectId);
        if (!node) return fail(`Async computed ${effectId} not found`, 'List async computeds with what_effects.');
        return ok({ signals: [{ effectId, name: node.name, kind: 'computed', ...sourceFields(node), ...asyncFields(node) }] }, seq);
      }
      let signals = [...state.signals, ...asyncNodes];
      const total = signals.length;
      if (id != null) {
        signals = state.signals.filter((s) => s.id === id);
        if (!signals.length) return fail(`Signal ${id} not found`, 'Ids change when the page reloads; call what_signals again.');
        const { data } = await bridge.request(session, 'signal', { id });
        const subs = subscriberCounts(state.effects);
        return ok({ ...registryCoverage(state), total, matched: 1, signals: [{ id, name: data.name ?? signals[0].name, ...sourceFields(signals[0]), value: previewValue(data.value ?? signals[0].value, 2000), rev: data.rev ?? signals[0].rev, subs: subs.get(id) || 0 }] }, seq);
      }
      if (filter) {
        let re;
        try { re = new RegExp(filter, 'i'); } catch { return fail(`Invalid regex: ${filter}`); }
        signals = signals.filter((s) => re.test(s.name));
      }
      if (named_only) signals = signals.filter((s) => isNamed(s.name));
      signals = [...signals].sort((a, b) => (Number(isNamed(b.name)) - Number(isNamed(a.name))) || a.id - b.id);

      const subs = subscriberCounts(state.effects);
      const { slice, next } = page(signals, offset, Math.min(Math.max(limit || 20, 1), 100));
      const rows = slice.map((s) => ({
        ...(s.async ? { effectId: s.id } : { id: s.id }), name: s.name, ...sourceFields(s),
        ...(s.async ? { kind: 'computed', ...asyncFields(s) } : { value: previewValue(s.value, 200), subs: subs.get(s.id) || 0 }),
      }));
      return ok({ ...registryCoverage(state), total, matched: signals.length, signals: rows, ...(next !== undefined ? { next } : {}) }, seq);
    })
  );

  server.tool(
    'what_effects',
    'Effects, bindings and computeds with run counts, dependencies and async status. Use what_why for causal history. Filter by run count, name regex or a dependency. Pages with offset.',
    {
      minRunCount: z.number().optional().describe('Only effects that ran at least this many times'),
      filter: z.string().optional().describe('Regex on effect names'),
      depSignalId: z.number().optional().describe('Only effects that read this signal'),
      limit: z.number().optional().default(50).describe('Max effects (default 50, max 200)'),
      offset: z.number().optional().default(0).describe('Skip this many matches (from a previous answer\'s next)'),
      session: sessionParam(z),
    },
    async ({ minRunCount, filter, depSignalId, limit, offset, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      let effects = state.effects;
      const total = effects.length;
      if (minRunCount != null) effects = effects.filter((e) => (e.runCount || 0) >= minRunCount);
      if (filter) {
        let re;
        try { re = new RegExp(filter, 'i'); } catch { return fail(`Invalid regex: ${filter}`); }
        effects = effects.filter((e) => re.test(e.name || ''));
      }
      if (depSignalId != null) effects = effects.filter((e) => (e.depSignalIds || []).includes(depSignalId));

      const names = session.names;
      const sorted = [...effects].sort((a, b) => (b.runCount || 0) - (a.runCount || 0) || a.id - b.id);
      const { slice, next } = page(sorted, offset, Math.min(Math.max(limit || 50, 1), 200));
      const rows = slice.map((e) => {
        const cause = causeLabels(e, names);
        return {
          id: e.id,
          name: e.name,
          ...sourceFields(e),
          ...asyncFields(e),
          ...(e.binding ? { kind: 'binding' } : e.kind === 'computed' ? { kind: 'computed' } : {}),
          runs: e.runCount || 0,
          deps: [...(e.depSignalIds || []).map((d) => label(names.signals, d)), ...(e.depComputedIds || []).map((d) => label(names.effects, d))],
          ...(cause?.length ? { lastCause: cause } : {}),
          ...(e.componentId != null ? { componentId: e.componentId } : {}),
        };
      });
      return ok({ ...registryCoverage(state), total, matched: effects.length, effects: rows, ...(next !== undefined ? { next } : {}) }, seq);
    })
  );

  server.tool(
    'what_components',
    'Mounted components and their ids, plus a one-line tree. tree:true returns the nested hierarchy with signal/effect counts per component. Ids change on remount: re-query after anything that may remount.',
    {
      filter: z.string().optional().describe('Regex on component names'),
      tree: z.boolean().optional().default(false).describe('Return the nested hierarchy with per-component signal/effect counts'),
      rootId: z.number().optional().describe('With tree:true, start at this component'),
      depth: z.number().optional().default(10).describe('With tree:true, max depth (default 10)'),
      limit: z.number().optional().default(100).describe('Flat list: max components (default 100)'),
      offset: z.number().optional().default(0).describe('Flat list: skip this many matches'),
      session: sessionParam(z),
    },
    async ({ filter, tree, rootId, depth, limit, offset, session: sid }) => withState(sid, async ({ state, seq }) => {
      const components = state.components;
      /** @type {RegExp | null} */
      let re = null;
      if (filter) {
        try { re = new RegExp(filter, 'i'); } catch { return fail(`Invalid regex: ${filter}`); }
      }

      if (!tree) {
        const matched = re ? components.filter((c) => re.test(c.name || '')) : components;
        const { slice, next } = page(matched, offset, Math.max(limit || 100, 1));
        return ok({
          ...registryCoverage(state),
          total: components.length,
          tree: componentTreeLine(components, 3),
          components: slice.map((c) => ({ id: c.id, name: c.name, ...sourceFields(c), parentId: c.parentId ?? null })),
          ...(next !== undefined ? { next } : {}),
        }, seq);
      }

      const byId = new Map(components.map((c) => [c.id, { ...c, children: [] }]));
      const roots = [];
      for (const node of byId.values()) {
        const parent = node.parentId != null ? byId.get(node.parentId) : null;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      const signalCount = new Map();
      for (const s of state.signals) if (s.componentId != null) signalCount.set(s.componentId, (signalCount.get(s.componentId) || 0) + 1);
      const effectCount = new Map();
      for (const e of state.effects) if (e.componentId != null) effectCount.set(e.componentId, (effectCount.get(e.componentId) || 0) + 1);

      const matches = (node) => !re || re.test(node.name) || node.children.some(matches);
      function toTree(node, d) {
        if (d > depth || !matches(node)) return null;
        /** @type {Record<string, any>} */
        const out = { id: node.id, name: node.name, ...sourceFields(node), signals: signalCount.get(node.id) || 0, effects: effectCount.get(node.id) || 0 };
        const kids = node.children.map((c) => toTree(c, d + 1)).filter(Boolean);
        if (kids.length) out.children = kids;
        return out;
      }
      if (rootId != null && !byId.has(rootId)) return fail(`Component ${rootId} not found`, 'Ids change on remount; call what_components again.');
      const result = rootId != null ? toTree(byId.get(rootId), 0) : roots.map((r) => toTree(r, 0)).filter(Boolean);
      return ok({ ...registryCoverage(state), total: components.length, tree: result }, seq);
    })
  );

  server.tool(
    'what_snapshot',
    'All state at once (signals, effects, components). mode "save" stores a baseline for this page; mode "diff" returns what changed since: signals changed (by revision, so any write counts)/added/removed, effects that re-ran (with run deltas), components mounted/unmounted, new diagnostics. A diff never crosses pages.',
    {
      mode: z.enum(['full', 'save', 'diff']).optional().default('full').describe('full (default), save a baseline, or diff against it'),
      maxSignals: z.number().optional().default(100).describe('full: max signals (default 100)'),
      maxEffects: z.number().optional().default(100).describe('full: max effects (default 100)'),
      session: sessionParam(z),
    },
    async ({ mode, maxSignals, maxEffects, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      if (mode === 'save') {
        session.baseline = { state, seq };
        return ok({ ...registryCoverage(state), saved: true, counts: { signals: state.signals.length, effects: state.effects.length, components: state.components.length } }, seq);
      }

      if (mode === 'diff') {
        const baseline = session.baseline;
        if (!baseline) {
          return fail(`No baseline saved for session ${session.id}`, 'Baselines belong to one page load (ids restart on reload). Call what_snapshot({mode:"save"}) on this page, act, then diff.');
        }
        const before = baseline.state;
        const baseSignals = new Map(before.signals.map((s) => [s.id, s]));
        const currSignals = new Map(state.signals.map((s) => [s.id, s]));
        const signalsChanged = [];
        const signalsAdded = [];
        for (const [sigId, s] of currSignals) {
          const prev = baseSignals.get(sigId);
          if (!prev) signalsAdded.push({ id: sigId, name: s.name, ...sourceFields(s), value: previewValue(s.value) });
          else if (prev.rev !== s.rev) signalsChanged.push({ id: sigId, name: s.name, ...sourceFields(s), writes: s.rev - prev.rev, from: previewValue(prev.value), to: previewValue(s.value) });
        }
        const signalsRemoved = [...baseSignals.values()].filter((s) => !currSignals.has(s.id)).map((s) => ({ id: s.id, name: s.name, ...sourceFields(s) }));

        const baseEffects = new Map(before.effects.map((e) => [e.id, e]));
        const currEffects = new Map(state.effects.map((e) => [e.id, e]));
        const effectsRan = [];
        const effectsAdded = [];
        for (const [effId, e] of currEffects) {
          const prev = baseEffects.get(effId);
          if (!prev) effectsAdded.push({ id: effId, name: e.name, ...sourceFields(e) });
          else if ((e.runCount || 0) > (prev.runCount || 0)) effectsRan.push({ id: effId, name: e.name, ...sourceFields(e), delta: e.runCount - (prev.runCount || 0) });
        }
        effectsRan.sort((a, b) => b.delta - a.delta);
        const effectsRemoved = [...baseEffects.values()].filter((e) => !currEffects.has(e.id)).map((e) => ({ id: e.id, name: e.name, ...sourceFields(e) }));

        const baseComps = new Set(before.components.map((c) => c.id));
        const currComps = new Set(state.components.map((c) => c.id));
        const mounted = state.components.filter((c) => !baseComps.has(c.id)).map((c) => ({ id: c.id, name: c.name, ...sourceFields(c) }));
        const unmounted = before.components.filter((c) => !currComps.has(c.id)).map((c) => ({ id: c.id, name: c.name, ...sourceFields(c) }));
        const newDiagnostics = bridge.getDiagnostics(session, { after: baseline.seq }).map((d) => `${d.code}${d.count > 1 ? ` ×${d.count}` : ''}`);

        const out = {};
        const counts = {};
        const owners = new Map();
        const locations = new Map();
        function index(table, value) {
          if (!value) return null;
          if (!table.has(value)) table.set(value, table.size);
          return table.get(value);
        }
        const put = (key, arr, n) => {
          if (!arr.length) return;
          counts[key] = arr.length;
          const rows = arr.slice(0, n).map(({ owner, loc, ...entry }) => (
            owner || loc ? { ...entry, source: [index(owners, owner), index(locations, loc)] } : entry
          ));
          if (arr.length > n) rows.push(`…${arr.length - n} more`);
          out[key] = rows;
        };
        put('signalsChanged', signalsChanged, 20);
        put('signalsAdded', signalsAdded, 10);
        put('signalsRemoved', signalsRemoved, 10);
        put('effectsRan', effectsRan, 20);
        put('effectsAdded', effectsAdded, 10);
        put('effectsRemoved', effectsRemoved, 10);
        put('mounted', mounted, 10);
        put('unmounted', unmounted, 10);
        if (newDiagnostics.length) out.newDiagnostics = newDiagnostics;
        if (!Object.keys(out).length) return ok({ ...registryCoverage(state), changed: false, since: baseline.seq }, seq);
        return ok({
          ...registryCoverage(state), ...out, counts, since: baseline.seq,
          ...(owners.size || locations.size ? { sources: { owners: [...owners.keys()], locations: [...locations.keys()] } } : {}),
        }, seq);
      }

      const out = {
        ...registryCoverage(state),
        signals: state.signals.slice(0, maxSignals).map((s) => ({ id: s.id, name: s.name, value: previewValue(s.value, 200), ...(s.componentId != null ? { componentId: s.componentId } : {}) })),
        effects: state.effects.slice(0, maxEffects).map((e) => ({ id: e.id, name: e.name, ...(e.kind === 'computed' ? { kind: 'computed' } : {}), runs: e.runCount || 0, deps: e.depSignalIds || [], ...(e.componentId != null ? { componentId: e.componentId } : {}) })),
        components: state.components.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId ?? null })),
        diagnostics: diagnosticSummary(bridge, session),
      };
      if (state.signals.length > maxSignals || state.effects.length > maxEffects) {
        return ok({ ...out, totals: { signals: state.signals.length, effects: state.effects.length } }, seq);
      }
      return ok(out, seq);
    })
  );

  // --- Diagnostics ---

  server.tool(
    'what_errors',
    'Coded diagnostics the page reported (code, severity, count, owner path, source location) and errors it threw (in effects, event handlers, promises), oldest first, each code with its fix. summary counts everything; the list pages: pass after (a seq from any answer) or next.',
    {
      after: z.number().optional().describe('Only entries newer than this seq'),
      code: z.string().optional().describe('Exact diagnostic or error code, e.g. ERR_HYDRATION_MISMATCH'),
      severity: z.enum(['error', 'warning', 'all']).optional().default('all').describe('Filter by severity (default all)'),
      limit: z.number().optional().default(20).describe('Max entries (default 20, max 100)'),
      session: sessionParam(z),
    },
    async ({ after, severity, limit, code, session: sid }) => {
      const { session, err } = target(sid, { allowClosed: true });
      if (err) return err;
      let seq;
      try { seq = await syncedSeq(bridge, session); } catch (e) { return fail(e.message); }
      const cursor = after || 0;

      const diagnostics = bridge.getDiagnostics(session, { after: cursor })
        .filter((d) => (!code || d.code === code) && (severity === 'all' || d.severity === severity))
        .map((d) => ({ kind: 'diagnostic', seq: d.seq, d }));
      const errors = severity === 'warning' ? [] : bridge.getErrors(session, { after: cursor })
        .filter((e) => !code || code === (getErrorDefinition(e.code)?.code || 'ERR_RUNTIME')).map((e) => ({ kind: 'error', seq: e.seq, e }));
      const all = [...diagnostics, ...errors].sort((a, b) => a.seq - b.seq);
      const max = Math.min(Math.max(limit || 20, 1), 100);
      const shown = all.slice(0, max);

      const summary = {};
      for (const item of all) {
        const code = item.kind === 'diagnostic' ? item.d.code : (getErrorDefinition(item.e.code)?.code || 'ERR_RUNTIME');
        summary[code] = (summary[code] || 0) + (item.kind === 'diagnostic' ? item.d.count || 1 : 1);
      }
      try { await ensureNames(bridge, session, shown.filter((i) => i.kind === 'error').map((i) => i.e)); } catch (e) { return fail(e.message); }
      const names = session.names;

      /** @type {{ diagnostics: any[], errors: any[] }} */
      const out = { diagnostics: [], errors: [] };
      for (const item of shown) {
        if (item.kind === 'diagnostic') {
          const d = item.d;
          out.diagnostics.push({
            code: d.code,
            severity: d.severity,
            count: d.count,
            message: pageText(d.message, 300),
            ...(d.owner?.length ? { owner: d.owner.join(' › ') } : {}),
            ...(d.loc ? { loc: d.loc } : {}),
            ...(d.subject ? { subject: d.subject } : {}),
            ...(d.code === 'ERR_HYDRATION_MISMATCH' && d.data ? { mismatch: {
              ...d.data, expected: pageText(d.data.expected, 200), found: pageText(d.data.found, 200),
            } } : {}),
            seq: d.seq,
          });
        } else {
          const e = item.e;
          const def = e.code ? getErrorDefinition(e.code) : null;
          const where = parseStack(e.stack, names.components);
          out.errors.push({
            code: def ? def.code : 'ERR_RUNTIME',
            type: e.type,
            message: pageText(e.message, 300),
            ...(e.effectId != null ? { effect: label(names.effects, e.effectId) } : {}),
            ...(where.component ? { component: where.component } : {}),
            ...sourceFields(e),
            ...(where.file ? { at: `${where.file}:${where.line}:${where.column}` } : {}),
            ...(def ? {} : { hint: inferSuggestion(e.message || '') }),
            seq: e.seq,
          });
        }
      }

      const fixes = {};
      const mismatchFixes = {};
      for (const entry of out.diagnostics) {
        const kind = entry.mismatch?.kind;
        if (Object.hasOwn(HYDRATION_FIXES, kind)) mismatchFixes[kind] = HYDRATION_FIXES[kind];
      }
      for (const code of Object.keys(summary)) {
        if (code === 'ERR_HYDRATION_MISMATCH' && Object.keys(mismatchFixes).length &&
            out.diagnostics.every((d) => d.code !== code || Object.hasOwn(mismatchFixes, d.mismatch?.kind))) continue;
        const def = code === 'ERR_RUNTIME' ? null : getErrorDefinition(code);
        if (def) fixes[code] = def.suggestion;
      }
      const lost = {};
      if (session.diagnosticsLostThrough > cursor) lost.diagnosticsEvictedThrough = session.diagnosticsLostThrough;
      if (session.pageDiagnosticsDropped) lost.droppedInPageBeforeConnect = session.pageDiagnosticsDropped;
      if (session.errorsEvicted) lost.errorsEvicted = session.errorsEvicted;
      const closedNote = session.socket === null ? { note: `Session ${session.id} has closed; showing what it reported.` } : {};

      if (!all.length) {
        return ok({ diagnostics: [], errors: [], note: after ? `Nothing new after seq ${after}.` : 'No diagnostics or errors on this page load.', ...(Object.keys(lost).length ? { lost } : {}), ...closedNote }, seq);
      }
      return ok({
        summary,
        ...out,
        fixes,
        ...(Object.keys(mismatchFixes).length ? { mismatchFixes } : {}),
        ...(all.length > shown.length ? { more: all.length - shown.length, next: shown[shown.length - 1].seq } : {}),
        ...(Object.keys(lost).length ? { lost } : {}),
        note: UNTRUSTED_NOTE,
        ...closedNote,
      }, seq);
    }
  );

  server.tool(
    'what_events',
    'What happened, without waiting: events after a cursor, oldest first (includes async, transitions, optimistic overlays, Suspense and hydration) (writes with their writer, effect runs with their cause, mounts, diagnostics, errors, page loads). Pass after = the seq or since from an earlier answer. more:true means call again with after = next; reading from next never repeats or skips.',
    {
      after: z.number().optional().describe('Return events with seq greater than this (default: the oldest kept)'),
      types: z.array(z.enum(['diagnostic', 'error', 'write', 'run', 'mount', 'lifecycle', 'page', 'async', 'transition', 'optimistic', 'suspense', 'hydration', 'action'])).optional()
        .describe('Only these kinds (default: all)'),
      limit: z.number().optional().default(50).describe('Max events (default 50, max 500)'),
      session: sessionParam(z),
    },
    async ({ after, types, limit, session: sid }) => {
      const { session, err } = target(sid, { allowClosed: true });
      if (err) return err;
      let seq;
      try { seq = await syncedSeq(bridge, session); } catch (e) { return fail(e.message); }
      const max = Math.min(Math.max(limit || 50, 1), 500);
      const wanted = types?.length ? new Set(types.flatMap((t) => EVENT_TYPES[t])) : null;
      const slice = bridge.getEvents(session, { after: after || 0 });
      const matching = wanted ? slice.events.filter((e) => wanted.has(e.event)) : slice.events;
      const events = matching.slice(0, max);
      const more = matching.length > max;
      try { await ensureNames(bridge, session, events); } catch (e) { return fail(e.message); }
      const names = session.names;

      const runs = {};
      for (const e of events) {
        if (e.event !== 'effect:run') continue;
        const key = e.data?.name ? `${e.data.name}#${e.data.id}` : label(names.effects, e.data?.id);
        runs[key] = (runs[key] || 0) + 1;
      }
      const ranked = Object.entries(runs).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, n]) => `${name} ×${n}`);
      const actions = events.filter((e) => e.event === 'action').map(({ seq, data }) => ({
        seq, name: pageText(data.name, 160), outcome: data.outcome === 'ok' ? 'ok' : 'error',
        invalidated: Array.isArray(data.invalidated) ? data.invalidated.map((key) => pageText(key, 200)) : [],
        revalidated: Array.isArray(data.revalidated) ? data.revalidated.map((path) => pageText(path, 200)) : [],
      }));
      const hasPageText = actions.length || events.some((e) => e.event === 'diagnostic' || e.event === 'error:captured');

      return ok({
        next: more ? events[events.length - 1].seq : seq,
        more,
        ...(slice.lostThrough ? { lostThrough: slice.lostThrough } : {}),
        events: events.map((e) => formatEvent(e, names)),
        ...(events.some((e) => /^(async|transition|optimistic|suspense|hydration):/.test(e.event)) ? {
          work: events.filter((e) => /^(async|transition|optimistic|suspense|hydration):/.test(e.event)).map((e) => {
            const { lastError, ...data } = e.data;
            return { seq: e.seq, type: e.event, ...data, ...(lastError !== undefined ? { lastError: pageText(lastError, 300) } : {}) };
          }),
        } : {}),
        ...(ranked.length ? { runs: ranked } : {}),
        ...(actions.length ? { actions } : {}),
        ...(hasPageText ? { note: UNTRUSTED_NOTE } : {}),
        ...(session.socket === null ? { closed: `Session ${session.id} has closed; showing its buffered events.` } : {}),
      }, seq);
    }
  );

  // --- Cache ---

  server.tool(
    'what_cache',
    'The query cache of the running app (query(), useQuery, useSWR, useInfiniteQuery, useFetch share it): each key with its status (loading, refreshing, success, error, idle), a value preview, its readers, how long ago it landed and its last fetch.',
    {
      key: z.string().optional().describe('Substring filter on cache keys (array keys read as "todos:1")'),
      session: sessionParam(z),
    },
    async ({ key, session: sid }) => {
      const { session, err } = target(sid);
      if (err) return err;
      try {
        const { data, seq } = await bridge.request(session, 'get-cache');
        const list = Array.isArray(data?.entries) ? data.entries : [];
        const entries = list.filter((e) => e && typeof e === 'object' && (!key || String(e.key || '').includes(key)));
        const now = Date.now();
        return ok({
          count: entries.length,
          entries: entries.map((e) => ({
            key: e.key,
            ...(e.kind && e.kind !== 'query' ? { kind: e.kind } : {}),
            status: e.status,
            data: previewValue(e.data, 200),
            ...(e.error ? { error: String(e.error) } : {}),
            observers: e.observers ?? 0,
            ...(e.isValidating ? { fetching: true } : {}),
            ...(typeof e.updatedAt === 'number' ? { ageMs: now - e.updatedAt } : {}),
            ...(e.lastFetch ? { lastFetch: { agoMs: now - e.lastFetch.at, ms: e.lastFetch.ms, ok: e.lastFetch.ok } } : {}),
            ...(e.fetches ? { fetches: e.fetches } : {}),
            ...(Array.isArray(e.paths) && e.paths.length ? { paths: e.paths } : {}),
          })),
          ...(entries.length === 0 && !key ? { hint: 'Nothing is cached: the page reads no query, or what-framework/data is not loaded.' } : {}),
        }, seq);
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  // --- Writes ---

  server.tool(
    'what_set_signal',
    'Write a signal in the running app. Returns the previous and new values, the effects that ran, and since: what_events({after: since}) shows everything the write caused, including later async work.',
    {
      signalId: z.number().describe('Signal id (from what_signals)'),
      value: z.any().describe('New value (JSON). A string that parses as JSON (a number, boolean, null, array or object) is parsed ("42" becomes 42); pass rawString:true to write the string exactly.'),
      rawString: z.boolean().optional().describe('Write a string value exactly as given, without JSON parsing'),
      session: sessionParam(z),
    },
    async ({ signalId, value, rawString, session: sid }) => {
      const { session, err } = target(sid);
      if (err) return err;
      try {
        const written = rawString && typeof value === 'string' ? value : coerceJsonValue(value);
        const { data, seq, since } = await bridge.request(session, 'set-signal', { signalId, value: written });
        if (data?.error) return fail(data.error, 'Signal ids change when the page reloads; call what_signals again.');
        return ok({ signalId, previous: data.previous, current: data.current, ...(await actionEvents(bridge, session, since, seq)) }, seq);
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.tool(
    'what_invalidate_cache',
    'Mark query cache entries stale and refetch the ones on screen, as invalidateQueries does. Returns the keys it matched and since: what_events({after: since}) shows the refetch as it lands.',
    {
      key: z.union([z.string(), z.array(z.unknown())]).optional().describe('A key as what_cache lists it ("todos:1"), or an array prefix (["todos"]). Omit to invalidate every entry.'),
      session: sessionParam(z),
    },
    async ({ key, session: sid }) => {
      const { session, err } = target(sid);
      if (err) return err;
      try {
        const { data, seq, since } = await bridge.request(session, 'invalidate-cache', { key });
        if (data?.error) return fail(data.error);
        const invalidated = Array.isArray(data?.invalidated) ? data.invalidated : [];
        return ok({
          invalidated,
          ...(invalidated.length === 0 ? { hint: 'No cache key matched; what_cache lists the keys.' } : {}),
          ...(await actionEvents(bridge, session, since, seq)),
        }, seq);
      } catch (e) {
        return fail(e.message);
      }
    }
  );
}

/**
 * Parse a JS error stack trace and extract:
 *   - file/line/column of the topmost USER frame (skipping framework internals)
 *   - component name matched against the components the page mounted
 *
 * V8/Chrome formats only (the app runs in a browser):
 *   "    at FunctionName (file.js:12:34)"
 *   "    at file.js:12:34"
 */
export function parseStack(stack, knownNames = new Set()) {
  /** @type {{ file: string|null, line: number|null, column: number|null, component: string|null }} */
  const out = { file: null, line: null, column: null, component: null };
  if (!stack || typeof stack !== 'string') return out;

  const skipPatterns = [
    /what-framework/,
    /what-core/,
    /what-devtools/,
    /node_modules/,
    /\/packages\/core\/src\//,
    /\/vite\//,
    /\/@id\//,
    /<anonymous>/,
    /^Error[: ]/,
  ];

  for (const rawLine of stack.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('at ')) continue;

    const withFn = line.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    const noFn = line.match(/^at\s+(.+):(\d+):(\d+)$/);

    const fnName = withFn ? withFn[1] : null;
    const path = withFn ? withFn[2] : noFn ? noFn[1] : null;
    const ln = withFn ? Number(withFn[3]) : noFn ? Number(noFn[2]) : null;
    const col = withFn ? Number(withFn[4]) : noFn ? Number(noFn[3]) : null;

    if (!path) continue;

    // "TaskList" from "Object.TaskList" or "TaskList.handleClick".
    if (!out.component && fnName) {
      for (const tok of fnName.split(/[.\s]/)) {
        if (knownNames.has(tok)) { out.component = tok; break; }
      }
    }

    if (out.file == null && !skipPatterns.some((re) => re.test(path))) {
      out.file = path;
      out.line = ln;
      out.column = col;
    }
  }
  return out;
}

/**
 * A suggestion for an uncoded runtime error, from common JavaScript mistakes.
 */
function inferSuggestion(msg) {
  if (!msg) return 'Check the stack trace and component context for more details.';
  if (/is not defined$/.test(msg)) {
    const m = msg.match(/^(\w+) is not defined/);
    const name = m?.[1] || 'identifier';
    return `'${name}' is referenced before it is declared/imported. Check for a missing import or a typo.`;
  }
  if (/is not a function$/.test(msg)) {
    const m = msg.match(/^(.+?) is not a function/);
    const name = m?.[1] || 'value';
    return `'${name}' is not callable: an undefined import, a typo, or a value used as a function.`;
  }
  if (/Cannot read propert(?:y|ies) of (undefined|null)/.test(msg)) {
    const m = msg.match(/Cannot read propert(?:y|ies) of (undefined|null) \(reading '(.+?)'\)/);
    if (m) return `Tried to read '.${m[2]}' on ${m[1]}. Guard the access (e.g. \`value?.${m[2]}\`), or initialise the signal/prop before this code runs.`;
    return 'Tried to access a property on undefined/null. Add an optional-chain (`?.`) or null-check before the access.';
  }
  if (/Maximum call stack/.test(msg)) {
    return 'Infinite recursion. Usually an effect writes to a signal it reads: read it with untrack(), or move the write into a different effect.';
  }
  if (/Assignment to constant variable/.test(msg)) {
    return 'Tried to reassign a `const`. To update a signal call it: `mySignal(newValue)`, not `mySignal = newValue`.';
  }
  return 'Check the stack trace and component context for more details.';
}

/**
 * Coerce a possibly-stringified JSON value into its native form, once, here.
 *
 * Agents and some MCP clients pass complex values as JSON-encoded strings
 * (`'[{"id":1}]'` instead of `[{id: 1}]`). Without this, the page would store
 * the literal string and downstream iteration breaks. Only a string that
 * parses to a non-string is replaced; plain text like "hello" stays as is.
 * what_set_signal skips this entirely for rawString:true.
 */
export function coerceJsonValue(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  const first = trimmed[0];
  const looksLikeJson =
    first === '{' || first === '[' || first === '"' ||
    first === 't' || first === 'f' || first === 'n' ||
    first === '-' || (first >= '0' && first <= '9');
  if (!looksLikeJson) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed !== 'string' ? parsed : value;
  } catch {
    return value;
  }
}
