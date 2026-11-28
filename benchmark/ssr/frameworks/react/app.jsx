// React 19: the krausest page in the react-hooks idiom of the official
// js-framework-benchmark entry (memo rows, stable callbacks, keyed .map()).
// The async table reads its data with use() under <Suspense>.
import { memo, use, useCallback, useState, Suspense } from 'react';
import { HEADING, FALLBACK_TEXT, SHELL_END_TEXT } from '../../shared/data.mjs';

function Jumbotron({ actions: a }) {
  return (
    <div className="jumbotron"><div className="row">
      <div className="col-md-6"><h1>{HEADING}</h1></div>
      <div className="col-md-6"><div className="row">
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="run" onClick={a.run}>Create 1,000 rows</button></div>
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="runlots" onClick={a.runLots}>Create 10,000 rows</button></div>
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="add" onClick={a.add}>Append 1,000 rows</button></div>
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="update" onClick={a.update}>Update every 10th row</button></div>
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="clear" onClick={a.clear}>Clear</button></div>
        <div className="col-sm-6"><button type="button" className="btn btn-primary" id="swaprows" onClick={a.swapRows}>Swap Rows</button></div>
      </div></div>
    </div></div>
  );
}

function createActions(rows, setData, setSelected) {
  return {
    run: () => { setData(rows); setSelected(0); },
    runLots: () => { setData(rows); setSelected(0); },
    add: () => setData((d) => d.concat(rows)),
    update: () => setData((d) => d.map((r, i) => (i % 10 ? r : { id: r.id, label: r.label + ' !!!' }))),
    clear: () => { setData([]); setSelected(0); },
    swapRows: () => setData((d) => {
      if (d.length <= 998) return d;
      const e = d.slice();
      const tmp = e[1]; e[1] = e[998]; e[998] = tmp;
      return e;
    }),
  };
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

function Rows({ data, selected, select, remove }) {
  return data.map((item) => (
    <Row key={item.id} item={item} isSelected={selected === item.id} select={select} remove={remove} />
  ));
}

export function App(props) {
  const [data, setData] = useState(props.rows);
  const [selected, setSelected] = useState(props.selected);
  const select = useCallback((id) => setSelected(id), []);
  const remove = useCallback((id) => setData((d) => d.filter((r) => r.id !== id)), []);
  return (
    <div className="container">
      <Jumbotron actions={createActions(props.rows, setData, setSelected)} />
      <table className="table table-hover table-striped test-data"><tbody>
        <Rows data={data} selected={selected} select={select} remove={remove} />
      </tbody></table>
    </div>
  );
}

function AsyncTable({ load, selected, select }) {
  const rows = use(load());
  const remove = useCallback(() => {}, []);
  return (
    <table className="table table-hover table-striped test-data"><tbody>
      <Rows data={rows} selected={selected} select={select} remove={remove} />
    </tbody></table>
  );
}

export function AsyncApp(props) {
  const [, setData] = useState([]);
  const [selected, setSelected] = useState(props.selected);
  const select = useCallback((id) => setSelected(id), []);
  return (
    <div className="container">
      <Jumbotron actions={createActions([], setData, setSelected)} />
      <Suspense fallback={<p className="loading">{FALLBACK_TEXT}</p>}>
        <AsyncTable load={props.load} selected={selected} select={select} />
      </Suspense>
      <footer id="shell-end">{SHELL_END_TEXT}</footer>
    </div>
  );
}
