const controls = document.querySelector('[data-gallery-controls]');
if (controls) {
  const search = controls.querySelector('[name="q"]');
  const runtime = controls.querySelector('[name="runtime"]');
  const cards = [...document.querySelectorAll('[data-template]')];
  const count = document.querySelector('[data-result-count]');
  const empty = document.querySelector('[data-no-matches]');
  const params = new URLSearchParams(window.location.search);
  search.value = params.get('q') || '';
  const selected = params.get('runtime');
  if ([...runtime.options].some(option => option.value === selected)) runtime.value = selected;

  function filter(updateUrl = true) {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const card of cards) {
      const match = terms.every(term => card.dataset.search.includes(term))
        && (runtime.value === 'all' || card.dataset.runtimes.split(' ').includes(runtime.value));
      card.hidden = !match;
      if (match) matches++;
    }
    count.textContent = `${matches} ${matches === 1 ? 'starter' : 'starters'}`;
    empty.hidden = matches > 0;
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (search.value.trim()) url.searchParams.set('q', search.value.trim());
      else url.searchParams.delete('q');
      if (runtime.value !== 'all') url.searchParams.set('runtime', runtime.value);
      else url.searchParams.delete('runtime');
      window.history.replaceState(null, '', url);
    }
  }

  controls.hidden = false;
  controls.addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', () => filter());
  runtime.addEventListener('change', () => filter());
  document.querySelector('[data-reset]').addEventListener('click', () => {
    search.value = '';
    runtime.value = 'all';
    filter();
    search.focus();
  });
  filter(false);
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Select to copy';
      button.title = 'Clipboard unavailable. Select the command text and copy it manually.';
    }
  });
}

const statusControls = document.querySelector('[data-status-controls]');
let filterStatus;
if (statusControls) {
  const search = statusControls.querySelector('[name="q"]');
  const phase = statusControls.querySelector('[name="phase"]');
  const cards = [...document.querySelectorAll('[data-status-entry]')];
  const count = document.querySelector('[data-status-count]');
  const empty = document.querySelector('[data-status-empty]');
  const params = new URLSearchParams(window.location.search);
  search.value = params.get('q') || '';
  const selected = params.get('phase');
  if ([...phase.options].some(option => option.value === selected)) phase.value = selected;

  function filter(updateUrl = true) {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let matches = 0;
    for (const card of cards) {
      const match = terms.every(term => card.dataset.search.includes(term)) && (phase.value === 'all' || card.dataset.phase === phase.value);
      card.hidden = !match;
      if (match) matches++;
    }
    count.textContent = `${matches} ${matches === 1 ? 'starter' : 'starters'} tracked`;
    empty.hidden = matches > 0;
    if (updateUrl) {
      const url = new URL(window.location.href);
      if (search.value.trim()) url.searchParams.set('q', search.value.trim());
      else url.searchParams.delete('q');
      if (phase.value !== 'all') url.searchParams.set('phase', phase.value);
      else url.searchParams.delete('phase');
      window.history.replaceState(null, '', url);
    }
  }

  statusControls.hidden = false;
  statusControls.addEventListener('submit', event => event.preventDefault());
  search.addEventListener('input', () => filter());
  phase.addEventListener('change', () => filter());
  document.querySelector('[data-status-reset]').addEventListener('click', () => {
    search.value = '';
    phase.value = 'all';
    filter();
    search.focus();
  });
  filter(false);
  filterStatus = () => filter(false);
}

const statusWatch = document.querySelector('[data-status-watch]');
if (statusWatch) {
  const message = statusWatch.querySelector('[data-status-watch-message]');
  const checked = statusWatch.querySelector('[data-status-last-checked]');
  const refresh = statusWatch.querySelector('[data-status-refresh]');
  const phaseLabels = new Map([...document.querySelector('#status-phase').options].filter(option => option.value !== 'all').map(option => [option.value, option.textContent]));
  const cards = new Map([...document.querySelectorAll('[data-status-entry]')].map(card => [card.querySelector('h2 a').getAttribute('href').split('/').at(-1), card]));
  let snapshot = JSON.parse(document.querySelector('#starter-status-snapshot').textContent);
  const signature = value => JSON.stringify(value.entries.map(({ updatedAt: _updatedAt, ...entry }) => entry));
  let previous = signature(snapshot);
  let checking = false;
  statusWatch.hidden = false;

  async function checkStatus() {
    if (checking) return;
    if (!navigator.onLine) {
      message.textContent = 'Offline — automatic checks are paused. The last published snapshot remains visible.';
      refresh.textContent = 'Retry';
      return;
    }
    checking = true;
    refresh.disabled = true;
    message.textContent = 'Checking the published status snapshot…';
    try {
      const response = await fetch('/templates/status.json', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Status unavailable');
      const next = await response.json();
      if (next.version !== 1 || !Array.isArray(next.entries) || next.entries.length !== cards.size || !Number.isFinite(Date.parse(next.updatedAt))) throw new Error('Invalid status snapshot');
      const slugs = new Set();
      for (const entry of next.entries) {
        if (!cards.has(entry.slug) || slugs.has(entry.slug) || !phaseLabels.has(entry.phase) || typeof entry.name !== 'string' || typeof entry.summary !== 'string' || typeof entry.description !== 'string' || !Array.isArray(entry.intendedFeatures) || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error('Invalid status entry');
        slugs.add(entry.slug);
      }
      const changed = signature(next) !== previous;
      if (changed) {
        for (const entry of next.entries) {
          const card = cards.get(entry.slug);
          card.dataset.phase = entry.phase;
          card.dataset.search = [entry.name, entry.description, entry.category, ...entry.intendedFeatures, entry.intendedArchitecture].join(' ').toLowerCase();
          card.querySelector('h2 a').textContent = entry.name;
          card.querySelector('h2 + p').textContent = entry.description;
          card.querySelector('.template-status-summary').textContent = entry.summary;
          const badge = card.querySelector('.template-phase');
          badge.className = `template-phase template-phase-${entry.phase}`;
          badge.textContent = phaseLabels.get(entry.phase);
          const time = card.querySelector('time');
          time.dateTime = entry.updatedAt;
          time.textContent = new Date(entry.updatedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
        }
        for (const count of document.querySelectorAll('[data-phase-count]')) count.textContent = next.entries.filter(entry => entry.phase === count.dataset.phaseCount).length;
        filterStatus?.();
        previous = signature(next);
        snapshot = next;
        const publishedAt = document.querySelector('.templates-intro time');
        publishedAt.dateTime = snapshot.updatedAt;
        publishedAt.textContent = new Date(snapshot.updatedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
      }
      checked.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      message.textContent = changed ? 'Published build-status changes loaded. Open a starter’s journal for the details.' : 'Checked the server — no build-status changes since this snapshot.';
      refresh.textContent = 'Refresh status';
    } catch {
      message.textContent = 'Could not check for updates. The last published snapshot remains visible; retry now or wait for the next check.';
      refresh.textContent = 'Retry';
    } finally {
      checking = false;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener('click', checkStatus);
  window.addEventListener('online', checkStatus);
  window.addEventListener('offline', () => { message.textContent = 'Offline — automatic checks are paused. The last published snapshot remains visible.'; refresh.textContent = 'Retry'; });
  setInterval(checkStatus, 60_000);
  checkStatus();
}
