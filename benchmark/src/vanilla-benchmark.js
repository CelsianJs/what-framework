/**
 * Vanilla JS reference implementation of js-framework-benchmark
 * Used to calibrate What Framework benchmark results on the same hardware.
 */

const adjectives = ["pretty", "large", "big", "small", "tall", "short", "long", "handsome", "plain", "quaint", "clean", "elegant", "easy", "angry", "crazy", "helpful", "mushy", "odd", "unsightly", "adorable", "important", "inexpensive", "cheap", "expensive", "fancy"];
const colours = ["red", "yellow", "blue", "green", "pink", "brown", "purple", "brown", "white", "black", "orange"];
const nouns = ["table", "chair", "house", "bbq", "desk", "car", "pony", "cookie", "sandwich", "burger", "pizza", "mouse", "keyboard"];

let nextId = 1;
let data = [];
let selectedId = null;

function buildData(count) {
  const result = new Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = {
      id: nextId++,
      label: `${adjectives[Math.round(Math.random() * 1000) % adjectives.length]} ${colours[Math.round(Math.random() * 1000) % colours.length]} ${nouns[Math.round(Math.random() * 1000) % nouns.length]}`
    };
  }
  return result;
}

const tbody = document.getElementById('tbody');

function createRow(item) {
  const tr = document.createElement('tr');
  tr.dataset.id = item.id;
  if (item.id === selectedId) tr.className = 'danger';

  const td1 = document.createElement('td');
  td1.className = 'col-md-1';
  td1.textContent = String(item.id);

  const td2 = document.createElement('td');
  td2.className = 'col-md-4';
  const a1 = document.createElement('a');
  a1.textContent = item.label;
  td2.appendChild(a1);

  const td3 = document.createElement('td');
  td3.className = 'col-md-1';
  const a2 = document.createElement('a');
  const span = document.createElement('span');
  span.className = 'glyphicon glyphicon-remove';
  span.setAttribute('aria-hidden', 'true');
  a2.appendChild(span);
  td3.appendChild(a2);

  const td4 = document.createElement('td');
  td4.className = 'col-md-6';

  tr.appendChild(td1);
  tr.appendChild(td2);
  tr.appendChild(td3);
  tr.appendChild(td4);
  return tr;
}

function run() {
  data = buildData(1000);
  selectedId = null;
  tbody.textContent = '';
  const frag = document.createDocumentFragment();
  for (const item of data) frag.appendChild(createRow(item));
  tbody.appendChild(frag);
}

function runLots() {
  data = buildData(10000);
  selectedId = null;
  tbody.textContent = '';
  const frag = document.createDocumentFragment();
  for (const item of data) frag.appendChild(createRow(item));
  tbody.appendChild(frag);
}

function add() {
  const newData = buildData(1000);
  data = data.concat(newData);
  const frag = document.createDocumentFragment();
  for (const item of newData) frag.appendChild(createRow(item));
  tbody.appendChild(frag);
}

function update() {
  for (let i = 0; i < data.length; i += 10) {
    data[i] = { ...data[i], label: data[i].label + ' !!!' };
    const tr = tbody.children[i];
    if (tr) tr.children[1].firstChild.textContent = data[i].label;
  }
}

function clear() {
  data = [];
  selectedId = null;
  tbody.textContent = '';
}

function swapRows() {
  if (data.length > 998) {
    const tmp = data[1];
    data[1] = data[998];
    data[998] = tmp;
    const tr1 = tbody.children[1];
    const tr998 = tbody.children[998];
    tbody.insertBefore(tr998, tr1);
    tbody.insertBefore(tr1, tbody.children[999]);
  }
}

function remove(id) {
  const idx = data.findIndex(d => d.id === id);
  if (idx !== -1) {
    data.splice(idx, 1);
    tbody.children[idx].remove();
  }
}

function selectRow(id) {
  if (selectedId != null) {
    const old = tbody.querySelector('tr.danger');
    if (old) old.className = '';
  }
  selectedId = id;
  const idx = data.findIndex(d => d.id === id);
  if (idx !== -1) {
    tbody.children[idx].className = 'danger';
  }
}

// Event delegation
tbody.addEventListener('click', (e) => {
  const target = e.target;
  if (target.closest('.glyphicon-remove')) {
    const tr = target.closest('tr');
    if (tr) remove(parseInt(tr.dataset.id));
  } else {
    const a = target.closest('td.col-md-4 a');
    if (a) {
      const tr = a.closest('tr');
      if (tr) selectRow(parseInt(tr.dataset.id));
    }
  }
});

// Expose for benchmark runner
window._bench = { run, runLots, add, update, clear, swapRows, remove, selectRow, getData: () => data };
