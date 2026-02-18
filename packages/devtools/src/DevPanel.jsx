/**
 * What Framework DevPanel
 *
 * A drop-in floating UI panel that shows live signal values,
 * active effects, and mounted components during development.
 *
 * Usage:
 *   import { DevPanel } from 'what-devtools/panel';
 *   // Add to your app:
 *   <DevPanel />
 *
 * The panel is draggable and can be collapsed. It auto-updates
 * when signals change.
 */

import { signal, effect, onCleanup } from 'what-core';
import { subscribe, getSnapshot, installDevTools } from './index.js';

export function DevPanel() {
  // Auto-install devtools if not already done
  installDevTools();

  const isOpen = signal(false);
  const activeTab = signal('signals');
  const snapshot = signal(getSnapshot());

  // Subscribe to devtools events and refresh
  const unsub = subscribe(() => {
    snapshot(getSnapshot());
  });

  // Also poll every 500ms for signal value changes (cheap — just reads .peek())
  const interval = setInterval(() => {
    snapshot(getSnapshot());
  }, 500);

  onCleanup(() => {
    unsub();
    clearInterval(interval);
  });

  const panelStyle = () => isOpen()
    ? 'position:fixed;bottom:0;right:0;width:360px;max-height:50vh;z-index:99998;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;background:#1a1a2e;color:#e0e0e0;border:1px solid #2a2a4a;border-radius:12px 0 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;overflow:hidden;'
    : 'display:none;';

  const tabStyle = (tab) => () => {
    const isActive = activeTab() === tab;
    return `padding:6px 12px;border:none;background:${isActive ? '#2a2a4a' : 'transparent'};color:${isActive ? '#fff' : '#6a6a8a'};cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;border-radius:4px;`;
  };

  const renderSignals = () => {
    const data = snapshot();
    if (!data.signals.length) {
      return <div style="padding:12px;color:#4a4a6a;">No signals tracked</div>;
    }
    return (
      <div style="padding:8px;">
        {data.signals.map(s => (
          <div key={s.id} style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid #2a2a4a;">
            <span style="color:#818cf8;">{s.name}</span>
            <span style="color:#a0a0c0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              {formatValue(s.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderEffects = () => {
    const data = snapshot();
    if (!data.effects.length) {
      return <div style="padding:12px;color:#4a4a6a;">No effects tracked</div>;
    }
    return (
      <div style="padding:8px;">
        {data.effects.map(e => (
          <div key={e.id} style="padding:4px 8px;border-bottom:1px solid #2a2a4a;">
            <span style="color:#fbbf24;">{e.name}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderComponents = () => {
    const data = snapshot();
    if (!data.components.length) {
      return <div style="padding:12px;color:#4a4a6a;">No components tracked</div>;
    }
    return (
      <div style="padding:8px;">
        {data.components.map(c => (
          <div key={c.id} style="padding:4px 8px;border-bottom:1px solid #2a2a4a;">
            <span style="color:#34d399;">&lt;{c.name} /&gt;</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onclick={() => isOpen(v => !v)}
        style="position:fixed;bottom:12px;right:12px;z-index:99999;width:36px;height:36px;border-radius:8px;border:1px solid #2a2a4a;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:ui-monospace,monospace;box-shadow:0 4px 12px rgba(37,99,235,0.3);"
        title="What Framework DevTools"
      >
        W
      </button>

      {/* Panel */}
      <div style={panelStyle}>
        {/* Header */}
        <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #2a2a4a;background:#16163a;">
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-weight:700;font-size:12px;color:#818cf8;">What DevTools</span>
          </div>
          <button
            onclick={() => isOpen(false)}
            style="background:none;border:none;color:#6a6a8a;cursor:pointer;font-size:14px;"
          >
            x
          </button>
        </div>

        {/* Tabs */}
        <div style="display:flex;gap:4px;padding:6px 8px;border-bottom:1px solid #2a2a4a;">
          <button style={tabStyle('signals')} onclick={() => activeTab('signals')}>
            Signals ({() => snapshot().signals.length})
          </button>
          <button style={tabStyle('effects')} onclick={() => activeTab('effects')}>
            Effects ({() => snapshot().effects.length})
          </button>
          <button style={tabStyle('components')} onclick={() => activeTab('components')}>
            Components ({() => snapshot().components.length})
          </button>
        </div>

        {/* Content */}
        <div style="overflow-y:auto;flex:1;">
          {() => {
            const tab = activeTab();
            if (tab === 'signals') return renderSignals();
            if (tab === 'effects') return renderEffects();
            return renderComponents();
          }}
        </div>
      </div>
    </>
  );
}

function formatValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${value.length > 30 ? value.slice(0, 30) + '...' : value}"`;
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
