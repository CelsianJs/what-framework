/**
 * React Framework Benchmark — matching the krausest API surface
 * Uses React 19 with standard hooks, NO memo optimization
 * to show the default React performance characteristics.
 */
import React, { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';

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

function Row({ item, isSelected, onSelect, onRemove }) {
  return (
    <tr className={isSelected ? 'danger' : ''}>
      <td className="col-md-1">{item.id}</td>
      <td className="col-md-4">
        <a onClick={() => onSelect(item.id)}>{item.label}</a>
      </td>
      <td className="col-md-1">
        <a onClick={() => onRemove(item.id)}>
          <span className="glyphicon glyphicon-remove" aria-hidden="true" />
        </a>
      </td>
      <td className="col-md-6" />
    </tr>
  );
}

function App() {
  const [data, setData] = useState([]);
  const [selected, setSelected] = useState(null);
  const actionsRef = useRef({});

  const run = useCallback(() => { setData(buildData(1000)); setSelected(null); }, []);
  const runLots = useCallback(() => { setData(buildData(10000)); setSelected(null); }, []);
  const add = useCallback(() => { setData(d => [...d, ...buildData(1000)]); }, []);
  const update = useCallback(() => {
    setData(d => {
      const newData = [...d];
      for (let i = 0; i < newData.length; i += 10) {
        newData[i] = { ...newData[i], label: newData[i].label + ' !!!' };
      }
      return newData;
    });
  }, []);
  const clear = useCallback(() => { setData([]); setSelected(null); }, []);
  const swapRows = useCallback(() => {
    setData(d => {
      if (d.length > 998) {
        const newData = [...d];
        [newData[1], newData[998]] = [newData[998], newData[1]];
        return newData;
      }
      return d;
    });
  }, []);
  const remove = useCallback((id) => { setData(d => d.filter(item => item.id !== id)); }, []);
  const selectRow = useCallback((id) => { setSelected(id); }, []);

  // Expose to benchmark runner
  actionsRef.current = { run, runLots, add, update, clear, swapRows, remove, selectRow, data, selected, buildData };
  window._bench = actionsRef.current;

  return (
    <div className="container">
      <div className="jumbotron">
        <div className="row">
          <div className="col-md-6"><h1>React (keyed)</h1></div>
          <div className="col-md-6">
            <div className="row">
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="run" onClick={run}>Create 1,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="runlots" onClick={runLots}>Create 10,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="add" onClick={add}>Append 1,000 rows</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="update" onClick={update}>Update every 10th row</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="clear" onClick={clear}>Clear</button></div>
              <div className="col-sm-6 smallpad"><button type="button" className="btn btn-primary btn-block" id="swaprows" onClick={swapRows}>Swap Rows</button></div>
            </div>
          </div>
        </div>
      </div>
      <table className="table table-hover table-striped test-data">
        <tbody id="tbody">
          {data.map(item => (
            <Row key={item.id} item={item} isSelected={selected === item.id} onSelect={selectRow} onRemove={remove} />
          ))}
        </tbody>
      </table>
      <span className="preloadicon glyphicon glyphicon-remove" aria-hidden="true" />
    </div>
  );
}

const root = createRoot(document.getElementById('main'));
root.render(<App />);
