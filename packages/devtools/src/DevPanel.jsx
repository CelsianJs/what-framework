/**
 * What Framework DevPanel
 *
 * A small floating UI panel for browser-based devtools tests and local debugging.
 * It is intentionally implemented without JSX so the devtools package does not
 * depend on compiler fragment behavior to render its own diagnostics UI.
 */

import { onCleanup } from 'what-core';
import { subscribe, getSnapshot, getErrors, installDevTools } from './index.js';

const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

export function DevPanel() {
  installDevTools();

  if (typeof document === 'undefined') return null;

  let activeTab = 'signals';
  let isOpen = false;

  const root = document.createDocumentFragment();
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'W';
  toggle.title = 'What Framework DevTools (Ctrl+Shift+D)';
  toggle.setAttribute('style',
    'position:fixed;bottom:12px;right:12px;z-index:99999;width:36px;height:36px;' +
    'border-radius:8px;border:1px solid #2a2a4a;background:linear-gradient(135deg,#2563eb,#1d4ed8);' +
    `color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:${MONO};` +
    'box-shadow:0 4px 12px rgba(37,99,235,0.3);'
  );

  const panel = document.createElement('div');
  panel.setAttribute('style',
    'position:fixed;bottom:0;right:0;width:380px;max-height:55vh;z-index:99998;' +
    `font-family:${MONO};font-size:12px;background:#1a1a2e;color:#e0e0e0;` +
    'border:1px solid #2a2a4a;border-radius:12px 0 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.3);' +
    'display:none;flex-direction:column;overflow:hidden;'
  );

  root.append(toggle, panel);

  function setOpen(next) {
    isOpen = next;
    panel.style.display = isOpen ? 'flex' : 'none';
    if (isOpen) renderPanel();
  }

  toggle.addEventListener('click', () => setOpen(!isOpen));

  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      setOpen(!isOpen);
    }
  };
  document.addEventListener('keydown', onKeyDown);

  const unsub = subscribe(() => {
    if (isOpen) renderPanel();
  });
  const interval = setInterval(() => {
    if (isOpen) renderPanel();
  }, 500);

  onCleanup(() => {
    unsub();
    clearInterval(interval);
    document.removeEventListener('keydown', onKeyDown);
  });

  function renderPanel() {
    panel.replaceChildren(renderHeader(), renderTabs(), renderContent());
  }

  function renderHeader() {
    const header = document.createElement('div');
    header.setAttribute('style', 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #2a2a4a;background:#16163a;');

    const title = document.createElement('span');
    title.textContent = 'What DevTools';
    title.setAttribute('style', 'font-weight:700;font-size:12px;color:#818cf8;');

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'x';
    close.setAttribute('style', 'background:none;border:none;color:#6a6a8a;cursor:pointer;font-size:14px;');
    close.addEventListener('click', () => setOpen(false));

    header.append(title, close);
    return header;
  }

  function renderTabs() {
    const tabs = document.createElement('div');
    tabs.setAttribute('style', 'display:flex;gap:2px;padding:6px 8px;border-bottom:1px solid #2a2a4a;flex-wrap:wrap;');
    for (const tab of ['signals', 'effects', 'components', 'errors']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tabLabel(tab);
      button.setAttribute('style', tabStyle(tab));
      button.addEventListener('click', () => {
        activeTab = tab;
        renderPanel();
      });
      tabs.append(button);
    }
    return tabs;
  }

  function tabLabel(tab) {
    const snapshot = getSnapshot();
    if (tab === 'signals') return `Signals (${snapshot.signals.length})`;
    if (tab === 'effects') return `Effects (${snapshot.effects.length})`;
    if (tab === 'components') return `Components (${snapshot.components.length})`;
    return `Errors (${getErrors().length})`;
  }

  function tabStyle(tab) {
    const selected = activeTab === tab;
    return 'padding:6px 10px;border:none;background:' + (selected ? '#2a2a4a' : 'transparent') +
      ';color:' + (selected ? '#fff' : '#6a6a8a') +
      `;cursor:pointer;font-family:${MONO};font-size:11px;font-weight:600;border-radius:4px;`;
  }

  function renderContent() {
    const content = document.createElement('div');
    content.setAttribute('style', 'overflow-y:auto;flex:1;padding:8px;');
    const snapshot = getSnapshot();

    if (activeTab === 'signals') {
      renderRows(content, snapshot.signals, (signal) => [signal.name, formatValue(signal.value)], '#818cf8');
    } else if (activeTab === 'effects') {
      renderRows(content, snapshot.effects, (effect) => [effect.name, `runs: ${effect.runCount || 0}`], '#fbbf24');
    } else if (activeTab === 'components') {
      renderRows(content, snapshot.components, (component) => [`<${component.name} />`, ''], '#34d399');
    } else {
      renderRows(content, getErrors(), (error) => [`[${error.type}]`, error.message], '#f87171');
    }

    if (!content.childNodes.length) {
      content.textContent = `No ${activeTab} tracked`;
      content.style.color = '#4a4a6a';
      content.style.padding = '12px';
    }
    return content;
  }

  function renderRows(parent, rows, mapRow, color) {
    for (const row of rows) {
      const [leftText, rightText] = mapRow(row);
      const item = document.createElement('div');
      item.setAttribute('style', 'display:flex;justify-content:space-between;align-items:center;padding:4px 8px;border-bottom:1px solid #2a2a4a;gap:12px;');
      const left = document.createElement('span');
      left.textContent = leftText;
      left.setAttribute('style', `color:${color};`);
      const right = document.createElement('span');
      right.textContent = rightText;
      right.setAttribute('style', 'color:#a0a0c0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;');
      item.append(left, right);
      parent.append(item);
    }
  }

  return root;
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
