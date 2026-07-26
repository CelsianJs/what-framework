// Control-flow + nullable components must type-check clean under strict mode.
// Guards the Component alias (a component may legitimately return null) and
// Show/For/Switch/Match satisfying JSX.ElementType.
import { signal, Show, For, Switch, Match } from 'what-framework';
import type { Component } from 'what-framework';

function MaybeNothing({ on }: { on: boolean }) {
  if (!on) return null;
  return <span>something</span>;
}

const Typed: Component<{ label: string }> = ({ label }) => <em>{label}</em>;

const TypedNullable: Component<{ label?: string }> = ({ label }) =>
  label ? <em>{label}</em> : null;

function App() {
  const open = signal(true);
  const items = signal<string[]>(['a', 'b']);
  return (
    <div>
      <MaybeNothing on={false} />
      <Typed label="hi" />
      <TypedNullable />
      <Show when={open} fallback={<span>closed</span>}>
        <p>open</p>
      </Show>
      <For each={items} fallback={<span>empty</span>}>
        {(item: string) => <li>{item}</li>}
      </For>
      <Switch fallback={<span>none</span>}>
        <Match when={open}>
          <p>matched</p>
        </Match>
      </Switch>
    </div>
  );
}

export default App;
