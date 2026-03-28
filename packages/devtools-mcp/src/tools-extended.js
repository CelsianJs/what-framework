/**
 * Extended MCP tool definitions for what-devtools-mcp.
 * 13 tools: component tree, dependency graph, eval, DOM inspect,
 * route info, diagnostics, diff snapshot, navigate, explain, signal trace,
 * visual inspect (what_look), page map (what_page_map), screenshot (what_screenshot).
 *
 * These supplement the 10 base tools in tools.js.
 */

import { z } from 'zod';

export function registerExtendedTools(server, bridge) {

  // ---------------------------------------------------------------------------
  // Helper responses (local copies — tools.js owns the originals)
  // ---------------------------------------------------------------------------

  function noConnection(tool) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No browser connected',
          summary: `Cannot reach browser for ${tool}.`,
          nextSteps: [
            'Ensure your What Framework app is running with the devtools-mcp Vite plugin enabled.',
            'Or call connectDevToolsMCP() manually in the browser console.',
            'Check that the bridge server is started (default port 9229).',
          ],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function noSnapshot(tool) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'No snapshot available',
          summary: 'Browser is connected but no state snapshot has been received yet.',
          nextSteps: [
            'Try refreshing the page in the browser.',
            'Ensure __WHAT_DEVTOOLS__ is initialized before connectDevToolsMCP().',
          ],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function errorResponse(message, nextSteps) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: message,
          summary: message,
          nextSteps: nextSteps || ['Check the arguments and try again.'],
        }, null, 2),
      }],
      isError: true,
    };
  }

  function ok(data) {
    return {
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    };
  }

  // ---------------------------------------------------------------------------
  // Helper: get a fresh or cached snapshot
  // ---------------------------------------------------------------------------

  async function freshSnapshot(toolName) {
    if (!bridge.isConnected()) return { err: noConnection(toolName) };
    let snapshot;
    try {
      snapshot = bridge.getOrRefreshSnapshot
        ? await bridge.getOrRefreshSnapshot()
        : await bridge.refreshSnapshot();
    } catch {
      snapshot = bridge.getSnapshot();
    }
    if (!snapshot) return { err: noSnapshot(toolName) };
    return { snapshot };
  }

  // ---------------------------------------------------------------------------
  // Tool 1 — what_component_tree
  // ---------------------------------------------------------------------------

  server.tool(
    'what_component_tree',
    'Get the component hierarchy as a tree structure. Shows parent-child relationships, signal/effect counts per component.',
    {
      rootId: z.number().optional().describe('Start from this component ID (default: full tree)'),
      depth: z.number().optional().default(10).describe('Max depth to traverse (default: 10)'),
      filter: z.string().optional().describe('Only include subtrees containing components matching this regex'),
    },
    async ({ rootId, depth, filter }) => {
      const { snapshot, err } = await freshSnapshot('what_component_tree');
      if (err) return err;

      const components = snapshot.components || [];
      if (components.length === 0) {
        return ok({ tree: null, summary: '0 components mounted.' });
      }

      // Index by id
      const byId = new Map();
      for (const c of components) {
        byId.set(c.id, { ...c, children: [] });
      }

      // Check if parentIds are available (framework may not track them)
      const hasParentInfo = components.some(c => c.parentId != null);

      if (!hasParentInfo && components.length > 1) {
        // Framework doesn't track parent-child relationships.
        // Infer: lowest-ID component is the root, all others are its children.
        // This gives a 1-level tree which is better than a flat list.
        const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
        const root = sorted[0];
        for (let i = 1; i < sorted.length; i++) {
          sorted[i].parentId = root.id;
          root.children.push(sorted[i]);
        }
      }

      // Build parent-child links
      const roots = [];
      for (const node of byId.values()) {
        if (node.parentId != null && byId.has(node.parentId)) {
          byId.get(node.parentId).children.push(node);
        } else {
          roots.push(node);
        }
      }
      // Deduplicate children (inferred path may have already added them)
      for (const node of byId.values()) {
        const seen = new Set();
        node.children = node.children.filter(c => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
      }

      // Attach signal/effect counts per component
      const signals = snapshot.signals || [];
      const effects = snapshot.effects || [];
      for (const node of byId.values()) {
        node.signalCount = signals.filter(s => s.componentId === node.id).length;
        node.effectCount = effects.filter(e => e.componentId === node.id).length;
      }

      // Optional filter — keep subtrees that contain a matching node
      let filterRe = null;
      if (filter) {
        try {
          filterRe = new RegExp(filter, 'i');
        } catch {
          return errorResponse(`Invalid regex: ${filter}`, ['Provide a valid JavaScript regex pattern.']);
        }
      }

      function matchesFilter(node) {
        if (!filterRe) return true;
        if (filterRe.test(node.name)) return true;
        return node.children.some(c => matchesFilter(c));
      }

      // Prune to requested depth and serialize
      function toTree(node, currentDepth) {
        if (currentDepth > depth) return null;
        if (filterRe && !matchesFilter(node)) return null;
        const result = {
          id: node.id,
          name: node.name,
          parentId: node.parentId ?? null,
          signalCount: node.signalCount,
          effectCount: node.effectCount,
        };
        const kids = [];
        for (const child of node.children) {
          const serialized = toTree(child, currentDepth + 1);
          if (serialized) kids.push(serialized);
        }
        if (kids.length) result.children = kids;
        return result;
      }

      let tree;
      if (rootId != null) {
        const startNode = byId.get(rootId);
        if (!startNode) {
          return errorResponse(`Component with id ${rootId} not found.`, [
            'Use what_components to list available component IDs.',
          ]);
        }
        tree = toTree(startNode, 0);
      } else {
        tree = roots.map(r => toTree(r, 0)).filter(Boolean);
      }

      // Compute max depth and flat label summary
      let maxDepth = 0;
      let totalNodes = 0;
      function measureDepth(node, d) {
        if (!node) return;
        totalNodes++;
        if (d > maxDepth) maxDepth = d;
        for (const c of (node.children || [])) measureDepth(c, d + 1);
      }
      const treeArray = Array.isArray(tree) ? tree : [tree];
      for (const t of treeArray) measureDepth(t, 0);

      // Build concise label: Root > [Child1, Child2 > [Grandchild]]
      function label(node, d) {
        if (!node) return '';
        let s = node.name || `#${node.id}`;
        const kids = (node.children || []);
        if (kids.length && d < 3) {
          s += ' > [' + kids.map(k => label(k, d + 1)).join(', ') + ']';
        } else if (kids.length) {
          s += ` > [... ${kids.length} children]`;
        }
        return s;
      }
      const labelStr = treeArray.map(t => label(t, 0)).join(', ');

      const summary = `${totalNodes} component${totalNodes !== 1 ? 's' : ''}, max depth ${maxDepth}. ${labelStr}`;

      return ok({ tree, summary });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2 — what_dependency_graph
  // ---------------------------------------------------------------------------

  server.tool(
    'what_dependency_graph',
    'Get the reactive dependency graph showing which signals feed which effects. The unique debugging superpower of What Framework.',
    {
      signalId: z.number().optional().describe('Show graph starting from this signal'),
      effectId: z.number().optional().describe('Show graph starting from this effect'),
      direction: z.enum(['downstream', 'upstream', 'both']).optional().default('both')
        .describe('downstream = who depends on this; upstream = what does this depend on (default: both)'),
    },
    async ({ signalId, effectId, direction }) => {
      const { snapshot, err } = await freshSnapshot('what_dependency_graph');
      if (err) return err;

      const signals = snapshot.signals || [];
      const effects = snapshot.effects || [];

      // Build lookup maps
      const signalMap = new Map(signals.map(s => [s.id, s]));
      const effectMap = new Map(effects.map(e => [e.id, e]));

      // Build edges: effect depends on signal  =>  signal --triggers--> effect
      const allEdges = [];
      for (const eff of effects) {
        const deps = eff.depSignalIds || eff.deps || [];
        for (const sid of deps) {
          allEdges.push({
            from: { type: 'signal', id: sid },
            to: { type: 'effect', id: eff.id },
            relation: 'triggers',
          });
        }
      }

      // If a specific signal or effect is requested, filter the graph
      let filteredEdges = allEdges;
      let nodeIds = null; // Set of "type:id" strings we want to include

      if (signalId != null) {
        if (!signalMap.has(signalId)) {
          return errorResponse(`Signal ${signalId} not found.`, [
            'Use what_signals to list available signal IDs.',
          ]);
        }
        nodeIds = new Set();
        nodeIds.add(`signal:${signalId}`);

        if (direction === 'downstream' || direction === 'both') {
          // Signals that this signal triggers (effects that read it)
          for (const e of allEdges) {
            if (e.from.type === 'signal' && e.from.id === signalId) {
              nodeIds.add(`effect:${e.to.id}`);
            }
          }
        }
        if (direction === 'upstream' || direction === 'both') {
          // Nothing upstream of a signal in the basic model
          // (signals are the roots), but include for completeness
        }

        filteredEdges = allEdges.filter(e => {
          return nodeIds.has(`${e.from.type}:${e.from.id}`) || nodeIds.has(`${e.to.type}:${e.to.id}`);
        });
        // Expand node set from filtered edges
        for (const e of filteredEdges) {
          nodeIds.add(`${e.from.type}:${e.from.id}`);
          nodeIds.add(`${e.to.type}:${e.to.id}`);
        }
      }

      if (effectId != null) {
        if (!effectMap.has(effectId)) {
          return errorResponse(`Effect ${effectId} not found.`, [
            'Use what_effects to list available effect IDs.',
          ]);
        }
        nodeIds = nodeIds || new Set();
        nodeIds.add(`effect:${effectId}`);

        if (direction === 'upstream' || direction === 'both') {
          // Signals that this effect depends on
          const eff = effectMap.get(effectId);
          const deps = eff.depSignalIds || eff.deps || [];
          for (const sid of deps) {
            nodeIds.add(`signal:${sid}`);
          }
        }
        if (direction === 'downstream' || direction === 'both') {
          // Effects don't directly trigger other things in the basic model
        }

        filteredEdges = allEdges.filter(e => {
          return nodeIds.has(`${e.from.type}:${e.from.id}`) || nodeIds.has(`${e.to.type}:${e.to.id}`);
        });
        for (const e of filteredEdges) {
          nodeIds.add(`${e.from.type}:${e.from.id}`);
          nodeIds.add(`${e.to.type}:${e.to.id}`);
        }
      }

      // Build nodes
      const nodeSet = nodeIds || new Set([
        ...signals.map(s => `signal:${s.id}`),
        ...effects.map(e => `effect:${e.id}`),
      ]);

      const nodes = [];
      for (const key of nodeSet) {
        const [type, idStr] = key.split(':');
        const id = Number(idStr);
        if (type === 'signal') {
          const s = signalMap.get(id);
          // Truncate values to avoid token waste — graph topology is what matters
          const raw = s?.value;
          let value;
          if (raw == null) value = raw;
          else if (typeof raw === 'string') value = raw.length > 80 ? raw.slice(0, 80) + '…' : raw;
          else if (Array.isArray(raw)) value = `Array(${raw.length})`;
          else if (typeof raw === 'object') {
            const json = JSON.stringify(raw);
            value = json.length > 80 ? json.slice(0, 80) + '…' : raw;
          } else value = raw;
          nodes.push({ type: 'signal', id, name: s?.name || `signal_${id}`, value });
        } else {
          const e = effectMap.get(id);
          nodes.push({ type: 'effect', id, name: e?.name || `effect_${id}`, runCount: e?.runCount });
        }
      }

      const signalNodes = nodes.filter(n => n.type === 'signal');
      const effectNodes = nodes.filter(n => n.type === 'effect');
      const summary = `${signalNodes.length} signal${signalNodes.length !== 1 ? 's' : ''}, ` +
        `${effectNodes.length} effect${effectNodes.length !== 1 ? 's' : ''}, ` +
        `${filteredEdges.length} edge${filteredEdges.length !== 1 ? 's' : ''}. ` +
        (signalId != null ? `Focused on signal #${signalId}. ` : '') +
        (effectId != null ? `Focused on effect #${effectId}. ` : '') +
        `Direction: ${direction}.`;

      return ok({ nodes, edges: filteredEdges, summary });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 3 — what_eval
  // ---------------------------------------------------------------------------

  // Guard: eval only works when explicitly enabled via --unsafe-eval flag or
  // WHAT_UNSAFE_EVAL=1 environment variable. Disabled by default.
  const unsafeEvalEnabled = process.argv.includes('--unsafe-eval') ||
    process.env.WHAT_UNSAFE_EVAL === '1' ||
    process.env.WHAT_UNSAFE_EVAL === 'true';

  server.tool(
    'what_eval',
    'WARNING: Executes ARBITRARY JavaScript in the browser context. This is a security-sensitive tool that can run any code with full access to window, document, __WHAT_DEVTOOLS__, and __WHAT_CORE__. Disabled by default — must be explicitly enabled with --unsafe-eval flag or WHAT_UNSAFE_EVAL=1 env var. Use for debugging scenarios not covered by other tools. Dev-only.',
    {
      code: z.string().describe('JavaScript code to execute in the browser. Return a value to see it in the response.'),
      timeout: z.number().optional().default(5000).describe('Max execution time in ms (default: 5000, max: 30000)'),
    },
    async ({ code, timeout }) => {
      // Allow safe read-only property access without the unsafe flag
      const trimmed = (code || '').trim();
      const isSafeRead = /^[\w.[\]'"]+$/.test(trimmed) && !trimmed.includes('=') ||
        /^document\.(title|URL|readyState|visibilityState|characterSet|contentType)$/.test(trimmed) ||
        /^window\.(innerWidth|innerHeight|devicePixelRatio|outerWidth|outerHeight)$/.test(trimmed) ||
        /^navigator\.(userAgent|language|platform|onLine|hardwareConcurrency)$/.test(trimmed) ||
        /^location\.(href|hostname|pathname|protocol|port|origin)$/.test(trimmed) ||
        /^screen\.(width|height|availWidth|availHeight|colorDepth)$/.test(trimmed);

      if (!unsafeEvalEnabled && !isSafeRead) {
        return errorResponse(
          'what_eval is disabled for arbitrary code. Safe read-only expressions (document.title, window.innerWidth, etc.) work without the flag.',
          [
            'Safe expressions: document.title, window.innerWidth, navigator.userAgent, location.href, screen.width',
            'For full eval, start the MCP server with --unsafe-eval or WHAT_UNSAFE_EVAL=1',
          ]
        );
      }

      if (!bridge.isConnected()) return noConnection('what_eval');

      const clampedTimeout = Math.min(Math.max(timeout || 5000, 100), 30000);

      try {
        const result = await bridge.sendCommand('eval', { code }, clampedTimeout);
        if (result.error) {
          return errorResponse(result.error, [
            'Check your JavaScript code for syntax or runtime errors.',
            result.stack ? `Stack trace: ${result.stack}` : null,
          ].filter(Boolean));
        }
        const summary = `Executed in ${result.executionTime ?? '?'}ms. ` +
          `Result type: ${result.type}. ` +
          (typeof result.result === 'string'
            ? `Value: "${result.result.substring(0, 100)}${result.result.length > 100 ? '...' : ''}"`
            : `Value: ${JSON.stringify(result.result)?.substring(0, 120) ?? 'undefined'}`);
        return ok({ ...result, summary });
      } catch (e) {
        return errorResponse(e.message, [
          'The browser may have disconnected or the code timed out.',
          'Try a simpler expression or increase the timeout.',
        ]);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4 — what_dom_inspect
  // ---------------------------------------------------------------------------

  server.tool(
    'what_dom_inspect',
    'Get the rendered DOM output of a component. Returns both structured tree and raw HTML.',
    {
      componentId: z.number().describe('Component ID to inspect (from what_components)'),
      depth: z.number().optional().default(3).describe('Max DOM depth (default: 3)'),
    },
    async ({ componentId, depth }) => {
      if (!bridge.isConnected()) return noConnection('what_dom_inspect');

      try {
        const result = await bridge.sendCommand('dom-inspect', { componentId, depth: depth ?? 3 });
        if (result.error) {
          return errorResponse(result.error, [
            'Use what_components to verify the component ID exists.',
            'The component may not have a DOM element (e.g., a context provider).',
          ]);
        }
        const htmlPreview = (result.html || '').substring(0, 200);
        const summary = `Component "${result.componentName || '?'}". ` +
          `HTML (${(result.html || '').length} chars): ${htmlPreview}${(result.html || '').length > 200 ? '...' : ''}`;
        return ok({ ...result, summary });
      } catch (e) {
        return errorResponse(e.message, [
          'The browser may have disconnected.',
          'Try what_components first to get valid component IDs.',
        ]);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 5 — what_route
  // ---------------------------------------------------------------------------

  server.tool(
    'what_route',
    'Get current route information (path, params, query, matched route pattern)',
    {},
    async () => {
      if (!bridge.isConnected()) return noConnection('what_route');

      try {
        const result = await bridge.sendCommand('get-route', {});
        if (result.error) {
          return errorResponse(result.error, [
            'Route info may not be available if the app does not use What Router.',
          ]);
        }
        const params = result.params ? Object.entries(result.params).map(([k, v]) => `${k}=${v}`).join(', ') : '';
        const query = result.query ? Object.entries(result.query).map(([k, v]) => `${k}=${v}`).join(', ') : '';
        const summary = `Path: ${result.path || '/'}` +
          (result.matchedRoute ? ` (pattern: ${result.matchedRoute})` : '') +
          (params ? ` | Params: ${params}` : '') +
          (query ? ` | Query: ${query}` : '') +
          (result.hash ? ` | Hash: ${result.hash}` : '');
        return ok({ ...result, summary });
      } catch (e) {
        return errorResponse(e.message, [
          'The browser may have disconnected.',
          'Route information falls back to window.location if What Router is not used.',
        ]);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 6 — what_diagnose
  // ---------------------------------------------------------------------------

  server.tool(
    'what_diagnose',
    'Run a comprehensive diagnostic check on the app. Identifies errors, performance issues, and reactivity problems in one call.',
    {
      focus: z.enum(['errors', 'performance', 'reactivity', 'all']).optional().default('all')
        .describe('What to focus on (default: all)'),
    },
    async ({ focus }) => {
      const { snapshot, err } = await freshSnapshot('what_diagnose');
      if (err) return err;

      const signals = snapshot.signals || [];
      const effects = snapshot.effects || [];
      const components = snapshot.components || [];
      const errors = bridge.getErrors();
      const recentEvents = bridge.getEvents(Date.now() - 60_000); // last 60s

      const issues = [];
      const healthy = [];

      // --- Error checks ---
      if (focus === 'errors' || focus === 'all') {
        if (errors.length > 0) {
          issues.push({
            severity: 'error',
            category: 'errors',
            message: `${errors.length} runtime error${errors.length !== 1 ? 's' : ''} captured.`,
            details: errors.slice(-5).map(e => e.message || e.error || JSON.stringify(e)),
          });
        } else {
          healthy.push({ category: 'errors', message: 'No runtime errors captured.' });
        }
      }

      // --- Performance checks ---
      if (focus === 'performance' || focus === 'all') {
        const hotEffects = effects.filter(e => (e.runCount || 0) > 50);
        if (hotEffects.length > 0) {
          issues.push({
            severity: 'warning',
            category: 'performance',
            message: `${hotEffects.length} effect${hotEffects.length !== 1 ? 's' : ''} with runCount > 50 (potential hot paths).`,
            details: hotEffects.map(e => ({
              id: e.id,
              name: e.name,
              runCount: e.runCount,
              componentId: e.componentId,
            })),
          });
        } else {
          healthy.push({ category: 'performance', message: 'No hot effects detected (all runCount <= 50).' });
        }

        // Check for excessive recent events (>500 in 60s)
        if (recentEvents.length > 500) {
          issues.push({
            severity: 'warning',
            category: 'performance',
            message: `High event volume: ${recentEvents.length} events in the last 60 seconds.`,
            details: null,
          });
        } else {
          healthy.push({ category: 'performance', message: `Event volume normal: ${recentEvents.length} events in last 60s.` });
        }
      }

      // --- Reactivity checks ---
      if (focus === 'reactivity' || focus === 'all') {
        // Signals with no subscribers (no effect depends on them)
        const subscribedSignalIds = new Set();
        for (const eff of effects) {
          for (const sid of (eff.depSignalIds || eff.deps || [])) {
            subscribedSignalIds.add(sid);
          }
        }
        const orphanSignals = signals.filter(s => !subscribedSignalIds.has(s.id));
        if (orphanSignals.length > 0) {
          issues.push({
            severity: 'info',
            category: 'reactivity',
            message: `${orphanSignals.length} signal${orphanSignals.length !== 1 ? 's' : ''} with no effect subscribers.`,
            details: orphanSignals.slice(0, 10).map(s => ({ id: s.id, name: s.name, value: s.value })),
          });
        } else if (signals.length > 0) {
          healthy.push({ category: 'reactivity', message: 'All signals have at least one subscriber.' });
        }

        // Effects with no dependencies (may be intentional, but worth flagging)
        const noDepsEffects = effects.filter(e => {
          const deps = e.depSignalIds || e.deps || [];
          return deps.length === 0;
        });
        if (noDepsEffects.length > 0) {
          issues.push({
            severity: 'info',
            category: 'reactivity',
            message: `${noDepsEffects.length} effect${noDepsEffects.length !== 1 ? 's' : ''} with no signal dependencies (may be intentional).`,
            details: noDepsEffects.slice(0, 10).map(e => ({ id: e.id, name: e.name, runCount: e.runCount })),
          });
        } else if (effects.length > 0) {
          healthy.push({ category: 'reactivity', message: 'All effects have signal dependencies.' });
        }
      }

      const severity = issues.some(i => i.severity === 'error') ? 'error'
        : issues.some(i => i.severity === 'warning') ? 'warning'
        : issues.length > 0 ? 'info'
        : 'healthy';

      const summary = severity === 'healthy'
        ? `All checks passed. ${signals.length} signals, ${effects.length} effects, ${components.length} components.`
        : `${issues.length} issue${issues.length !== 1 ? 's' : ''} found (${severity}). ` +
          `${healthy.length} check${healthy.length !== 1 ? 's' : ''} passed. ` +
          `${signals.length} signals, ${effects.length} effects, ${components.length} components.`;

      return ok({
        focus,
        severity,
        issues,
        healthy,
        counts: {
          signals: signals.length,
          effects: effects.length,
          components: components.length,
          errors: errors.length,
          recentEvents: recentEvents.length,
        },
        summary,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 7 — what_diff_snapshot
  // ---------------------------------------------------------------------------

  server.tool(
    'what_diff_snapshot',
    'Compare app state between two points in time. Call with action="save" to store a baseline, then action="diff" to see what changed.',
    {
      action: z.enum(['save', 'diff']).describe('save = store current state as baseline; diff = compare current state to saved baseline'),
    },
    async ({ action }) => {
      if (!bridge.isConnected()) return noConnection('what_diff_snapshot');

      if (action === 'save') {
        // Refresh before saving so baseline is current
        try {
          await bridge.refreshSnapshot();
        } catch {
          // Use whatever we have
        }
        const saved = bridge.saveBaseline();
        if (!saved) {
          return errorResponse('No snapshot available to save as baseline.', [
            'Make sure the app has sent at least one snapshot.',
            'Try refreshing the page and calling save again.',
          ]);
        }
        const snap = bridge.getBaseline();
        const summary = `Baseline saved. ${(snap.signals || []).length} signals, ` +
          `${(snap.effects || []).length} effects, ` +
          `${(snap.components || []).length} components at ${new Date().toISOString()}.`;
        return ok({
          action: 'save',
          savedAt: Date.now(),
          signalCount: (snap.signals || []).length,
          effectCount: (snap.effects || []).length,
          componentCount: (snap.components || []).length,
          summary,
        });
      }

      // action === 'diff'
      const baseline = bridge.getBaseline();
      if (!baseline) {
        return errorResponse('No baseline saved. Call with action="save" first.', [
          'Use what_diff_snapshot with action="save" to store a baseline.',
          'Then interact with the app and call action="diff" to see changes.',
        ]);
      }

      // Get fresh current state
      let current;
      try {
        current = await bridge.refreshSnapshot();
      } catch {
        current = bridge.getSnapshot();
      }
      if (!current) return noSnapshot('what_diff_snapshot');

      // --- Diff signals ---
      const baseSignals = new Map((baseline.signals || []).map(s => [s.id, s]));
      const currSignals = new Map((current.signals || []).map(s => [s.id, s]));

      const signalsChanged = [];
      const signalsAdded = [];
      const signalsRemoved = [];

      for (const [id, curr] of currSignals) {
        const base = baseSignals.get(id);
        if (!base) {
          signalsAdded.push({ id, name: curr.name, value: curr.value });
        } else if (JSON.stringify(base.value) !== JSON.stringify(curr.value)) {
          signalsChanged.push({
            id,
            name: curr.name,
            previousValue: base.value,
            currentValue: curr.value,
          });
        }
      }
      for (const [id, base] of baseSignals) {
        if (!currSignals.has(id)) {
          signalsRemoved.push({ id, name: base.name, lastValue: base.value });
        }
      }

      // --- Diff effects ---
      const baseEffects = new Map((baseline.effects || []).map(e => [e.id, e]));
      const currEffects = new Map((current.effects || []).map(e => [e.id, e]));

      const effectsTriggered = [];
      const effectsAdded = [];
      const effectsRemoved = [];

      for (const [id, curr] of currEffects) {
        const base = baseEffects.get(id);
        if (!base) {
          effectsAdded.push({ id, name: curr.name, runCount: curr.runCount });
        } else if ((curr.runCount || 0) > (base.runCount || 0)) {
          effectsTriggered.push({
            id,
            name: curr.name,
            previousRunCount: base.runCount || 0,
            currentRunCount: curr.runCount || 0,
            delta: (curr.runCount || 0) - (base.runCount || 0),
          });
        }
      }
      for (const [id, base] of baseEffects) {
        if (!currEffects.has(id)) {
          effectsRemoved.push({ id, name: base.name });
        }
      }

      // --- Diff components ---
      const baseComps = new Set((baseline.components || []).map(c => c.id));
      const currComps = new Set((current.components || []).map(c => c.id));
      const componentsAdded = (current.components || []).filter(c => !baseComps.has(c.id)).map(c => ({ id: c.id, name: c.name }));
      const componentsRemoved = (baseline.components || []).filter(c => !currComps.has(c.id)).map(c => ({ id: c.id, name: c.name }));

      // --- Errors since baseline ---
      const errorsNew = bridge.getErrors(baseline._savedAt || 0);

      const totalChanges = signalsChanged.length + signalsAdded.length + signalsRemoved.length +
        effectsTriggered.length + effectsAdded.length + effectsRemoved.length +
        componentsAdded.length + componentsRemoved.length;

      const parts = [];
      if (signalsChanged.length) parts.push(`${signalsChanged.length} signal${signalsChanged.length !== 1 ? 's' : ''} changed`);
      if (signalsAdded.length) parts.push(`${signalsAdded.length} signal${signalsAdded.length !== 1 ? 's' : ''} added`);
      if (signalsRemoved.length) parts.push(`${signalsRemoved.length} signal${signalsRemoved.length !== 1 ? 's' : ''} removed`);
      if (effectsTriggered.length) parts.push(`${effectsTriggered.length} effect${effectsTriggered.length !== 1 ? 's' : ''} re-ran`);
      if (effectsAdded.length) parts.push(`${effectsAdded.length} effect${effectsAdded.length !== 1 ? 's' : ''} added`);
      if (effectsRemoved.length) parts.push(`${effectsRemoved.length} effect${effectsRemoved.length !== 1 ? 's' : ''} removed`);
      if (componentsAdded.length) parts.push(`${componentsAdded.length} component${componentsAdded.length !== 1 ? 's' : ''} mounted`);
      if (componentsRemoved.length) parts.push(`${componentsRemoved.length} component${componentsRemoved.length !== 1 ? 's' : ''} unmounted`);
      if (errorsNew.length) parts.push(`${errorsNew.length} new error${errorsNew.length !== 1 ? 's' : ''}`);

      const summary = totalChanges === 0 && errorsNew.length === 0
        ? 'No changes detected since baseline.'
        : parts.join(', ') + '.';

      // Cap large lists to save tokens — show count + sample
      const cap = (arr, limit = 10) => arr.length <= limit ? arr : {
        count: arr.length,
        sample: arr.slice(0, limit),
        truncated: arr.length - limit,
      };

      return ok({
        action: 'diff',
        signalsChanged,
        signalsAdded: cap(signalsAdded),
        signalsRemoved: cap(signalsRemoved),
        effectsTriggered,
        effectsAdded: cap(effectsAdded),
        effectsRemoved: cap(effectsRemoved),
        componentsAdded: cap(componentsAdded),
        componentsRemoved: cap(componentsRemoved),
        errorsNew: errorsNew.length,
        totalChanges,
        summary,
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 8 — what_navigate
  // ---------------------------------------------------------------------------

  server.tool(
    'what_navigate',
    'Navigate to a different route in the app',
    {
      path: z.string().describe('Path to navigate to (e.g. "/dashboard")'),
      replace: z.boolean().optional().default(false).describe('Use replaceState instead of pushState (default: false)'),
    },
    async ({ path, replace }) => {
      if (!bridge.isConnected()) return noConnection('what_navigate');

      try {
        const result = await bridge.sendCommand('navigate', { path, replace });
        if (result.error) {
          return errorResponse(result.error, [
            'Check that the path is valid.',
            'Ensure the app is using What Router or has history API access.',
          ]);
        }
        const summary = `Navigated to "${result.navigatedTo || path}". ` +
          `Current path: ${result.currentPath || '?'}. ` +
          `Method: ${replace ? 'replaceState' : 'pushState'}.`;
        return ok({ ...result, summary });
      } catch (e) {
        return errorResponse(e.message, [
          'The browser may have disconnected.',
          'Try what_connection_status to check connectivity.',
        ]);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 9 — what_explain
  // ---------------------------------------------------------------------------

  server.tool(
    'what_explain',
    'Get a complete picture of a component: its signals with values, effects with deps and run counts, rendered DOM, and any errors. The "tell me everything about this component" tool.',
    {
      componentId: z.number().describe('Component ID to explain (from what_components)'),
      includeDOM: z.boolean().optional().default(true).describe('Include rendered DOM output (default: true)'),
      domDepth: z.number().optional().default(2).describe('Max DOM depth if includeDOM is true (default: 2)'),
    },
    async ({ componentId, includeDOM, domDepth }) => {
      const { snapshot, err } = await freshSnapshot('what_explain');
      if (err) return err;

      const components = snapshot.components || [];
      const comp = components.find(c => c.id === componentId);
      if (!comp) {
        return errorResponse(`Component ${componentId} not found.`, ['Use what_components to list available IDs.']);
      }

      // Signals belonging to this component
      const signals = (snapshot.signals || []).filter(s => s.componentId === componentId);

      // Effects belonging to this component
      const signalMap = new Map((snapshot.signals || []).map(s => [s.id, s]));
      const effects = (snapshot.effects || []).filter(e => e.componentId === componentId).map(e => ({
        ...e,
        depSignalNames: (e.depSignalIds || []).map(sid => signalMap.get(sid)?.name || `signal_${sid}`),
      }));

      // DOM output (if requested and bridge connected)
      let dom = null;
      if (includeDOM) {
        try {
          const domResult = await bridge.sendCommand('dom-inspect', { componentId, depth: domDepth || 2 });
          if (!domResult.error) dom = { html: (domResult.html || '').substring(0, 2000), structure: domResult.structure };
        } catch {}
      }

      // Errors associated with this component
      const errors = bridge.getErrors().filter(e => e.componentId === componentId || e.component === comp.name);

      // Build summary
      const sigPreview = signals.slice(0, 5).map(s => {
        const val = JSON.stringify(s.value);
        return `${s.name}=${val && val.length > 30 ? val.slice(0, 27) + '...' : val}`;
      }).join(', ');
      const effPreview = effects.slice(0, 3).map(e => `${e.name || 'effect_' + e.id} (ran ${e.runCount || 0}x)`).join(', ');

      // Add source file hint based on component name
      const sourceHint = `Component source files are typically in the same directory as the app entry point. Use file search to find: ${comp.name}`;

      const summary = `${comp.name}: ${signals.length} signals (${sigPreview || 'none'}), ` +
        `${effects.length} effects (${effPreview || 'none'})` +
        (errors.length ? `, ${errors.length} errors` : '') +
        (dom ? `, DOM: ${(dom.html || '').substring(0, 80)}...` : '') +
        `. ${sourceHint}`;

      return ok({
        summary,
        component: { id: comp.id, name: comp.name, parentId: comp.parentId },
        sourceHint,
        signals,
        effects,
        dom,
        errors: errors.length > 0 ? errors : [],
        counts: { signals: signals.length, effects: effects.length, errors: errors.length },
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 10 — what_signal_trace
  // ---------------------------------------------------------------------------

  server.tool(
    'what_signal_trace',
    'Trace why a signal changed. Shows which effects wrote to this signal and the causal chain of signal dependencies. The debugging question every developer asks: "why did this value change?"',
    {
      signalId: z.number().describe('Signal ID to trace (from what_signals)'),
      depth: z.number().optional().default(2).describe('Causal chain depth — how many levels of effect->signal->effect to trace (default: 2)'),
    },
    async ({ signalId, depth }) => {
      const { snapshot, err } = await freshSnapshot('what_signal_trace');
      if (err) return err;

      const signals = snapshot.signals || [];
      const effects = snapshot.effects || [];
      const signalMap = new Map(signals.map(s => [s.id, s]));
      const effectMap = new Map(effects.map(e => [e.id, e]));

      const sig = signalMap.get(signalId);
      if (!sig) {
        return errorResponse(`Signal ${signalId} not found.`, ['Use what_signals to list available signal IDs.']);
      }

      // Get writer info from browser
      let writers = { recentWrites: [], totalWrites: 0 };
      try {
        writers = await bridge.sendCommand('get-signal-writers', { signalId }, 5000);
        if (writers.error) writers = { recentWrites: [], totalWrites: 0, note: writers.error };
      } catch {}

      // Build causal chain
      // For each writer effect, find what signals it depends on
      const chain = [];
      const visited = new Set();

      function traceEffect(effectId, currentDepth) {
        if (currentDepth > (depth || 2) || visited.has(`effect:${effectId}`)) return null;
        visited.add(`effect:${effectId}`);

        const eff = effectMap.get(effectId);
        if (!eff) return null;

        const deps = (eff.depSignalIds || []).map(sid => {
          const depSig = signalMap.get(sid);
          return { id: sid, name: depSig?.name || `signal_${sid}`, value: depSig?.value };
        });

        return {
          effectId: eff.id,
          effectName: eff.name || `effect_${eff.id}`,
          runCount: eff.runCount,
          dependsOn: deps,
        };
      }

      // Trace from recent writes
      for (const write of (writers.recentWrites || []).slice(-5)) {
        const entry = {
          timestamp: write.timestamp,
          previousValue: write.previousValue,
          newValue: write.newValue,
        };
        if (write.writerEffect) {
          entry.causedBy = traceEffect(write.writerEffect.id, 1);
        }
        chain.push(entry);
      }

      // Also show which effects READ this signal (downstream)
      const downstream = effects
        .filter(e => (e.depSignalIds || []).includes(signalId))
        .map(e => ({ id: e.id, name: e.name || `effect_${e.id}`, runCount: e.runCount }));

      // Build summary
      const writerNames = chain
        .filter(c => c.causedBy)
        .map(c => c.causedBy.effectName)
        .filter((v, i, a) => a.indexOf(v) === i); // unique

      const summary = writerNames.length > 0
        ? `Signal "${sig.name}" (current: ${JSON.stringify(sig.value)}) was written by: ${writerNames.join(', ')}. ` +
          `${downstream.length} effect${downstream.length !== 1 ? 's' : ''} read this signal.`
        : `Signal "${sig.name}" (current: ${JSON.stringify(sig.value)}). No recent write events captured. ` +
          `${downstream.length} effect${downstream.length !== 1 ? 's' : ''} read this signal.`;

      return ok({
        summary,
        signalId,
        signalName: sig.name,
        currentValue: sig.value,
        recentWrites: chain,
        downstream,
        totalWritesCaptured: writers.totalWrites || 0,
        nextSteps: [
          chain.length === 0 ? 'Use what_watch to capture events, then call what_signal_trace again.' : null,
          downstream.length > 0 ? `Use what_dependency_graph with signalId=${signalId} to see the full reactive graph.` : null,
          'Use what_set_signal to test what happens when this signal changes.',
        ].filter(Boolean),
      });
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 11 — what_look (visual inspection without image)
  // ---------------------------------------------------------------------------

  server.tool(
    'what_look',
    'Get computed visual info about a component WITHOUT an image: bounding rect, key CSS styles, text content, child element types, accessibility info, and layout classification. Much cheaper than a screenshot (~300-500 tokens). Use this first before what_screenshot.',
    {
      componentId: z.number().describe('Component ID (from what_components)'),
    },
    async ({ componentId }) => {
      if (!bridge.isConnected()) return noConnection('what_look');

      try {
        const result = await bridge.sendCommand('visual-inspect', { componentId }, 5000);
        if (result.error) {
          return errorResponse(result.error, ['Use what_components to list available IDs.']);
        }

        const { componentName, boundingRect, styles, textContent, childElements, totalChildren, layout, viewport, accessibility } = result;

        const styleDesc = Object.entries(styles || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
        const childDesc = Object.entries(childElements || {}).map(([k, v]) => `${v} ${k}${v > 1 ? 's' : ''}`).join(', ');

        const summary = `${componentName}: ${boundingRect.width}×${boundingRect.height}px at (${boundingRect.x},${boundingRect.y}). ` +
          `Layout: ${layout}. ` +
          (childDesc ? `Contains: ${childDesc}. ` : '') +
          (textContent && textContent !== '(empty)' ? `Text: "${textContent.substring(0, 80)}${textContent.length > 80 ? '...' : ''}"` : 'No text content.');

        return ok({
          summary,
          component: componentName,
          boundingRect,
          layout,
          styles,
          textContent,
          childElements,
          totalChildren,
          accessibility,
          viewport,
        });
      } catch (e) {
        return errorResponse(`Failed: ${e.message}`, ['Check what_connection_status']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 12 — what_page_map (full page layout skeleton)
  // ---------------------------------------------------------------------------

  server.tool(
    'what_page_map',
    'Get a structured map of the entire visible page: landmarks, interactive elements, headings, and WhatFW component boundaries with positions. No image — pure structured text (~500-1000 tokens). Use this to understand the full page layout.',
    {
      maxElements: z.number().optional().default(200).describe('Max elements to include (default: 200)'),
    },
    async ({ maxElements }) => {
      if (!bridge.isConnected()) return noConnection('what_page_map');

      try {
        const result = await bridge.sendCommand('page-map', { maxElements: maxElements || 200 }, 5000);
        if (result.error) {
          return errorResponse(result.error);
        }

        const { viewport, landmarks, interactives, headings, components, totalElements } = result;

        const summary = `Page map: ${viewport.width}×${viewport.height} viewport. ` +
          `${landmarks?.length || 0} landmarks, ` +
          `${interactives?.length || 0} interactive elements, ` +
          `${headings?.length || 0} headings, ` +
          `${components?.length || 0} WhatFW components. ` +
          `${totalElements} total elements mapped.`;

        return ok({
          summary,
          viewport,
          landmarks: landmarks || [],
          interactives: interactives || [],
          headings: headings || [],
          components: components || [],
          totalElements,
        });
      } catch (e) {
        return errorResponse(`Failed: ${e.message}`, ['Check what_connection_status']);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 13 — what_screenshot (component-level screenshot via foreignObject SVG)
  // ---------------------------------------------------------------------------

  server.tool(
    'what_screenshot',
    'Capture a component-level screenshot. Returns a base64-encoded image cropped to JUST the component bounding box (5-20KB, not a full page screenshot). Use what_look first for cheaper text-based inspection.',
    {
      componentId: z.number().describe('Component ID (from what_components)'),
      maxWidth: z.number().optional().default(400).describe('Max image width in px — smaller = faster + cheaper (default: 400)'),
      quality: z.number().optional().default(0.7).describe('JPEG quality 0.1-1.0 (default: 0.7)'),
      format: z.enum(['jpeg', 'png']).optional().default('jpeg').describe('Image format — jpeg is smaller (default: jpeg)'),
    },
    async ({ componentId, maxWidth, quality, format }) => {
      if (!bridge.isConnected()) return noConnection('what_screenshot');

      try {
        const result = await bridge.sendCommand('component-screenshot', {
          componentId,
          maxWidth: maxWidth || 400,
          quality: quality || 0.7,
          format: format || 'jpeg',
        }, 10000); // 10s timeout for rendering

        if (result.error) {
          return errorResponse(result.error, [
            result.fallback || 'Use what_look for text-based visual info.',
            'Use what_dom_inspect for HTML structure.',
          ]);
        }

        const sizeKB = Math.round(result.sizeBytes / 1024);
        const summary = `Screenshot of "${result.componentName}": ${result.width}x${result.height}px, ${sizeKB}KB ${result.format.toUpperCase()}`;

        // Return MCP image content block + metadata text
        return {
          content: [
            {
              type: 'image',
              data: result.base64,
              mimeType: result.mimeType || (result.format === 'png' ? 'image/png' : 'image/jpeg'),
            },
            {
              type: 'text',
              text: JSON.stringify({
                summary,
                componentName: result.componentName,
                width: result.width,
                height: result.height,
                sizeKB,
                format: result.format,
              }, null, 2),
            },
          ],
        };
      } catch (e) {
        return errorResponse(`Screenshot failed: ${e.message}`, [
          'Use what_look for text-based visual info without an image.',
          'Use what_dom_inspect for HTML structure.',
        ]);
      }
    }
  );
}
