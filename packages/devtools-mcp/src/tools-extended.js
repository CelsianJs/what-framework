/**
 * Inspection, debugging, visual and navigation tools for what-devtools-mcp.
 */

import { z } from 'zod';
import { isNamed, createResponder, previewValue, pageText, sessionParam, UNTRUSTED_NOTE } from './respond.js';
import { subscriberCounts, fetchState, actionEvents, causeLabels, parseStack, sourceFields, sourceSuffix, asyncFields, stalledWork, registryCoverage } from './tools.js';
import { SAFE_READ_PATHS, normalizeSafeRead } from './safe-read.js';

const label = (map, id) => (map.get(id) ? `${map.get(id)}#${id}` : `#${id}`);

// DOM text in a serialized tree is page text.
function markTree(node) {
  if (!node || typeof node !== 'object') return node;
  const out = { ...node };
  if (typeof out.text === 'string') out.text = pageText(out.text, 200);
  if (Array.isArray(out.children)) out.children = out.children.map(markTree);
  return out;
}

function repeatedComputeds(state) {
  const groups = new Map();
  const components = new Map(state.components.map((c) => [c.id, c.name]));
  const signals = new Map(state.signals.map((s) => [s.id, s.name]));
  for (const e of state.effects) {
    const owner = components.get(e.componentId);
    if (e.kind !== 'computed' || !e.loc || !owner || !e.depSignalIds?.length) continue;
    const deps = [...e.depSignalIds].sort((a, b) => a - b);
    const upstream = [...(e.depComputedIds || [])].sort((a, b) => a - b);
    const key = JSON.stringify([owner, e.loc, deps, upstream]);
    let group = groups.get(key);
    if (!group) {
      group = { owner: `<${owner}>`, loc: e.loc, count: 0, runs: 0, signals: deps.slice(0, 8).map((id) => label(signals, id)) };
      groups.set(key, group);
    }
    group.count++;
    group.runs += e.runCount || 0;
  }
  return [...groups.values()].filter((g) => g.count >= 3).sort((a, b) => b.runs - a.runs).slice(0, 5);
}

