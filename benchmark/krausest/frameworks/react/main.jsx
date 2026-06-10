// React 19 keyed implementation — canonical react-hooks style (memo rows,
// stable callbacks, immutable updates), mirroring the official
// js-framework-benchmark frameworks/keyed/react-hooks entry.
import React, { memo, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
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

const Row = memo(function Row({ item, isSelected, select, remove }) {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4"><a className="lbl" onClick={() => select(item.id)}>{item.label}</a></td>
      <td className="col-md-1"><a className="remove" onClick={() => remove(item.id)}><span className="glyphicon glyphicon-remove" aria-hidden="true" /></a></td>
      <td className="col-md-6" />
    </tr>
  );
});

function App() {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState(0);

  const run = useCallback(() => { setData(buildData(1000)); setSelected(0); }, []);
  const runLots = useCallback(() => { setData(buildData(10000)); setSelected(0); }, []);
  const add = useCallback(() => setData((d) => d.concat(buildData(1000))), []);
  const update = useCallback(() => setData((d) => {
    const e = d.slice();
    for (let i = 0; i < e.length; i += 10) e[i] = { id: e[i].id, label: e[i].label + ' !!!' };
    return e;
  }), []);
  const clear = useCallback(() => { setData([]); setSelected(0); }, []);
  const swapRows = useCallback(() => setData((d) => {
    if (d.length <= 998) return d;
    const e = d.slice();
    const tmp = e[1]; e[1] = e[998]; e[998] = tmp;
    return e;
  }), []);
  const select = useCallback((id) => setSelected(id), []);
  const remove = useCallback((id) => setData((d) => d.filter((r) => r.id !== id)), []);

  return (
    <div className="container">
      <div className="jumbotron"><div className="row">
        <div className="col-md-6"><h1>React-keyed</h1></div>
        <div className="col-md-6"><div className="row">
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="run" onClick={run}>Create 1,000 rows</button></div>
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="runlots" onClick={runLots}>Create 10,000 rows</button></div>
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="add" onClick={add}>Append 1,000 rows</button></div>
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="update" onClick={update}>Update every 10th row</button></div>
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="clear" onClick={clear}>Clear</button></div>
          <div className="col-sm-6"><button type="button" className="btn btn-primary" id="swaprows" onClick={swapRows}>Swap Rows</button></div>
        </div></div>
      </div></div>
      <table className="table table-hover table-striped test-data"><tbody>
        {data.map((item) => (
          <Row key={item.id} item={item} isSelected={selected === item.id} select={select} remove={remove} />
        ))}
      </tbody></table>
    </div>
  );
}

createRoot(document.getElementById('main')).render(<App />);
