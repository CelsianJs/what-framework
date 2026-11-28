// SolidJS 2.0 keyed implementation — state logic mirrors the official
// js-framework-benchmark frameworks/keyed/solid-next entry (Solid's own 2.0
// entry): <For> keyed list, per-row label signals, and a store keyed by row id
// for selection (2.0 removed createSelector; a store write touches only the
// previous and the new row). 2.0 batches every write until a microtask flush,
// so there is no batch(). Markup is this harness's shared markup (identical
// across implementations).
import { createSignal, createStore, For } from 'solid-js';
import { render } from '@solidjs/web';
import '../../shared/main.css';

const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'];
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

let nextId = 1;
function _random(max) { return Math.round(Math.random() * 1000) % max; }
function buildData(count) {
  const data = new Array(count);
  for (let i = 0; i < count; i++) {
    const [label, setLabel] = createSignal(`${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`);
    data[i] = { id: nextId++, label, setLabel };
  }
  return data;
}

function App() {
  const [data, setData] = createSignal([]);
  const [selected, setSelected] = createStore({ selected: null });

  const run = () => setData(buildData(1000));
  const runLots = () => setData(buildData(10000));
  const add = () => setData((d) => [...d, ...buildData(1000)]);
  const update = () => {
    for (let i = 0, d = data(), len = d.length; i < len; i += 10) d[i].setLabel((l) => l + ' !!!');
  };
  const clear = () => setData([]);
  const swapRows = () => {
    const list = data().slice();
    if (list.length > 998) {
      const tmp = list[1]; list[1] = list[998]; list[998] = tmp;
      setData(list);
    }
  };
  const select = (id) => setSelected((s) => {
    const prev = s.selected;
    if (prev != null && id !== prev) delete s[prev];
    s[id] = true;
    s.selected = id;
  });
  const remove = (id) => setData((d) => d.toSpliced(d.findIndex((r) => r.id === id), 1));

  return (
    <div class="container">
      <div class="jumbotron"><div class="row">
        <div class="col-md-6"><h1>Solid2-keyed</h1></div>
        <div class="col-md-6"><div class="row">
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="run" onClick={run}>Create 1,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="runlots" onClick={runLots}>Create 10,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="add" onClick={add}>Append 1,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="update" onClick={update}>Update every 10th row</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="clear" onClick={clear}>Clear</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="swaprows" onClick={swapRows}>Swap Rows</button></div>
        </div></div>
      </div></div>
      <table class="table table-hover table-striped test-data"><tbody>
        <For each={data()}>{(row) => {
          const { id: rowId, label } = row;
          return (
            <tr class={selected[rowId] ? 'danger' : ''}>
              <td class="col-md-1">{rowId}</td>
              <td class="col-md-4"><a class="lbl" onClick={() => select(rowId)}>{label()}</a></td>
              <td class="col-md-1"><a class="remove" onClick={() => remove(rowId)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
              <td class="col-md-6"></td>
            </tr>
          );
        }}</For>
      </tbody></table>
    </div>
  );
}

render(() => <App />, document.getElementById('main'));
