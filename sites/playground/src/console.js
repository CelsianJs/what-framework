// What Framework Playground — Console Output Panel

/**
 * Create and manage the console output panel.
 *
 * @param {HTMLElement} container - The console panel container
 * @returns {{ addMessage: function, addError: function, clear: function, getCount: function }}
 */
export function createConsolePanel(container) {
  let messages = [];
  let messagesEl = null;
  let countBadge = null;

  // Build the console DOM
  const header = document.createElement('div');
  header.className = 'console-header';
  header.innerHTML = `
    <div class="console-header-left">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <polyline points="4 6 8 10 12 6"/>
      </svg>
      <span>Console</span>
      <span class="console-badge" id="console-count">0</span>
    </div>
    <button class="console-clear" title="Clear console">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="8" cy="8" r="6"/>
        <line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/>
        <line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>
      </svg>
    </button>
  `;

  messagesEl = document.createElement('div');
  messagesEl.className = 'console-messages';

  container.appendChild(header);
  container.appendChild(messagesEl);

  countBadge = header.querySelector('#console-count');
  const clearBtn = header.querySelector('.console-clear');
  const chevron = header.querySelector('svg');

  // Toggle collapse
  let collapsed = false;
  header.querySelector('.console-header-left').addEventListener('click', () => {
    collapsed = !collapsed;
    messagesEl.style.display = collapsed ? 'none' : 'block';
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : '';
    container.classList.toggle('collapsed', collapsed);
  });

  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clear();
  });

  function updateBadge() {
    countBadge.textContent = messages.length;
    countBadge.style.display = messages.length > 0 ? '' : 'none';
  }

  function addMessage({ type, args, timestamp }) {
    const msg = document.createElement('div');
    msg.className = `console-msg console-${type}`;

    const time = new Date(timestamp);
    const timeStr = time.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const typeIcons = {
      log: '',
      warn: '\u26a0',
      error: '\u2717',
      info: '\u2139',
    };

    msg.innerHTML = `<span class="console-time">${timeStr}</span>` +
      `<span class="console-icon">${typeIcons[type] || ''}</span>` +
      `<span class="console-text">${escapeHTML(args.join(' '))}</span>`;

    messages.push({ type, args, timestamp });
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    updateBadge();
  }

  function addError({ message, line, col }) {
    addMessage({
      type: 'error',
      args: [message + (line ? ` (line ${line}${col ? ':' + col : ''})` : '')],
      timestamp: Date.now(),
    });
  }

  function clear() {
    messages = [];
    messagesEl.innerHTML = '';
    updateBadge();
  }

  function getCount() {
    return messages.length;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  updateBadge();

  return { addMessage, addError, clear, getCount };
}
