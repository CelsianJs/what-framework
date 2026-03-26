/**
 * What Framework DevPanel
 *
 * A drop-in floating UI panel that shows live signal values,
 * active effects, and mounted components during development.
 *
 * Features:
 * - Signal count, effect count, component count
 * - Recent errors with structured output
 * - Real-time signal watcher
 * - Health indicator (green/yellow/red)
 * - Toggle via Ctrl+Shift+D / Cmd+Shift+D
 *
 * Usage:
 *   import { DevPanel } from 'what-devtools/panel';
 *   // Add to your app:
 *   <DevPanel />
 *
 * Works WITHOUT MCP devtools connected.
 */

import { signal, effect, onCleanup } from 'what-core';
import { subscribe, getSnapshot, getErrors, installDevTools } from './index.js';

export function DevPanel() {
  // Auto-install devtools if not already done
  installDevTools();

  const isOpen = signal(false);
  const activeTab = signal('overview');
  const snapshot = signal(getSnapshot());
  const recentErrors = signal(getErrors());

  // Subscribe to devtools events and refresh
  const unsub = subscribe((event) => {
    snapshot(getSnapshot());
    if (event === 'error:captured') {
      recentErrors(getErrors());
    }
  });

  // Poll every 500ms for signal value changes (cheap -- just reads .peek())
  const interval = setInterval(() => {
    snapshot(getSnapshot());
    recentErrors(getErrors());
  }, 500);

  // Keyboard shortcut: Ctrl+Shift+D / Cmd+Shift+D
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      isOpen((v) => !v);
    }
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
  }

  onCleanup(() => {
    unsub();
    clearInterval(interval);
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', onKeyDown);
    }
  });

  // --- Health indicator ---
  const getHealth = () => {
    const data = snapshot();
    const errs = recentErrors();
    const recentErrCount = errs.filter(
      (e) => Date.now() - e.timestamp < 30000
    ).length;

    if (recentErrCount > 0) return { color: '#ef4444', label: 'Errors detected' };
    if (data.effects.length > 100) return { color: '#eab308', label: 'Many effects' };
    if (data.signals.length > 200) return { color: '#eab308', label: 'Many signals' };
    return { color: '#22c55e', label: 'Healthy' };
  };

  const PANEL_STYLE =
    'position:fixed;bottom:0;right:0;width:380px;max-height:55vh;z-index:99998;' +
    'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;' +
    'background:#1a1a2e;color:#e0e0e0;border:1px solid #2a2a4a;' +
    'border-radius:12px 0 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.3);' +
    'display:flex;flex-direction:column;overflow:hidden;';

  const tabStyle = (tab) => () => {
    const isActive = activeTab() === tab;
    return (
      'padding:6px 10px;border:none;background:' +
      (isActive ? '#2a2a4a' : 'transparent') +
      ';color:' +
      (isActive ? '#fff' : '#6a6a8a') +
      ';cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;border-radius:4px;'
    );
  };

  // --- Tab: Overview ---
  const renderOverview = () => {
    const data = snapshot();
    const health = getHealth();
    const errs = recentErrors();
    const recentErrs = errs.slice(-3).reverse();

    return (
      <div style="padding:12px;">
        {/* Health indicator */}
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:#0d0d1a;border-radius:6px;">
          <div
            style={() =>
              'width:10px;height:10px;border-radius:50%;background:' +
              getHealth().color +
              ';'
            }
          />
          <span style={() => 'color:' + getHealth().color + ';font-weight:600;'}>
            {() => getHealth().label}
          </span>
        </div>

        {/* Counts */}
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="text-align:center;padding:8px;background:#0d0d1a;border-radius:6px;">
            <div style="font-size:18px;font-weight:700;color:#818cf8;">
              {() => snapshot().signals.length}
            </div>
            <div style="font-size:10px;color:#6a6a8a;margin-top:2px;">
              Signals
            </div>
          </div>
          <div style="text-align:center;padding:8px;background:#0d0d1a;border-radius:6px;">
            <div style="font-size:18px;font-weight:700;color:#fbbf24;">
              {() => snapshot().effects.length}
            </div>
            <div style="font-size:10px;color:#6a6a8a;margin-top:2px;">
              Effects
            </div>
          </div>
          <div style="text-align:center;padding:8px;background:#0d0d1a;border-radius:6px;">
            <div style="font-size:18px;font-weight:700;color:#34d399;">
              {() => snapshot().components.length}
            </div>
            <div style="font-size:10px;color:#6a6a8a;margin-top:2px;">
              Components
            </div>
          </div>
        </div>

        {/* Recent errors */}
        {() => {
          const errs = recentErrors();
          if (errs.length === 0) return null;
          const recent = errs.slice(-3).reverse();
          return (
            <div style="margin-top:8px;">
              <div style="font-size:11px;font-weight:600;color:#f87171;margin-bottom:6px;">
                Recent Errors ({errs.length})
              </div>
              {recent.map((e, i) => (
                <div
                  key={i}
                  style="padding:6px 8px;background:#1c0a0a;border:1px solid #3b1219;border-radius:4px;margin-bottom:4px;font-size:11px;color:#fca5a5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
                  title={e.message}
                >
                  <span style="color:#6a6a8a;">
                    [{e.type}]
                  </span>{' '}
                  {e.message}
                </div>
              ))}
            </div>
          );
        }}
      </div>
    );
  };

  // --- Tab: Signals ---
  const renderSignals = () => {
    const data = snapshot();
    if (!data.signals.length) {
      return (
        <div style="padding:12px;color:#4a4a6a;">No signals tracked</div>
      );
    }
    return (
      <div style="padding:8px;">
        {data.signals.map((s) => (
          <div
            key={s.id}
            style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid #2a2a4a;"
          >
            <span style="color:#818cf8;">{s.name}</span>
            <span style="color:#a0a0c0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              {formatValue(s.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // --- Tab: Effects ---
  const renderEffects = () => {
    const data = snapshot();
    if (!data.effects.length) {
      return (
        <div style="padding:12px;color:#4a4a6a;">No effects tracked</div>
      );
    }
    return (
      <div style="padding:8px;">
        {data.effects.map((e) => (
          <div
            key={e.id}
            style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid #2a2a4a;"
          >
            <span style="color:#fbbf24;">{e.name}</span>
            <span style="color:#6a6a8a;font-size:10px;">
              runs: {e.runCount || 0}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // --- Tab: Components ---
  const renderComponents = () => {
    const data = snapshot();
    if (!data.components.length) {
      return (
        <div style="padding:12px;color:#4a4a6a;">No components tracked</div>
      );
    }
    return (
      <div style="padding:8px;">
        {data.components.map((c) => (
          <div
            key={c.id}
            style="padding:4px 8px;border-bottom:1px solid #2a2a4a;"
          >
            <span style="color:#34d399;">
              &lt;{c.name} /&gt;
            </span>
          </div>
        ))}
      </div>
    );
  };

  // --- Tab: Errors ---
  const renderErrors = () => {
    const errs = recentErrors();
    if (!errs.length) {
      return (
        <div style="padding:12px;color:#4a4a6a;">No errors captured</div>
      );
    }
    return (
      <div style="padding:8px;">
        {errs
          .slice()
          .reverse()
          .map((e, i) => (
            <div
              key={i}
              style="padding:8px;background:#0d0d1a;border:1px solid #2a2a4a;border-radius:6px;margin-bottom:6px;"
            >
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="color:#f87171;font-weight:600;font-size:11px;">
                  [{e.type}]
                </span>
                <span style="color:#4a4a6a;font-size:10px;">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <div style="color:#e0e0e0;font-size:11px;white-space:pre-wrap;word-break:break-all;">
                {e.message}
              </div>
              {e.stack ? (
                <div style="color:#4a4a6a;font-size:10px;margin-top:4px;white-space:pre-wrap;max-height:60px;overflow:hidden;">
                  {e.stack.split('\n').slice(0, 3).join('\n')}
                </div>
              ) : null}
            </div>
          ))}
      </div>
    );
  };

  return (
    <>
      {/* Toggle button with health indicator */}
      <button
        onclick={() => isOpen((v) => !v)}
        style={() => {
          const health = getHealth();
          return (
            'position:fixed;bottom:12px;right:12px;z-index:99999;width:36px;height:36px;' +
            'border-radius:8px;border:1px solid #2a2a4a;' +
            'background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;' +
            'font-weight:800;font-size:14px;cursor:pointer;' +
            'font-family:ui-monospace,monospace;' +
            'box-shadow:0 4px 12px rgba(37,99,235,0.3),' +
            '0 0 0 2px ' + health.color + ';'
          );
        }}
        title="What Framework DevTools (Ctrl+Shift+D)"
      >
        W
      </button>

      {/* Panel -- conditionally rendered */}
      {() =>
        isOpen() ? (
          <div style={PANEL_STYLE}>
            {/* Header */}
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #2a2a4a;background:#16163a;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-weight:700;font-size:12px;color:#818cf8;">
                  What DevTools
                </span>
                <div
                  style={() =>
                    'width:8px;height:8px;border-radius:50%;background:' +
                    getHealth().color +
                    ';'
                  }
                  title={() => getHealth().label}
                />
              </div>
              <button
                onclick={() => isOpen(false)}
                style="background:none;border:none;color:#6a6a8a;cursor:pointer;font-size:14px;"
              >
                x
              </button>
            </div>

            {/* Tabs */}
            <div style="display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid #2a2a4a;flex-wrap:wrap;">
              <button
                style={tabStyle('overview')}
                onclick={() => activeTab('overview')}
              >
                Overview
              </button>
              <button
                style={tabStyle('signals')}
                onclick={() => activeTab('signals')}
              >
                Signals ({() => snapshot().signals.length})
              </button>
              <button
                style={tabStyle('effects')}
                onclick={() => activeTab('effects')}
              >
                Effects ({() => snapshot().effects.length})
              </button>
              <button
                style={tabStyle('components')}
                onclick={() => activeTab('components')}
              >
                Components ({() => snapshot().components.length})
              </button>
              <button
                style={tabStyle('errors')}
                onclick={() => activeTab('errors')}
              >
                Errors ({() => recentErrors().length})
              </button>
            </div>

            {/* Content */}
            <div style="overflow-y:auto;flex:1;">
              {() => {
                const tab = activeTab();
                if (tab === 'overview') return renderOverview();
                if (tab === 'signals') return renderSignals();
                if (tab === 'effects') return renderEffects();
                if (tab === 'components') return renderComponents();
                if (tab === 'errors') return renderErrors();
                return renderOverview();
              }}
            </div>
          </div>
        ) : null
      }
    </>
  );
}

function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string')
    return `"${value.length > 30 ? value.slice(0, 30) + '...' : value}"`;
  if (typeof value === 'object') {
    try {
      const str = JSON.stringify(value);
      return str.length > 40 ? str.slice(0, 40) + '...' : str;
    } catch {
      return '[Object]';
    }
  }
  return String(value);
}

export default DevPanel;