function unreadPriority(signal) {
  if (signal.name.startsWith('what-router:')) return 0;
  if (signal.loc && !/\/(?:node_modules|packages\/(?:core|router|server)\/src)\//.test(signal.loc)) return 3;
  return isNamed(signal.name) ? 2 : 1;
}

export function registerExtendedTools(server, bridge) {
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

  async function ask(id, command, args, shape, timeout) {
    const { session, err } = target(id);
    if (err) return err;
    try {
      const answer = await bridge.request(session, command, args, timeout ? { timeout } : undefined);
      if (answer.data?.error) return fail(answer.data.error, shape.hint?.(answer.data));
      return await shape.ok(answer, session);
    } catch (e) {
      return fail(e.message, shape.failHint);
    }
  }

  // ---------------------------------------------------------------------------
  // what_dependency_graph
  // ---------------------------------------------------------------------------

  server.tool(
    'what_dependency_graph',
    'Who reads what: edges are "reads" relations, signal -> computed -> effect (writes are not edges; see what_signal_trace). Focus on one signal (everything that reacts to it, through computeds) or one effect (everything it depends on).',
    {
      signalId: z.number().optional().describe('Focus on this signal'),
      effectId: z.number().optional().describe('Focus on this effect or computed'),
      direction: z.enum(['downstream', 'upstream', 'both']).optional().default('both')
        .describe('downstream = what reacts to the signal; upstream = what the effect reads (default both)'),
      session: sessionParam(z),
    },
    async ({ signalId, effectId, direction, session: sid }) => withState(sid, async ({ state, seq }) => {
      const signals = new Map(state.signals.map((s) => [s.id, s]));
      const effects = new Map(state.effects.map((e) => [e.id, e]));
      const kind = (id) => (effects.get(id)?.kind === 'computed' ? 'computed' : 'effect');
      /** @type {Array<[string, string]>} */
      let edges = [];
      for (const e of effects.values()) {
        for (const sigId of e.depSignalIds || []) edges.push([`signal#${sigId}`, `${kind(e.id)}#${e.id}`]);
        for (const cId of e.depComputedIds || []) edges.push([`computed#${cId}`, `${kind(e.id)}#${e.id}`]);
      }

      const walk = (start, step) => {
        const seen = new Set([start]);
        const kept = [];
        const queue = [start];
        while (queue.length) {
          const node = queue.shift();
          for (const edge of edges) {
            const [from, to] = step(edge);
            if (from !== node) continue;
            kept.push(edge);
            if (!seen.has(to)) { seen.add(to); queue.push(to); }
          }
        }
        return kept;
      };

      if (signalId != null) {
        if (!signals.has(signalId)) return fail(`Signal ${signalId} not found`, 'List ids with what_signals.');
        edges = direction === 'upstream' ? [] : walk(`signal#${signalId}`, (e) => e);
      } else if (effectId != null) {
        if (!effects.has(effectId)) return fail(`Effect ${effectId} not found`, 'List ids with what_effects.');
        const start = `${kind(effectId)}#${effectId}`;
        const up = direction === 'downstream' ? [] : walk(start, ([from, to]) => [to, from]);
        const down = direction === 'upstream' ? [] : walk(start, (e) => e);
        edges = [...up, ...down];
      }

      const focused = signalId != null || effectId != null;
      const used = new Set(edges.flat());
      if (signalId != null) used.add(`signal#${signalId}`);
      if (effectId != null) used.add(`${kind(effectId)}#${effectId}`);
      const sigIds = focused ? [...used].filter((n) => n.startsWith('signal#')).map((n) => Number(n.slice(7))) : [...signals.keys()];
      const effIds = focused ? [...used].filter((n) => !n.startsWith('signal#')).map((n) => Number(n.split('#')[1])) : [...effects.keys()];

      return ok({
        signals: sigIds.map((id) => ({ id, name: signals.get(id)?.name || `signal_${id}`, ...sourceFields(signals.get(id) || {}), value: previewValue(signals.get(id)?.value) })),
        effects: effIds.map((id) => ({ id, name: effects.get(id)?.name || `effect_${id}`, ...sourceFields(effects.get(id) || {}), ...(kind(id) === 'computed' ? { kind: 'computed' } : {}), runs: effects.get(id)?.runCount || 0 })),
        reads: edges.map(([from, to]) => `${from} -> ${to}`),
      }, seq);
    })
  );

  // ---------------------------------------------------------------------------
  // what_eval
  // ---------------------------------------------------------------------------

  // Arbitrary code runs only when the server was started with --unsafe-eval or
  // WHAT_UNSAFE_EVAL=1 (and the page set window.__WHAT_UNSAFE_EVAL__). The
  // fixed reads in safe-read.js work without either and evaluate nothing.
  const unsafeEvalEnabled = process.argv.includes('--unsafe-eval') ||
    process.env.WHAT_UNSAFE_EVAL === '1' ||
    process.env.WHAT_UNSAFE_EVAL === 'true';

  server.tool(
    'what_eval',
    `Read a page value, or run JavaScript in the page. Without --unsafe-eval it answers only these exact reads (no code runs, no page getter is called): ${SAFE_READ_PATHS.join(', ')}. With --unsafe-eval (and window.__WHAT_UNSAFE_EVAL__ in the page) an expression returns its value; statements need return. Prefer the structured tools.`,
    {
      code: z.string().describe('A safe read like "document.title", or (with --unsafe-eval) JavaScript to run'),
      timeout: z.number().optional().default(5000).describe('Max ms (default 5000, max 30000)'),
      session: sessionParam(z),
    },
    async ({ code, timeout, session: sid }) => {
      const path = normalizeSafeRead(code);
      if (!path && !unsafeEvalEnabled) {
        return fail('what_eval is disabled for arbitrary code', `Without --unsafe-eval only these reads work: ${SAFE_READ_PATHS.join(', ')}.`);
      }
      const { session, err } = target(sid);
      if (err) return err;
      try {
        if (path) {
          const { data, seq } = await bridge.request(session, 'read', { path });
          if (data?.error) return fail(data.error);
          const value = data.value;
          return ok({ path, type: Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value, result: typeof value === 'string' ? pageText(value) : value }, seq);
        }
        const { data, seq, since } = await bridge.request(session, 'eval', { code }, { timeout: Math.min(Math.max(timeout || 5000, 100), 30000) });
        if (data?.error) return fail(pageText(data.error, 500), data.stack ? pageText(data.stack, 1500) : undefined);
        return ok({ type: data.type, result: typeof data.result === 'string' ? pageText(data.result) : data.result, ms: data.executionTime, note: UNTRUSTED_NOTE, ...(await actionEvents(bridge, session, since, seq)) }, seq);
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // what_dom_inspect
  // ---------------------------------------------------------------------------

  server.tool(
    'what_dom_inspect',
    'The rendered DOM of one component: structured tree and HTML (page text, in «»).',
    {
      componentId: z.number().describe('Component id (from what_components)'),
      depth: z.number().optional().default(3).describe('Max DOM depth (default 3)'),
      session: sessionParam(z),
    },
    async ({ componentId, depth, session: sid }) => ask(sid, 'dom-inspect', { componentId, depth: depth ?? 3 }, {
      hint: () => 'Ids change on remount; call what_components again. A provider-only component has no DOM.',
      ok: ({ data, seq }) => ok({ componentName: data.componentName, componentId, ...sourceFields(data), html: pageText(data.html, 5000), structure: markTree(data.structure), note: UNTRUSTED_NOTE }, seq),
    })
  );

  // ---------------------------------------------------------------------------
  // what_route
  // ---------------------------------------------------------------------------

  server.tool(
    'what_route',
    'Where the page is: browser (the address bar: path, query, hash) and router (what-router\'s own state: path, params, query, matched pattern, navigating, error), reported separately because a guard can hold the router behind the URL. settled:true means they agree and no navigation is running.',
    { session: sessionParam(z) },
    async ({ session: sid }) => ask(sid, 'route', {}, {
      ok: ({ data, seq }) => ok({
        browser: data.browser,
        router: data.router,
        settled: data.settled,
        ...(data.router ? {} : { note: 'No what-router state on this page: the app does not use what-router.' }),
      }, seq),
    })
  );

  // ---------------------------------------------------------------------------
  // what_why
  // ---------------------------------------------------------------------------

  server.tool(
    'what_why',
    'Explain the last observed run or skip for one effect, binding, component, or DOM element. Pass exactly one target. Returns reads and a bounded graph linking changes to their origin. Recording starts when the browser connects.',
    {
      effectId: z.number().int().optional().describe('Effect or computed id from what_effects'),
      bindingId: z.number().int().optional().describe('Binding effect id from what_effects or what_explain'),
      componentId: z.number().int().optional().describe('Component id from what_components'),
      selector: z.string().min(1).max(500).optional().describe('CSS selector for the element with the binding'),
      session: sessionParam(z),
    },
    async ({ session: sid, ...query }) => {
      if (Object.values(query).filter((v) => v !== undefined).length !== 1) {
        return fail('Pass exactly one of effectId, bindingId, componentId or selector.');
      }
      return ask(sid, 'why', query, {
        ok: ({ data, seq }) => {
          for (const step of data.graph || []) {
            if (step.origin?.targetId) step.origin.targetId = pageText(step.origin.targetId, 120);
          }
          return ok({ ...data, note: UNTRUSTED_NOTE }, seq);
        },
      });
    }
  );

  // ---------------------------------------------------------------------------
  // what_diagnose
  // ---------------------------------------------------------------------------

  server.tool(
    'what_diagnose',
    'Health check in one call: long-running async work, diagnostic codes the app reported, errors, hot effects ranked by runs, the most-subscribed signals, signals nothing reads and effects that read nothing.',
    {
      focus: z.enum(['errors', 'performance', 'reactivity', 'async', 'all']).optional().default('all').describe('Limit the checks (default all)'),
      threshold: z.number().optional().default(5).describe('Runs above which an effect counts as hot (default 5)'),
      pendingMs: z.number().nonnegative().optional().default(5000).describe('Age in ms above which async, transition or Suspense work is flagged'),
      session: sessionParam(z),
    },
    async ({ focus, threshold, pendingMs, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      const signals = state.signals;
      const effects = state.effects;
      const out = { counts: { signals: signals.length, effects: effects.length, components: state.components.length } };
      const issues = [];
      Object.assign(out, registryCoverage(state));
      if (state.droppedBeforeInstall) issues.push('registryTruncated');

      if (focus === 'errors' || focus === 'all') {
        const diagnostics = {};
        for (const d of bridge.getDiagnostics(session)) diagnostics[d.code] = (diagnostics[d.code] || 0) + (d.count || 1);
        const errors = bridge.getErrors(session);
        if (Object.keys(diagnostics).length) {
          out.diagnostics = diagnostics;
          issues.push('diagnostics');
        }
        if (errors.length) {
          out.errors = errors.slice(-5).map((e) => `${e.code || 'ERR_RUNTIME'} ${e.type || 'error'}: ${pageText(e.message, 160)}`);
          issues.push('errors');
        }
      }

      if (focus === 'performance' || focus === 'all') {
        const groups = repeatedComputeds(state);
        if (groups.length) {
          out.repeatedComputeds = groups;
          issues.push('repeatedComputeds');
        }
        const hot = effects
          .filter((e) => (e.runCount || 0) > threshold)
          .sort((a, b) => b.runCount - a.runCount)
          .slice(0, 5)
          .map((e) => `${e.name}#${e.id} ×${e.runCount}${sourceSuffix(e)}`);
        if (hot.length) {
          out.hotEffects = hot;
          issues.push('hotEffects');
        }
        const subs = subscriberCounts(effects);
        const names = new Map(signals.map((s) => [s.id, s.name]));
        const top = [...subs].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([id, n]) => `${names.get(id) || 'signal'}#${id} ×${n}`);
        if (top.length) out.mostSubscribed = top;
      }

      if (focus === 'reactivity' || focus === 'all') {
        const read = new Set(effects.flatMap((e) => e.depSignalIds || []));
        const unread = signals.filter((s) => !read.has(s.id))
          .sort((a, b) => unreadPriority(b) - unreadPriority(a) || (b.rev || 0) - (a.rev || 0) || a.id - b.id);
        const noDeps = effects.filter((e) => e.kind !== 'computed' && !(e.depSignalIds || []).length && !(e.depComputedIds || []).length);
        const written = unread.filter((s) => s.rev > 0 && unreadPriority(s) >= 2);
        if (unread.length) out.unreadSignals = {
          count: unread.length, written: written.length,
          sample: unread.slice(0, 5).map((s) => ({ id: s.id, name: s.name, ...(s.rev ? sourceFields(s) : {}), writes: s.rev || 0 })),
          ...(written.length ? { hint: 'A written signal with no reactive readers may have been read once during setup.' } : {}),
        };
        if (written.length) issues.push('unreadSignals');
        if (noDeps.length) out.effectsWithoutDeps = { count: noDeps.length, sample: noDeps.slice(0, 8).map((e) => `${e.name}#${e.id}`) };
      }

      if (focus === 'async' || focus === 'all') {
        const stalled = stalledWork(state, pendingMs);
        if (stalled) {
          out.stalled = stalled;
          issues.push('stalled');
        }
      }

      out.status = issues.length ? `issues: ${issues.join(', ')}` : 'healthy';
      if (issues.includes('diagnostics') || issues.includes('errors')) {
        out.hint = 'what_errors lists each with owner, location and fix; what_fix({error}) gives the worked example.';
        if (issues.includes('errors')) out.note = UNTRUSTED_NOTE;
      }
      return ok(out, seq);
    })
  );

  // ---------------------------------------------------------------------------
  // what_navigate
  // ---------------------------------------------------------------------------

  server.tool(
    'what_navigate',
    'Navigate the app to a path (relative paths and http(s) URLs only) the way back/forward does, so what-router runs its guards, and wait until it has settled (or timeout). Returns browser and router state like what_route, cancelled:true when a guard refused, and since for what_events.',
    {
      path: z.string().describe('Path to navigate to, e.g. "/dashboard"'),
      replace: z.boolean().optional().default(false).describe('replaceState instead of pushState'),
      timeout: z.number().optional().default(3000).describe('Max ms to wait for the router to settle (default 3000, max 10000)'),
      session: sessionParam(z),
    },
    async ({ path, replace, timeout, session: sid }) => {
      const trimmedPath = path.trim();
      const normalized = trimmedPath.replace(/[\s\x00-\x1f]/g, '').toLowerCase();
      const isRelative = /^[/.#?]/.test(trimmedPath) || !trimmedPath.includes(':');
      if (!isRelative && !/^https?:/.test(normalized)) {
        return fail(`Blocked navigation to unsafe URL: "${path}"`, 'Only relative paths and http(s) URLs are allowed; javascript:, data: and vbscript: are rejected.');
      }
      const wait = Math.min(Math.max(timeout ?? 3000, 0), 10000);
      return ask(sid, 'navigate', { path: trimmedPath, replace, timeout: wait }, {
        ok: async ({ data, seq, since }, session) => ok({
          requested: data.requested,
          browser: data.browser,
          router: data.router,
          settled: data.settled,
          ...(data.cancelled ? { cancelled: true } : {}),
          ...(data.settled ? {} : { hint: `The router had not settled after ${wait} ms; call what_route again.` }),
          ...(await actionEvents(bridge, session, since, seq)),
        }, seq),
      }, wait + 2000);
    }
  );

  // ---------------------------------------------------------------------------
  // what_explain
  // ---------------------------------------------------------------------------

  server.tool(
    'what_explain',
    'Everything about one component: its signals with values, async status, its effects with what they read, run counts and last cause, its rendered DOM, and diagnostics or errors that name it. Ids change on remount; re-query what_components after writes that may remount.',
    {
      componentId: z.number().describe('Component id (from what_components)'),
      includeDOM: z.boolean().optional().default(true).describe('Include rendered HTML (default true)'),
      domDepth: z.number().optional().default(2).describe('DOM depth if included (default 2)'),
      session: sessionParam(z),
    },
    async ({ componentId, includeDOM, domDepth, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      const comp = state.components.find((c) => c.id === componentId);
      if (!comp) return fail(`Component ${componentId} not found`, 'Ids change on remount; call what_components again.');

      const names = session.names;
      const signals = state.signals.filter((s) => s.componentId === componentId)
        .map((s) => ({ id: s.id, name: s.name, ...sourceFields(s), value: previewValue(s.value, 200) }));
      const effects = state.effects.filter((e) => e.componentId === componentId)
        .map((e) => {
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
          };
        });

      /** @type {string | null} */
      let html = null;
      if (includeDOM) {
        try {
          const { data } = await bridge.request(session, 'dom-inspect', { componentId, depth: domDepth || 2 });
          if (!data.error) html = pageText(data.html || '', 2000);
        } catch {
          html = null;
        }
      }

      const ownName = `<${comp.name}>`;
      const diagnostics = bridge.getDiagnostics(session)
        .filter((d) => d.owner?.includes(ownName) || (d.subject?.kind === 'component' && d.subject.name === comp.name))
        .map((d) => `${d.code}${d.count > 1 ? ` ×${d.count}` : ''} ${pageText(d.message, 200)}`);
      const errors = bridge.getErrors(session)
        .filter((e) => parseStack(e.stack, names.components).component === comp.name)
        .map((e) => `${e.code || 'ERR_RUNTIME'} ${e.type || 'error'}: ${pageText(e.message, 200)}`);

      const out = { component: { id: comp.id, name: comp.name, ...sourceFields(comp), parentId: comp.parentId ?? null }, signals, effects };
      if (html !== null) out.html = html;
      if (diagnostics.length) out.diagnostics = diagnostics;
      if (errors.length) out.errors = errors;
      if (html !== null || diagnostics.length || errors.length) out.note = UNTRUSTED_NOTE;
      if (!signals.length && !effects.length) {
        out.ownership = 'Signals and effects belong to the component that created them; state created at module scope or in a parent shows up there, not here.';
      }
      return ok(out, seq);
    })
  );

  // ---------------------------------------------------------------------------
  // what_signal_trace
  // ---------------------------------------------------------------------------

  server.tool(
    'what_signal_trace',
    'Recent writes to one signal, oldest first: value before and after, the effect that wrote it (by; absent for a write from an event handler or what_set_signal), and the effects that re-ran because of it (ran). Plus every reader with its run count. From the session\'s event log.',
    {
      signalId: z.number().describe('Signal id (from what_signals)'),
      limit: z.number().optional().default(5).describe('Writes to show (default 5, max 20)'),
      session: sessionParam(z),
    },
    async ({ signalId, limit, session: sid }) => withState(sid, async ({ session, state, seq }) => {
      const sig = state.signals.find((s) => s.id === signalId);
      if (!sig) return fail(`Signal ${signalId} not found`, 'Ids change when the page reloads; call what_signals again.');
      const names = session.names;
      const log = session.events;

      const writeIndexes = [];
      for (let i = 0; i < log.length; i++) {
        if (log[i].event === 'signal:updated' && log[i].data?.id === signalId) writeIndexes.push(i);
      }
      const shown = writeIndexes.slice(-Math.min(Math.max(limit || 5, 1), 20));
      const writes = shown.map((i) => {
        const w = log[i];
        const nextWrite = writeIndexes.find((j) => j > i) ?? log.length;
        const ran = [];
        for (let j = i + 1; j < nextWrite && ran.length < 8; j++) {
          const e = log[j];
          if (e.event === 'effect:run' && e.data?.causeSignalIds?.includes(signalId)) ran.push(e.data.name ? `${e.data.name}#${e.data.id}` : label(names.effects, e.data.id));
        }
        return {
          seq: w.seq,
          from: previewValue(w.data.prev),
          to: previewValue(w.data.value),
          ...(w.data.writerEffectId != null ? { by: label(names.effects, w.data.writerEffectId) } : {}),
          ...(ran.length ? { ran } : {}),
        };
      });
      const readers = state.effects
        .filter((e) => (e.depSignalIds || []).includes(signalId))
        .map((e) => `${e.name}#${e.id} ×${e.runCount || 0}`);

      const out = { signal: { id: sig.id, name: sig.name, ...sourceFields(sig), value: previewValue(sig.value, 200), writes: sig.rev }, writes, readers };
      if (session.lostThrough && writeIndexes.length < sig.rev) out.lostThrough = session.lostThrough;
      if (!writes.length) out.note = 'No writes recorded since the page connected. Act (what_set_signal, or in the page), then call again.';
      return ok(out, seq);
    })
  );

  // ---------------------------------------------------------------------------
  // what_look
  // ---------------------------------------------------------------------------

  server.tool(
    'what_look',
    'A component\'s visual facts without an image: bounding box, layout, key computed styles, text, child element counts, accessibility. About 300-500 tokens; use before what_screenshot.',
    {
      componentId: z.number().describe('Component id (from what_components)'),
      session: sessionParam(z),
    },
    async ({ componentId, session: sid }) => ask(sid, 'visual-inspect', { componentId }, {
      hint: () => 'Ids change on remount; call what_components again.',
      ok: ({ data, seq }) => {
        const { componentName, boundingRect, styles, textContent, childElements, totalChildren, layout, viewport, accessibility } = data;
        return ok({
          component: componentName,
          ...sourceFields(data),
          boundingRect,
          layout,
          styles,
          textContent: pageText(textContent, 200),
          childElements,
          totalChildren,
          ...(accessibility ? { accessibility: { ...accessibility, ...(accessibility.ariaLabel ? { ariaLabel: pageText(accessibility.ariaLabel, 120) } : {}) } } : {}),
          viewport,
          note: UNTRUSTED_NOTE,
        }, seq);
      },
    })
  );

  // ---------------------------------------------------------------------------
  // what_page_map
  // ---------------------------------------------------------------------------

  server.tool(
    'what_page_map',
    'Map of the visible page without an image: landmarks, interactive elements, headings and What component boundaries with positions.',
    {
      maxElements: z.number().optional().default(200).describe('Max elements (default 200)'),
      session: sessionParam(z),
    },
    async ({ maxElements, session: sid }) => ask(sid, 'page-map', { maxElements: maxElements || 200 }, {
      ok: ({ data, seq }) => ok({
        viewport: data.viewport,
        landmarks: (data.landmarks || []).map((l) => ({ ...l, text: pageText(l.text, 50) })),
        interactives: (data.interactives || []).map((i) => ({ ...i, label: pageText(i.label, 40) })),
        headings: (data.headings || []).map((h) => ({ ...h, text: pageText(h.text, 80) })),
        components: data.components || [],
        totalElements: data.totalElements,
        note: UNTRUSTED_NOTE,
      }, seq),
    })
  );

  // ---------------------------------------------------------------------------
  // what_screenshot
  // ---------------------------------------------------------------------------

  server.tool(
    'what_screenshot',
    'Image of one component, cropped to its bounding box (5-20 KB). Use what_look first; it is cheaper and usually enough.',
    {
      componentId: z.number().describe('Component id (from what_components)'),
      maxWidth: z.number().optional().default(400).describe('Max width in px (default 400)'),
      quality: z.number().optional().default(0.7).describe('JPEG quality 0.1-1.0 (default 0.7)'),
      format: z.enum(['jpeg', 'png']).optional().default('jpeg').describe('Image format (default jpeg)'),
      session: sessionParam(z),
    },
    async ({ componentId, maxWidth, quality, format, session: sid }) => ask(sid, 'component-screenshot', {
      componentId,
      maxWidth: maxWidth || 400,
      quality: quality || 0.7,
      format: format || 'jpeg',
    }, {
      hint: (data) => data.fallback || 'what_look gives the same facts as text.',
      failHint: 'what_look gives the same facts as text.',
      ok: ({ data, seq }) => ({
        content: [
          { type: 'image', data: data.base64, mimeType: data.mimeType || (data.format === 'png' ? 'image/png' : 'image/jpeg') },
          { type: 'text', text: JSON.stringify({ component: data.componentName, ...sourceFields(data), width: data.width, height: data.height, kb: Math.round(data.sizeBytes / 1024), seq }) },
        ],
      }),
    }, 10000)
  );
}
