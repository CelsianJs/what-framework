// Vanilla JS keyed reference — direct DOM manipulation, mirroring the
// canonical js-framework-benchmark vanillajs implementation (template row
// cloning + event delegation). This is the floor every framework is
// compared against.
import '../../shared/main.css';

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

let nextId = 1;
function _random(max) { return Math.round(Math.random() * 1000) % max; }
function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = {
      id: nextId++,
      label: `${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`,
    };
  }
  return data;
}

document.getElementById('main').innerHTML = `
<div class="container">
  <div class="jumbotron"><div class="row">
    <div class="col-md-6"><h1>Vanilla-keyed</h1></div>
    <div class="col-md-6"><div class="row">
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="run">Create 1,000 rows</button></div>
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="runlots">Create 10,000 rows</button></div>
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="add">Append 1,000 rows</button></div>
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="update">Update every 10th row</button></div>
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="clear">Clear</button></div>
      <div class="col-sm-6"><button type="button" class="btn btn-primary" id="swaprows">Swap Rows</button></div>
    </div></div>
  </div></div>
  <table class="table table-hover table-striped test-data"><tbody id="tbody"></tbody></table>
</div>`;

const tbody = document.getElementById('tbody');

const rowTemplate = document.createElement('tr');
rowTemplate.innerHTML = '<td class="col-md-1"></td><td class="col-md-4"><a class="lbl"></a></td><td class="col-md-1"><a class="remove"><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td><td class="col-md-6"></td>';

let data = [];          // [{id, label}]
let rows = [];          // [{tr, idNode, labelNode}] parallel to data
let selectedTr = null;

function createRow(item) {
  const tr = rowTemplate.cloneNode(true);
  const idNode = tr.firstChild;
  const labelNode = tr.childNodes[1].firstChild;
  idNode.textContent = item.id;
  labelNode.textContent = item.label;
  tr.__id = item.id;
  return { tr, idNode, labelNode };
}

function appendRows(items) {
  const frag = document.createDocumentFragment();
  for (const item of items) {
    const row = createRow(item);
    rows.push(row);
    frag.appendChild(row.tr);
  }
  tbody.appendChild(frag);
}

function clearAll() {
  data = [];
  rows = [];
  selectedTr = null;
  tbody.textContent = '';
}

document.getElementById('run').onclick = () => { clearAll(); data = buildData(1000); appendRows(data); };
document.getElementById('runlots').onclick = () => { clearAll(); data = buildData(10000); appendRows(data); };
document.getElementById('add').onclick = () => { const more = buildData(1000); data = data.concat(more); appendRows(more); };
document.getElementById('clear').onclick = clearAll;
document.getElementById('update').onclick = () => {
  for (let i = 0; i < data.length; i += 10) {
    data[i].label += ' !!!';
    rows[i].labelNode.textContent = data[i].label;
  }
};
document.getElementById('swaprows').onclick = () => {
  if (data.length <= 998) return;
  const tmp = data[1]; data[1] = data[998]; data[998] = tmp;
  const tmpRow = rows[1]; rows[1] = rows[998]; rows[998] = tmpRow;
  const a = rows[998].tr;            // originally at index 1
  const b = rows[1].tr;              // originally at index 998
  const afterB = b.nextSibling;
  tbody.insertBefore(b, a);
  tbody.insertBefore(a, afterB);
};

tbody.addEventListener('click', (e) => {
  const target = e.target;
  const tr = target.closest('tr');
  if (!tr) return;
  if (target.closest('a.remove')) {
    const idx = rows.findIndex((r) => r.tr === tr);
    if (idx >= 0) { data.splice(idx, 1); rows.splice(idx, 1); tr.remove(); }
  } else if (target.closest('a.lbl')) {
    if (selectedTr) selectedTr.classList.remove('danger');
    tr.classList.add('danger');
    selectedTr = tr;
  }
});
