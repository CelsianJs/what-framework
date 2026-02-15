/**
 * What Framework - JS Framework Benchmark Implementation (Fine-Grained)
 * Uses template cloning, delegated events, and per-item reactive scopes.
 * Components run ONCE. Signals create individual DOM micro-effects.
 */

import { signal, batch, effect, flushSync, createRoot } from '../../packages/core/src/reactive.js';
import { template, insert, mapArray, delegateEvents } from '../../packages/core/src/render.js';

// --- Event delegation for click ---
delegateEvents(['click']);

// --- Templates (parsed once, cloned per row) ---
const rowTmpl = template(
  '<tr><td class="col-md-1"></td><td class="col-md-4"><a></a></td>' +
  '<td class="col-md-1"><a><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>' +
  '<td class="col-md-6"></td></tr>'
);

// --- Data generation (standard js-framework-benchmark) ---
const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const colours = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];

let nextId = 1;

function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: nextId++,
      label: `${adjectives[Math.round(Math.random() * 1000) % adjectives.length]} ${colours[Math.round(Math.random() * 1000) % colours.length]} ${nouns[Math.round(Math.random() * 1000) % nouns.length]}`
    };
  }
  return data;
}

// --- App state (module-level signals) ---
const data = signal([]);
const selected = signal(null);

// --- Actions ---
function run() { batch(() => { data.set(buildData(1000)); selected.set(null); }); }
function runLots() { batch(() => { data.set(buildData(10000)); selected.set(null); }); }
function add() { data.set(d => [...d, ...buildData(1000)]); }
function update() {
  const d = [...data()];
  for (let i = 0; i < d.length; i += 10) {
    d[i] = { ...d[i], label: d[i].label + ' !!!' };
  }
  data.set(d);
}
function clear() { batch(() => { data.set([]); selected.set(null); }); }
function swapRows() {
  const d = [...data()];
  if (d.length > 998) {
    [d[1], d[998]] = [d[998], d[1]];
    data.set(d);
  }
}
function remove(id) { data.set(d => d.filter(item => item.id !== id)); }
function selectRow(id) { selected.set(id); }

// --- Row renderer: template clone + 1 micro-effect for class ---
function renderRow(item) {
  const row = rowTmpl();
  row.children[0].textContent = item.id;
  row.children[1].firstChild.textContent = item.label;
  // Delegated click handlers
  row.children[1].firstChild.$$click = () => selectRow(item.id);
  row.children[2].firstChild.$$click = () => remove(item.id);
  // Single micro-effect: only fires when selected() changes
  effect(() => { row.className = selected() === item.id ? 'danger' : ''; });
  return row;
}

// --- App (runs ONCE, returns static DOM with reactive insertion points) ---
function App() {
  const container = document.createElement('div');
  container.className = 'container';

  // Header
  const jumbotron = document.createElement('div');
  jumbotron.className = 'jumbotron';
  const headerRow = document.createElement('div');
  headerRow.className = 'row';

  const titleCol = document.createElement('div');
  titleCol.className = 'col-md-6';
  const h1 = document.createElement('h1');
  h1.textContent = 'What Framework (keyed)';
  titleCol.appendChild(h1);

  const btnCol = document.createElement('div');
  btnCol.className = 'col-md-6';
  const btnRow = document.createElement('div');
  btnRow.className = 'row';

  btnRow.appendChild(createBtn('run', 'Create 1,000 rows', run));
  btnRow.appendChild(createBtn('runlots', 'Create 10,000 rows', runLots));
  btnRow.appendChild(createBtn('add', 'Append 1,000 rows', add));
  btnRow.appendChild(createBtn('update', 'Update every 10th row', update));
  btnRow.appendChild(createBtn('clear', 'Clear', clear));
  btnRow.appendChild(createBtn('swaprows', 'Swap Rows', swapRows));

  btnCol.appendChild(btnRow);
  headerRow.appendChild(titleCol);
  headerRow.appendChild(btnCol);
  jumbotron.appendChild(headerRow);
  container.appendChild(jumbotron);

  // Table with reactive list
  const table = document.createElement('table');
  table.className = 'table table-hover table-striped test-data';
  const tbody = document.createElement('tbody');
  tbody.id = 'tbody';

  // mapArray: per-item createRoot, keyed reconciliation by reference
  const listInsert = mapArray(data, renderRow);
  listInsert(tbody, null);

  table.appendChild(tbody);
  container.appendChild(table);

  // Preload icon
  const preload = document.createElement('span');
  preload.className = 'preloadicon glyphicon glyphicon-remove';
  preload.setAttribute('aria-hidden', 'true');
  container.appendChild(preload);

  return container;
}

function createBtn(id, text, handler) {
  const wrapper = document.createElement('div');
  wrapper.className = 'col-sm-6 smallpad';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-primary btn-block';
  button.id = id;
  button.textContent = text;
  button.$$click = handler;
  wrapper.appendChild(button);
  return wrapper;
}

// --- Mount ---
const main = document.getElementById('main');
main.textContent = '';
main.appendChild(App());

// --- Expose benchmark API ---
window._bench = {
  run, runLots, add, update, clear, swapRows, remove, selectRow,
  data, selected, flushSync, buildData,
};
