// Solid 1.9: the krausest page, compiled by babel-preset-solid in SSR mode
// (generate: "ssr"). Keyed list with <For>, async table with createResource
// under <Suspense>, as in the official js-framework-benchmark entry.
import { createSignal, createResource, For, Suspense } from 'solid-js';
import { HEADING, FALLBACK_TEXT, SHELL_END_TEXT } from '../../shared/data.mjs';

function Jumbotron(props) {
  const a = props.actions;
  return (
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>{HEADING}</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="run" onClick={a.run}>Create 1,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="runlots" onClick={a.runLots}>Create 10,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="add" onClick={a.add}>Append 1,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="update" onClick={a.update}>Update every 10th row</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="clear" onClick={a.clear}>Clear</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="swaprows" onClick={a.swapRows}>Swap Rows</button></div>
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

function Rows(props) {
  return (
    <For each={props.data()}>{(row) => (
      <tr class={props.selected() === row.id ? 'danger' : ''}>
        <td class="col-md-1">{row.id}</td>
        <td class="col-md-4"><a class="lbl" onClick={() => props.setSelected(row.id)}>{row.label}</a></td>
        <td class="col-md-1"><a class="remove" onClick={() => props.remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
        <td class="col-md-6"></td>
      </tr>
    )}</For>
  );
}

export function App(props) {
  const [data, setData] = createSignal(props.rows);
  const [selected, setSelected] = createSignal(props.selected);
  const remove = (id) => setData((d) => d.filter((r) => r.id !== id));
  return (
    <div class="container">
      <Jumbotron actions={createActions(props.rows, setData, setSelected)} />
      <table class="table table-hover table-striped test-data"><tbody>
        <Rows data={data} selected={selected} setSelected={setSelected} remove={remove} />
      </tbody></table>
    </div>
  );
}

function AsyncTable(props) {
  const [rows] = createResource(props.load);
  const remove = () => {};
  return (
    <table class="table table-hover table-striped test-data"><tbody>
      <Rows data={() => rows() || []} selected={props.selected} setSelected={props.setSelected} remove={remove} />
    </tbody></table>
  );
}

export function AsyncApp(props) {
  const [, setData] = createSignal([]);
  const [selected, setSelected] = createSignal(props.selected);
  return (
    <div class="container">
      <Jumbotron actions={createActions([], setData, setSelected)} />
      <Suspense fallback={<p class="loading">{FALLBACK_TEXT}</p>}>
        <AsyncTable load={props.load} selected={selected} setSelected={setSelected} />
      </Suspense>
      <footer id="shell-end">{SHELL_END_TEXT}</footer>
    </div>
  );
}
