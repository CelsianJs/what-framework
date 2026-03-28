/**
 * MCP tool definitions and handlers for what-devtools-mcp.
 * 10 tools: 7 read, 2 write, 1 observe.
 */

import { z } from 'zod';

export function registerTools(server, bridge) {
  // --- Helpers ---

  /** Build a signalId -> name lookup map from any snapshot */
  function buildSignalNameMap(snapshot) {
    const map = {};
    for (const s of snapshot?.signals || []) map[s.id] = s.name;
    return map;
  }

  /** Build a compact component tree string like "App > [Header, Main > [Counter, Form]]" */
  function buildComponentTreeSummary(components) {
    if (!components || components.length === 0) return { tree: '(empty)', depth: 0 };
    // Attempt to build tree from parent references; fallback to flat list
    const byId = {};
    const roots = [];
    for (const c of components) {
      byId[c.id] = { ...c, children: [] };
    }
    for (const c of components) {
      if (c.parentId != null && byId[c.parentId]) {
        byId[c.parentId].children.push(byId[c.id]);
      } else {
        roots.push(byId[c.id]);
      }
    }
    function summarize(node, depth) {
      if (depth > 5) return '...';
      const name = node.name || `component_${node.id}`;
      if (node.children.length === 0) return name;
      const kids = node.children.map(c => summarize(c, depth + 1)).join(', ');
      return `${name} > [${kids}]`;
    }
    // Compute max depth
    function maxDepth(node, d) {
      if (node.children.length === 0) return d;
      return Math.max(...node.children.map(c => maxDepth(c, d + 1)));
    }
    const depth = roots.length > 0 ? Math.max(...roots.map(r => maxDepth(r, 1))) : 0;
    const tree = roots.map(r => summarize(r, 0)).join(', ');
    return { tree, depth };
  }

  // --- Read Tools ---

  server.tool(
    'what_connection_status',
    'Bootstrap endpoint: check connection, get app info, see available tools and recommended workflow',
    {},
    async () => {
      const connected = bridge.isConnected();
      const snapshot = bridge.getSnapshot();
      const signalCount = snapshot?.signals?.length || 0;
      const effectCount = snapshot?.effects?.length || 0;
      const componentCount = snapshot?.components?.length || 0;

      // Try to get app metadata from the browser
      let appInfo = null;
      if (connected) {
        try {
          appInfo = await bridge.sendCommand('get-app-info');
          // If the client doesn't support this command, appInfo may be null or have an error
          if (appInfo?.error) appInfo = null;
        } catch {
          // Old client without get-app-info support — skip gracefully
          appInfo = null;
        }
      }

      let summary;
      if (!connected) {
        summary = 'No browser connected. Start your app with the what-devtools-mcp Vite plugin and refresh the page.';
      } else if (!snapshot) {
        summary = 'Browser connected but no snapshot received yet. Try refreshing the page.';
      } else {
        summary = `Connected to ${appInfo?.title || 'app'} at ${appInfo?.url || 'unknown URL'}. ${signalCount} signals, ${effectCount} effects, ${componentCount} components.`;
      }

      const result = {
        summary,
        connected,
        hasSnapshot: snapshot !== null,
        // App info (from browser)
        app: appInfo ? {
          url: appInfo.url,
          title: appInfo.title,
          viewport: appInfo.viewport,
          version: appInfo.version,
          entryPoint: appInfo.entryPoint,
        } : null,
        // Counts
        signalCount,
        effectCount,
        componentCount,
        // Framework primer for agents that don't know WhatFW
        framework: 'What Framework: signal-based reactivity. Components run ONCE (not like React). signal(val) for state — read with sig(), write with sig(newVal). effect() for side effects. computed() for derived values. Import from "what-framework".',
        // Recommended next steps
        workflow: connected ? [
          'what_components — see component tree and IDs',
          'what_signals {filter: "yourSignalName"} — check specific state (always filter!)',
          'what_diagnose — one-call health check',
          'what_look {componentId: N} — visual info without screenshot',
          'what_errors — check for runtime errors',
        ] : [
          'Make sure your app is running with the what-devtools-mcp Vite plugin',
          'Or manually call connectDevToolsMCP() in your browser console',
        ],
        // Tool catalog so agents know what's available
        tools: [
          { name: 'what_components', desc: 'List mounted components with IDs' },
          { name: 'what_signals', desc: 'List signals with values (use filter!)' },
          { name: 'what_effects', desc: 'List effects with deps and run counts' },
          { name: 'what_explain', desc: 'Everything about one component (signals + effects + DOM + errors)' },
          { name: 'what_look', desc: 'Visual info without image: styles, layout, dimensions' },
          { name: 'what_screenshot', desc: 'Cropped component screenshot (5-20KB)' },
          { name: 'what_page_map', desc: 'Full page layout skeleton' },
          { name: 'what_diagnose', desc: 'One-call health check (errors + perf + reactivity)' },
          { name: 'what_errors', desc: 'Runtime errors with fix suggestions' },
          { name: 'what_signal_trace', desc: 'Why did a signal change? Causal chain.' },
          { name: 'what_dependency_graph', desc: 'Reactive dependency graph' },
          { name: 'what_watch', desc: 'Observe events over a time window' },
          { name: 'what_set_signal', desc: 'Change a signal value in the live app' },
          { name: 'what_lint', desc: 'Static analysis for code (no browser needed)' },
          { name: 'what_scaffold', desc: 'Generate boilerplate (no browser needed)' },
          { name: 'what_fix', desc: 'Error diagnosis with code examples (no browser needed)' },
        ],
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_signals',
    'List all reactive signals with current values. Filter by name regex or ID. Named signals are sorted first for relevance.',
    {
      filter: z.string().optional().describe('Regex to filter signal names (ignored if id is set)'),
      id: z.number().optional().describe('Get a specific signal by ID (takes precedence over filter)'),
      limit: z.number().optional().default(20).describe('Max signals to return (default: 20, max: 100)'),
      named_only: z.boolean().optional().default(false).describe('If true, only return signals with debug names (filters out anonymous internal signals)'),
    },
    async ({ filter, id, limit, named_only }) => {
      if (!bridge.isConnected()) {
        return noConnection('what_signals');
      }
      const snapshot = await bridge.getOrRefreshSnapshot();
      if (!snapshot) return noSnapshot();

      let signals = snapshot.signals || [];
      const totalCount = signals.length;

      if (id != null) {
        signals = signals.filter(s => s.id === id);
      } else if (filter) {
        try {
          const re = new RegExp(filter, 'i');
          signals = signals.filter(s => re.test(s.name));
        } catch {
          return error(`Invalid regex: ${filter}`);
        }
      }

      // Sort: named signals first (more useful), then by ID
      signals.sort((a, b) => {
        const aHasName = a.name && !a.name.startsWith('signal_');
        const bHasName = b.name && !b.name.startsWith('signal_');
        if (aHasName && !bHasName) return -1;
        if (!aHasName && bHasName) return 1;
        return a.id - b.id;
      });

      // Filter to named-only if requested
      if (named_only) {
        signals = signals.filter(s => s.name && !s.name.startsWith('signal_') && !s.name.startsWith('effect_'));
      }

      // Clean up circular references in values
      signals = signals.map(s => {
        const val = s.value;
        if (val === '[Circular]' || (typeof val === 'string' && val.includes('[Circular]'))) {
          return { ...s, value: '[ref]', _circular: true };
        }
        // Truncate large array/object values
        if (typeof val === 'object' && val !== null) {
          const str = JSON.stringify(val);
          if (str && str.length > 200) {
            return { ...s, value: str.substring(0, 197) + '...', _truncated: true };
          }
        }
        return s;
      });

      // Apply limit AFTER sorting and filtering
      const totalBeforeLimit = signals.length;
      signals = signals.slice(0, Math.min(limit || 20, 100));

      // Build summary
      const valuePreviews = signals.slice(0, 5).map(s => {
        const val = typeof s.value === 'string' ? `'${s.value}'` : JSON.stringify(s.value);
        const truncated = val && val.length > 40 ? val.slice(0, 37) + '...' : val;
        return `${s.name}=${truncated}`;
      });
      const filterNote = id != null ? ` 1 matched id=${id}.` : filter ? ` ${signals.length} match filter '${filter}'.` : '';
      const valuesNote = valuePreviews.length > 0 ? ` Values: ${valuePreviews.join(', ')}` : '';
      const moreNote = signals.length > 5 ? `, ... (${signals.length - 5} more)` : '';
      const limitNote = totalBeforeLimit > signals.length ? ` Showing ${signals.length} of ${totalBeforeLimit} (use limit param for more).` : '';
      const summary = `${totalCount} signals total.${filterNote}${valuesNote}${moreNote}${limitNote}`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ summary, count: signals.length, signals }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_effects',
    'List all active effects with dependency signal IDs, run counts, and timing',
    {
      minRunCount: z.number().optional().describe('Only show effects with runCount >= this value'),
      filter: z.string().optional().describe('Regex pattern to filter effect names'),
      depSignalId: z.number().optional().describe('Find effects that depend on this signal ID'),
    },
    async ({ minRunCount, filter, depSignalId }) => {
      if (!bridge.isConnected()) return noConnection('what_effects');
      const snapshot = await bridge.getOrRefreshSnapshot();
      if (!snapshot) return noSnapshot();

      let effects = snapshot.effects || [];
      const totalCount = effects.length;

      if (minRunCount != null) {
        effects = effects.filter(e => (e.runCount || 0) >= minRunCount);
      }

      if (filter) {
        try {
          const re = new RegExp(filter, 'i');
          effects = effects.filter(e => re.test(e.name || ''));
        } catch {
          return error(`Invalid regex: ${filter}`);
        }
      }

      if (depSignalId != null) {
        effects = effects.filter(e => (e.depSignalIds || []).includes(depSignalId));
      }

      // Resolve dependency signal IDs to names
      const signalNames = buildSignalNameMap(snapshot);
      effects = effects.map(e => ({
        ...e,
        depSignalNames: (e.depSignalIds || []).map(sid => signalNames[sid] || `signal_${sid}`),
      }));

      // Build summary
      const hotEffects = effects.filter(e => (e.runCount || 0) >= 50);
      const hotNote = hotEffects.length > 0
        ? ` ${hotEffects.length} have run 50+ times (${hotEffects.slice(0, 3).map(e => e.name || `effect_${e.id}`).join(', ')}) — may indicate hot paths.`
        : '';
      const summary = `${totalCount} effects tracked. ${effects.length} returned after filters.${hotNote}`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ summary, count: effects.length, effects }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_components',
    'List all mounted What Framework components',
    {
      filter: z.string().optional().describe('Regex pattern to filter component names'),
    },
    async ({ filter }) => {
      if (!bridge.isConnected()) return noConnection('what_components');
      const snapshot = await bridge.getOrRefreshSnapshot();
      if (!snapshot) return noSnapshot();

      let components = snapshot.components || [];
      const totalCount = components.length;

      if (filter) {
        try {
          const re = new RegExp(filter, 'i');
          components = components.filter(c => re.test(c.name || ''));
        } catch {
          return error(`Invalid regex: ${filter}`);
        }
      }

      // Build tree summary
      const { tree, depth } = buildComponentTreeSummary(components);

      // Add source file hint based on component names
      const sourceHint = 'Component source files are typically in the same directory as the app entry point. Use file search to find: ' +
        components.slice(0, 5).map(c => c.name).filter(Boolean).join(', ');

      const summary = `${totalCount} components mounted. Tree depth: ${depth}. Root: ${tree}. ${sourceHint}`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary,
            count: components.length,
            sourceHint,
            components,
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_snapshot',
    'Get a full state snapshot (signals, effects, components, errors). Refreshes from browser. Use diff=true to get only changes since last snapshot.',
    {
      maxSignals: z.number().optional().default(100).describe('Max signals to return (default: 100)'),
      maxEffects: z.number().optional().default(100).describe('Max effects to return (default: 100)'),
      diff: z.boolean().optional().default(false).describe('If true, returns only changes since the last snapshot call (default: false)'),
    },
    async ({ maxSignals, maxEffects, diff }) => {
      if (!bridge.isConnected()) return noConnection('what_snapshot');

      // Store previous snapshot for diff mode
      const previousSnapshot = diff ? bridge.getSnapshot() : null;

      const snapshot = await bridge.getOrRefreshSnapshot();
      if (!snapshot) return noSnapshot();

      const allSignals = snapshot.signals || [];
      const allEffects = snapshot.effects || [];
      const allComponents = snapshot.components || [];
      const allErrors = bridge.getErrors();

      // --- Diff mode ---
      if (diff && previousSnapshot) {
        const prevSignals = new Map((previousSnapshot.signals || []).map(s => [s.id, s]));
        const prevEffects = new Map((previousSnapshot.effects || []).map(e => [e.id, e]));
        const prevComps = new Set((previousSnapshot.components || []).map(c => c.id));

        const signalsChanged = [];
        const signalsAdded = [];
        for (const sig of allSignals) {
          const prev = prevSignals.get(sig.id);
          if (!prev) {
            signalsAdded.push(sig);
          } else if (JSON.stringify(prev.value) !== JSON.stringify(sig.value)) {
            signalsChanged.push({ ...sig, previousValue: prev.value });
          }
        }

        const signalsRemoved = (previousSnapshot.signals || [])
          .filter(s => !allSignals.find(cur => cur.id === s.id))
          .map(s => ({ id: s.id, name: s.name }));

        const effectsTriggered = allEffects
          .filter(e => {
            const prev = prevEffects.get(e.id);
            return prev && (e.runCount || 0) > (prev.runCount || 0);
          })
          .map(e => ({
            ...e,
            delta: (e.runCount || 0) - (prevEffects.get(e.id)?.runCount || 0),
          }));

        const componentsAdded = allComponents.filter(c => !prevComps.has(c.id));
        const componentsRemoved = (previousSnapshot.components || [])
          .filter(c => !allComponents.find(cur => cur.id === c.id));

        const totalChanges = signalsChanged.length + signalsAdded.length + signalsRemoved.length +
          effectsTriggered.length + componentsAdded.length + componentsRemoved.length;

        const parts = [];
        if (signalsChanged.length) parts.push(`${signalsChanged.length} signal(s) changed`);
        if (signalsAdded.length) parts.push(`${signalsAdded.length} signal(s) added`);
        if (signalsRemoved.length) parts.push(`${signalsRemoved.length} signal(s) removed`);
        if (effectsTriggered.length) parts.push(`${effectsTriggered.length} effect(s) re-ran`);
        if (componentsAdded.length) parts.push(`${componentsAdded.length} component(s) mounted`);
        if (componentsRemoved.length) parts.push(`${componentsRemoved.length} component(s) unmounted`);

        const diffSummary = totalChanges === 0
          ? 'No changes since last snapshot.'
          : `${totalChanges} changes: ${parts.join(', ')}.`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              mode: 'diff',
              summary: diffSummary,
              totalChanges,
              signalsChanged,
              signalsAdded,
              signalsRemoved,
              effectsTriggered,
              componentsAdded,
              componentsRemoved,
            }, null, 2),
          }],
        };
      }

      // --- Full snapshot mode ---

      // Detect hot effects
      const hotEffects = allEffects
        .filter(e => (e.runCount || 0) >= 50)
        .map(e => ({ id: e.id, name: e.name, runCount: e.runCount }));

      const summaryObj = {
        signals: allSignals.length,
        effects: allEffects.length,
        components: allComponents.length,
        errors: allErrors.length,
        hotEffects,
      };

      // Truncation
      const truncatedSignals = allSignals.length > maxSignals;
      const truncatedEffects = allEffects.length > maxEffects;
      const signals = truncatedSignals ? allSignals.slice(0, maxSignals) : allSignals;
      const effects = truncatedEffects ? allEffects.slice(0, maxEffects) : allEffects;

      const result = {
        mode: 'full',
        summary: summaryObj,
        signals,
        effects,
        components: allComponents,
      };

      if (truncatedSignals || truncatedEffects) {
        result.truncated = true;
        result.totalCounts = {
          signals: allSignals.length,
          effects: allEffects.length,
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(result, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_errors',
    'Get captured runtime errors with structured classification, severity, and actionable suggestions. Filter by timestamp or severity.',
    {
      since: z.number().optional().describe('Only errors after this Unix timestamp (ms)'),
      severity: z.enum(['error', 'warning', 'all']).optional().default('all').describe('Filter by severity (default: all)'),
    },
    async ({ since, severity }) => {
      if (!bridge.isConnected()) return noConnection('what_errors');
      let errors = bridge.getErrors(since);

      // Classify each error with structured codes and suggestions
      const classified = errors.map((err, idx) => {
        const msg = err.message || err.error || '';
        let classification = {
          id: `err_${idx}`,
          severity: 'error',
          code: 'ERR_RUNTIME',
          message: msg,
          timestamp: err.timestamp,
          file: err.file || null,
          line: err.line || null,
          component: err.component || null,
          suggestion: 'Check the stack trace and component context for more details.',
          codeExample: null,
        };

        // Classify by pattern matching
        if (msg.includes('infinite effect loop') || msg.includes('25 iterations')) {
          classification.code = 'ERR_INFINITE_EFFECT';
          classification.severity = 'error';
          classification.suggestion = 'An effect reads and writes the same signal. Use untrack() for the read, or restructure into separate effects.';
          classification.codeExample = 'effect(() => { count(untrack(count) + 1); });';
        } else if (msg.includes('hydration') || msg.includes('Hydration')) {
          classification.code = 'ERR_HYDRATION_MISMATCH';
          classification.severity = 'error';
          classification.suggestion = 'Server and client HTML differ. Avoid browser APIs in initial render. Use onMount() for client-only code.';
        } else if (msg.includes('Signal.set() called inside a computed')) {
          classification.code = 'ERR_SIGNAL_WRITE_IN_RENDER';
          classification.severity = 'error';
          classification.suggestion = 'Move signal writes into event handlers or effects. Component body should only read signals.';
        } else if (msg.includes('not a function') || msg.includes('is not defined')) {
          classification.code = 'ERR_IMPORT_ERROR';
          classification.severity = 'error';
          classification.suggestion = 'Check that the import name matches a valid what-framework export. Use what_fix for the full API list.';
        }

        // Copy extra fields from original error
        if (err.effectName) classification.effect = err.effectName;
        if (err.effect) classification.effect = classification.effect || err.effect;
        if (err.stack) classification.stack = err.stack;

        return classification;
      });

      // Filter by severity
      let filtered = classified;
      if (severity && severity !== 'all') {
        filtered = classified.filter(e => e.severity === severity);
      }

      // Build summary
      let summary;
      if (filtered.length === 0) {
        summary = 'No errors captured.';
      } else {
        const mostRecent = filtered[filtered.length - 1];
        const ageMs = Date.now() - (mostRecent.timestamp || 0);
        const ageSec = Math.round(ageMs / 1000);
        const ageStr = ageSec < 60 ? `${ageSec}s ago` : `${Math.round(ageSec / 60)}m ago`;

        // Group by code
        const codeCounts = {};
        for (const e of filtered) {
          codeCounts[e.code] = (codeCounts[e.code] || 0) + 1;
        }
        const breakdown = Object.entries(codeCounts).map(([code, count]) => `${count} ${code}`).join(', ');

        summary = `${filtered.length} errors captured. Breakdown: ${breakdown}. Most recent: ${mostRecent.code} (${ageStr}).`;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary,
            count: filtered.length,
            errors: filtered,
            nextSteps: [
              'Use what_fix with the error code for detailed diagnosis and fix examples',
              'Use what_signals to check signal values referenced in the error',
              'Use what_effects to inspect the failing effect\'s dependencies',
              'Use what_lint to scan your code for common patterns that cause these errors',
            ],
          }, null, 2),
        }],
      };
    }
  );

  server.tool(
    'what_cache',
    'Inspect SWR/useQuery cache entries from the running app',
    {
      key: z.string().optional().describe('Filter cache entries by key (substring match)'),
    },
    async ({ key }) => {
      if (!bridge.isConnected()) return noConnection('what_cache');
      try {
        let cache = await bridge.getCacheSnapshot();
        const entries = Array.isArray(cache) ? cache : [];

        let filtered = entries;
        if (key) {
          filtered = entries.filter(e => (e.key || '').includes(key));
        }

        // Build summary
        const staleEntries = filtered.filter(e => {
          if (!e.timestamp) return false;
          return Date.now() - e.timestamp > 30000;
        });
        const keys = filtered.slice(0, 5).map(e => e.key).filter(Boolean);
        const moreNote = filtered.length > 5 ? `, ... (${filtered.length - 5} more)` : '';
        const staleNote = staleEntries.length > 0 ? ` ${staleEntries.length} stale (> 30s old).` : '';
        const keyNote = keys.length > 0 ? ` Keys: ${keys.join(', ')}${moreNote}` : '';
        const summary = `${filtered.length} cache entries.${staleNote}${keyNote}`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ summary, count: filtered.length, entries: filtered }, null, 2),
          }],
        };
      } catch (e) {
        return error(e.message);
      }
    }
  );

  // --- Write Tools ---

  server.tool(
    'what_set_signal',
    'Set a signal value in the running app. Returns previous and new values.',
    {
      signalId: z.number().describe('The signal ID to update (from what_signals)'),
      value: z.any().describe('The new value to set (JSON-compatible)'),
    },
    async ({ signalId, value }) => {
      if (!bridge.isConnected()) return noConnection('what_set_signal');
      try {
        const result = await bridge.sendCommand('set-signal', { signalId, value });
        if (result.error) return error(result.error);

        const summary = `Signal ${signalId} updated. Previous: ${JSON.stringify(result.previousValue)}, New: ${JSON.stringify(result.newValue ?? value)}`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ summary, success: true, signalId, ...result }, null, 2),
          }],
        };
      } catch (e) {
        return error(e.message);
      }
    }
  );

  server.tool(
    'what_invalidate_cache',
    'Force-refresh a cache key in the running app',
    {
      key: z.string().describe('The cache key to invalidate'),
    },
    async ({ key }) => {
      if (!bridge.isConnected()) return noConnection('what_invalidate_cache');
      try {
        const result = await bridge.sendCommand('invalidate-cache', { key });
        if (result.error) return error(result.error);

        const summary = `Cache key '${key}' invalidated successfully.`;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ summary, success: true, key }, null, 2),
          }],
        };
      } catch (e) {
        return error(e.message);
      }
    }
  );

  // --- Observe Tool ---

  server.tool(
    'what_watch',
    'Watch for reactive changes over a time window. Blocks for the specified duration, then returns collected events. Event types: signal:created, signal:updated, signal:disposed, effect:created, effect:run, effect:disposed, error:captured, component:mounted, component:unmounted',
    {
      duration: z.number().optional().default(3000).describe('Duration in ms to collect events (default: 3000, max: 30000)'),
      filter: z.string().optional().describe('Regex to filter event names (e.g. "signal:updated")'),
    },
    async ({ duration, filter }) => {
      if (!bridge.isConnected()) return noConnection('what_watch');

      const ms = Math.min(Math.max(duration || 3000, 100), 30000);
      const startTime = Date.now();

      // Wait for the duration
      await new Promise(resolve => setTimeout(resolve, ms));

      // Collect events that occurred during the window
      let events = bridge.getEvents(startTime);

      if (filter) {
        try {
          const re = new RegExp(filter, 'i');
          events = events.filter(e => re.test(e.event));
        } catch {
          return error(`Invalid regex: ${filter}`);
        }
      }

      // Build event type breakdown
      const typeCounts = {};
      for (const e of events) {
        typeCounts[e.event] = (typeCounts[e.event] || 0) + 1;
      }
      const breakdown = Object.entries(typeCounts).map(([type, count]) => `${count} ${type}`).join(', ');
      const summary = `Collected ${events.length} events in ${ms}ms.${breakdown ? ' ' + breakdown + '.' : ' No events observed.'}`;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            summary,
            duration: ms,
            eventCount: events.length,
            typeCounts,
            events: events.slice(0, 200), // cap to prevent huge payloads
          }, null, 2),
        }],
      };
    }
  );
}

// Helper responses
function noConnection(tool) {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'No browser connected',
        hint: `No What Framework app is connected to the devtools bridge. Make sure your app is running with the what-devtools-mcp Vite plugin enabled, or manually call connectDevToolsMCP() in your app.`,
        tool,
        nextSteps: [
          'Make sure your app is running with the what-devtools-mcp Vite plugin',
          'Check that the MCP bridge server is running (npx what-devtools-mcp)',
          'Try refreshing the browser page',
        ],
      }, null, 2),
    }],
    isError: true,
  };
}

function noSnapshot() {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: 'No snapshot available',
        hint: 'The browser is connected but has not sent a state snapshot yet. Try refreshing the page.',
        nextSteps: [
          'Refresh the browser page to trigger a new snapshot',
          'Check the browser console for connection errors',
        ],
      }, null, 2),
    }],
    isError: true,
  };
}

function error(message) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }, null, 2) }],
    isError: true,
  };
}
