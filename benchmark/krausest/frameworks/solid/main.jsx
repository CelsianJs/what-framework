// SolidJS keyed implementation — mirrors the official js-framework-benchmark
// frameworks/keyed/solid entry: <For> keyed list + per-row label signals so
// the partial update is fine-grained.
import { createSignal, batch, For } from 'solid-js';
import { render } from 'solid-js/web';
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
  const [selected, setSelected] = createSignal(0);

  const run = () => batch(() => { setData(buildData(1000)); setSelected(0); });
  const runLots = () => batch(() => { setData(buildData(10000)); setSelected(0); });
  const add = () => setData((d) => d.concat(buildData(1000)));
  const update = () => batch(() => {
    const d = data();
    for (let i = 0; i < d.length; i += 10) d[i].setLabel(d[i].label() + ' !!!');
  });
  const clear = () => batch(() => { setData([]); setSelected(0); });
  const swapRows = () => {
    const d = data();
    if (d.length > 998) {
      const e = d.slice();
      const tmp = e[1]; e[1] = e[998]; e[998] = tmp;
      setData(e);
    }
  };
  const remove = (id) => setData((d) => d.filter((r) => r.id !== id));

  return (
    <div class="container">
      <div class="jumbotron"><div class="row">
        <div class="col-md-6"><h1>Solid-keyed</h1></div>
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
        <For each={data()}>{(row) => (
          <tr class={selected() === row.id ? 'danger' : ''}>
            <td class="col-md-1">{row.id}</td>
            <td class="col-md-4"><a class="lbl" onClick={() => setSelected(row.id)}>{row.label()}</a></td>
            <td class="col-md-1"><a class="remove" onClick={() => remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
            <td class="col-md-6"></td>
          </tr>
        )}</For>
      </tbody></table>
    </div>
  );
}

render(() => <App />, document.getElementById('main'));
