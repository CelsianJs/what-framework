// What: the krausest page in the only JSX form what-server can render.
// what-compiler's fine-grained output is client-only (it hoists _$template()
// calls that need `document`; see packages/compiler/src/vite-plugin.js
// ssrGuardError), so server views go through the automatic JSX runtime
// (jsxImportSource "what-framework"), which emits h() vnodes. Reactivity is
// therefore written out explicitly: the keyed list is a `.map()` with a `key`
// prop inside a thunk, and the selected-row class is a function-valued prop,
// which is the shape CLAUDE.md documents for the h()/runtime-JSX path.
import { signal, Suspense, createResource } from 'what-framework';
import { HEADING, FALLBACK_TEXT, SHELL_END_TEXT } from '../../shared/data.mjs';

function Jumbotron(props) {
  const a = props.actions;
  return (
    <div class="jumbotron"><div class="row">
      <div class="col-md-6"><h1>{HEADING}</h1></div>
      <div class="col-md-6"><div class="row">
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="run" onclick={a.run}>Create 1,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="runlots" onclick={a.runLots}>Create 10,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="add" onclick={a.add}>Append 1,000 rows</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="update" onclick={a.update}>Update every 10th row</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="clear" onclick={a.clear}>Clear</button></div>
        <div class="col-sm-6"><button type="button" class="btn btn-primary" id="swaprows" onclick={a.swapRows}>Swap Rows</button></div>
      </div></div>
    </div></div>
  );
}

function createActions(rows, data, selected) {
  return {
    run: () => { data(rows); selected(0); },
    runLots: () => { data(rows); selected(0); },
    add: () => data((d) => d.concat(rows)),
    update: () => data((d) => d.map((r, i) => (i % 10 ? r : { id: r.id, label: r.label + ' !!!' }))),
    clear: () => { data([]); selected(0); },
    swapRows: () => data((d) => {
      if (d.length <= 998) return d;
      const e = d.slice();
      const tmp = e[1]; e[1] = e[998]; e[998] = tmp;
      return e;
    }),
  };
}

function Rows(props) {
  const { data, selected, remove } = props;
  return () => data().map((row) => (
    <tr key={row.id} class={() => (selected() === row.id ? 'danger' : '')}>
      <td class="col-md-1">{row.id}</td>
      <td class="col-md-4"><a class="lbl" onclick={() => selected(row.id)}>{row.label}</a></td>
      <td class="col-md-1"><a class="remove" onclick={() => remove(row.id)}><span class="glyphicon glyphicon-remove" aria-hidden="true"></span></a></td>
      <td class="col-md-6"></td>
    </tr>
  ));
}

export function App(props) {
  const data = signal(props.rows);
  const selected = signal(props.selected);
  const remove = (id) => data((d) => d.filter((r) => r.id !== id));
  return (
    <div class="container">
      <Jumbotron actions={createActions(props.rows, data, selected)} />
      <table class="table table-hover table-striped test-data"><tbody>
        <Rows data={data} selected={selected} remove={remove} />
      </tbody></table>
    </div>
  );
}

function AsyncTable(props) {
  const [rows] = createResource(props.load, { key: 'rows' });
  const remove = () => {};
  return (
    <table class="table table-hover table-striped test-data"><tbody>
      <Rows data={() => rows() || []} selected={props.selected} remove={remove} />
    </tbody></table>
  );
}

export function AsyncApp(props) {
  const data = signal([]);
  const selected = signal(props.selected);
  return (
    <div class="container">
      <Jumbotron actions={createActions([], data, selected)} />
      <Suspense fallback={<p class="loading">{FALLBACK_TEXT}</p>}>
        <AsyncTable load={props.load} selected={selected} />
      </Suspense>
      <footer id="shell-end">{SHELL_END_TEXT}</footer>
    </div>
  );
}
