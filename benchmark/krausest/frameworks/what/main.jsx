// What Framework keyed implementation — compiled fine-grained path.
// The what-compiler vite plugin lowers the keyed `.map()` to `_$mapArray`
// (keyed reconciliation) and per-binding effects, like Solid's compiled output.
// Mirrors the official Solid js-framework-benchmark entry: per-row label
// signals so the partial update is fine-grained (no list diff at all).
import { signal, batch, mount } from 'what-framework';
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
      label: signal(`${adjectives[_random(adjectives.length)]} ${colours[_random(colours.length)]} ${nouns[_random(nouns.length)]}`),
    };
  }
  return data;
}

function App() {
  const data = signal([]);
  const selected = signal(0);

  const run = () => batch(() => { data(buildData(1000)); selected(0); });
  const runLots = () => batch(() => { data(buildData(10000)); selected(0); });
  const add = () => data((d) => d.concat(buildData(1000)));
  const update = () => {
    const d = data();
    batch(() => {
      for (let i = 0; i < d.length; i += 10) d[i].label((l) => l + ' !!!');
    });
  };
  const clear = () => batch(() => { data([]); selected(0); });
  const swapRows = () => {
    const d = data();
    if (d.length > 998) {
      const e = d.slice();
      const tmp = e[1]; e[1] = e[998]; e[998] = tmp;
      data(e);
    }
  };
  const remove = (id) => data((d) => d.filter((r) => r.id !== id));

  return (
    <div class="container">
      <div class="jumbotron"><div class="row">
        <div class="col-md-6"><h1>What-keyed</h1></div>
        <div class="col-md-6"><div class="row">
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="run" onclick={run}>Create 1,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="runlots" onclick={runLots}>Create 10,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="add" onclick={add}>Append 1,000 rows</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="update" onclick={update}>Update every 10th row</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="clear" onclick={clear}>Clear</button></div>
          <div class="col-sm-6"><button type="button" class="btn btn-primary" id="swaprows" onclick={swapRows}>Swap Rows</button></div>
        </div></div>
      </div></div>
      <table class="table table-hover table-striped test-data"><tbody>
        {data().map((row) => (
          <tr key={row.id} class={selected() === row.id ? 'danger' : ''}>
            <td class="col-md-1">{row.id}</td>
            <td class="col-md-4"><a class="lbl" onclick={() => selected(row.id)}>{() => row.label()}</a></td>
            <td class="col-md-1"><a class="remove" onclick={() => remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
            <td class="col-md-6"></td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

mount(<App />, '#main');
