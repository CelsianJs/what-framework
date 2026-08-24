// Uses the control-flow tags the What compiler lowers itself. Under the
// compiler these need no import; without it they must be imported from
// what-framework. Nothing here is imported, deliberately.
export function List({ items, visible }) {
  return (
    <div>
      <Show when={visible}>
        <For each={items} key={(item) => item.id}>
          {(item) => <li>{() => item().label}</li>}
        </For>
      </Show>
      <Switch>
        <Match when={visible}>shown</Match>
      </Switch>
    </div>
  );
}
