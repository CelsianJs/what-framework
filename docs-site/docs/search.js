// What docs — static client-side search.
// The build (build.mjs) extracts every docs page's text into /search-index.json;
// this script binds the nav "Search docs… /" button to a modal that queries it.
// Zero backend, zero dependencies. `/` or Cmd/Ctrl+K opens, Esc closes,
// arrows + Enter navigate.
(function () {
  if (window.__whatDocsSearch) return;
  window.__whatDocsSearch = true;

  var INDEX_URL = '/search-index.json';
  var index = null;
  var loading = null;

  function loadIndex() {
    if (!loading) {
      loading = fetch(INDEX_URL)
        .then(function (r) { return r.ok ? r.json() : []; })
        .catch(function () { return []; })
        .then(function (data) { index = data; return data; });
    }
    return loading;
  }

  // --- styles -------------------------------------------------------------
  var style = document.createElement('style');
  style.textContent = [
    '.ws-overlay{position:fixed;inset:0;z-index:1000;display:none;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}',
    '.ws-overlay.open{display:block}',
    '.ws-panel{max-width:640px;margin:10vh auto 0;background:var(--bg-raised,#222220);border:1px solid var(--border,#2e2e2a);border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.45);overflow:hidden}',
    '.ws-input-row{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--border,#2e2e2a)}',
    '.ws-input-row svg{width:18px;height:18px;flex-shrink:0;color:var(--text-muted,#6b6b63)}',
    '.ws-input{flex:1;background:none;border:none;outline:none;font:inherit;font-size:15px;color:var(--text,#f0efe8)}',
    '.ws-input::placeholder{color:var(--text-muted,#6b6b63)}',
    '.ws-esc{font-size:11px;font-weight:500;padding:2px 6px;border:1px solid var(--border,#2e2e2a);border-radius:4px;color:var(--text-muted,#6b6b63)}',
    '.ws-results{list-style:none;margin:0;padding:8px;max-height:55vh;overflow-y:auto}',
    '.ws-empty{padding:22px 16px;text-align:center;font-size:13.5px;color:var(--text-muted,#6b6b63)}',
    '.ws-item a{display:block;padding:10px 12px;border-radius:8px;text-decoration:none;color:var(--text,#f0efe8)}',
    '.ws-item.selected a,.ws-item a:hover{background:var(--accent-dim,rgba(62,207,142,.12))}',
    '.ws-item-top{display:flex;align-items:baseline;gap:8px}',
    '.ws-item-title{font-size:14px;font-weight:600}',
    '.ws-item-section{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--accent,#3ecf8e)}',
    '.ws-item-snippet{margin-top:3px;font-size:12.5px;line-height:1.5;color:var(--text-secondary,#9d9d93);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '.ws-item-snippet mark,.ws-item-title mark{background:none;color:var(--accent,#3ecf8e);font-weight:600}',
    '@media (max-width:700px){.ws-panel{margin:6vh 12px 0}}'
  ].join('\n');
  document.head.appendChild(style);

  // --- modal --------------------------------------------------------------
  var overlay, input, list;
  var selected = 0;
  var results = [];

  function ensureModal() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.className = 'ws-overlay';
    overlay.innerHTML =
      '<div class="ws-panel" role="dialog" aria-modal="true" aria-label="Search docs">' +
      '<div class="ws-input-row">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>' +
      '<input class="ws-input" type="text" placeholder="Search docs..." aria-label="Search docs" autocomplete="off" spellcheck="false">' +
      '<span class="ws-esc">esc</span>' +
      '</div>' +
      '<ul class="ws-results" role="listbox"></ul>' +
      '</div>';
    document.body.appendChild(overlay);
    input = overlay.querySelector('.ws-input');
    list = overlay.querySelector('.ws-results');

    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
    input.addEventListener('input', function () { run(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        var r = results[selected];
        if (r) location.href = r.route;
      } else if (e.key === 'Escape') { close(); }
    });
  }

  function open() {
    ensureModal();
    overlay.classList.add('open');
    input.value = '';
    renderEmpty('Type to search the docs…');
    // focus after the first paint too — a freshly-appended modal can reject
    // synchronous focus before its initial style/layout pass.
    input.focus();
    requestAnimationFrame(function () { if (isOpen()) input.focus(); });
    loadIndex().then(function () {
      if (input.value) run(input.value);
    });
  }

  function close() {
    if (overlay) overlay.classList.remove('open');
  }

  function isOpen() {
    return !!overlay && overlay.classList.contains('open');
  }

  // --- search -------------------------------------------------------------
  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function rxEsc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function score(page, terms) {
    var title = page.title.toLowerCase();
    var slug = page.route.toLowerCase().split('/').pop() || '';
    var headings = page.headings.join(' ').toLowerCase();
    var text = page.text.toLowerCase();
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var s = 0;
      if (title === t) s += 120;
      else if (title.indexOf(t) === 0) s += 80;
      else if (title.indexOf(t) !== -1) s += 50;
      // the URL slug often carries the canonical shorthand ("ssr",
      // "caching-isr") even when the prose spells it out
      if (slug === t) s += 100;
      else if (slug.indexOf(t) !== -1) s += 60;
      if (headings.indexOf(t) !== -1) s += 25;
      var n = text.split(t).length - 1;
      if (n > 0) s += Math.min(n, 10) * 2;
      if (s === 0) return 0; // every term must match somewhere
      total += s;
    }
    return total;
  }

  function snippet(page, terms) {
    var text = page.text;
    var lower = text.toLowerCase();
    var pos = -1;
    for (var i = 0; i < terms.length && pos === -1; i++) pos = lower.indexOf(terms[i]);
    if (pos === -1) pos = 0;
    var start = Math.max(0, pos - 50);
    var raw = (start > 0 ? '…' : '') + text.slice(start, start + 170) + '…';
    return highlight(raw, terms);
  }

  function highlight(plain, terms) {
    var safe = esc(plain);
    try {
      var rx = new RegExp('(' + terms.map(rxEsc).join('|') + ')', 'gi');
      safe = safe.replace(rx, '<mark>$1</mark>');
    } catch (e) { /* keep unhighlighted */ }
    return safe;
  }

  function run(query) {
    var q = query.trim().toLowerCase();
    if (!q) { renderEmpty('Type to search the docs…'); return; }
    if (!index) { renderEmpty('Loading index…'); loadIndex().then(function () { run(input.value); }); return; }
    var terms = q.split(/\s+/).filter(Boolean);
    results = index
      .map(function (p) { return { page: p, s: score(p, terms) }; })
      .filter(function (r) { return r.s > 0; })
      .sort(function (a, b) { return b.s - a.s; })
      .slice(0, 10)
      .map(function (r) { return { route: r.page.route, page: r.page }; });
    selected = 0;
    if (!results.length) { renderEmpty('No results for “' + esc(query.trim()) + '”'); return; }
    list.innerHTML = results.map(function (r, i) {
      return '<li class="ws-item' + (i === selected ? ' selected' : '') + '" role="option">' +
        '<a href="' + r.route + '">' +
        '<div class="ws-item-top"><span class="ws-item-title">' + highlight(r.page.title, terms) + '</span>' +
        '<span class="ws-item-section">' + esc(r.page.section) + '</span></div>' +
        '<div class="ws-item-snippet">' + snippet(r.page, terms) + '</div>' +
        '</a></li>';
    }).join('');
  }

  function renderEmpty(msg) {
    results = [];
    selected = 0;
    list.innerHTML = '<li class="ws-empty">' + msg + '</li>';
  }

  function move(delta) {
    if (!results.length) return;
    selected = (selected + delta + results.length) % results.length;
    var items = list.querySelectorAll('.ws-item');
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('selected', i === selected);
    if (items[selected]) items[selected].scrollIntoView({ block: 'nearest' });
  }

  // --- global bindings ------------------------------------------------------
  function isTyping(el) {
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target) && !isOpen()) {
      e.preventDefault();
      open();
    } else if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !isOpen()) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && isOpen()) {
      close();
    }
  });

  function bind() {
    var buttons = document.querySelectorAll('.search-placeholder');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', open);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
