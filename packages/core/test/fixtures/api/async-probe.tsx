// The async surface as the docs teach it (docs/ASYNC.md): accepted by the
// shipped declarations. See async-mistakes.tsx for what they reject.
import {
  computed, signal, useState, useOptimistic, useTransition, refresh, For, Suspense,
} from 'what-framework';

type Todo = { id: number; title: string; done: boolean };
declare const api: { list(o: { signal: AbortSignal }): Promise<Todo[]>; toggle(id: number): Promise<Todo> };

export function Todos() {
  const todos = computed(({ signal: abort }) => api.list({ signal: abort }));
  const [isPending, start] = useTransition();
  const [shown, toggle] = useOptimistic(todos, (list: Todo[], id: number) =>
    list.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const n: number = shown().length;
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <button disabled={isPending()} onClick={() => refresh(todos)}>{n}</button>
      <ul>
        <For each={shown} key={(t) => t.id}>
          {(t) => <li onClick={() => start(async () => { toggle(t().id); await api.toggle(t().id); })}>{() => t().title}</li>}
        </For>
      </ul>
      <ol><For each={[1, 2, 3]}>{(n) => <li>{n + 1}</li>}</For></ol>
    </Suspense>
  );
}

export function Like() {
  const [liked] = useState(false);
  const [opt, setOpt] = useOptimistic(liked);
  const count = signal(0);
  const [plusOne, add] = useOptimistic(count, (a: number, b: number) => a + b);
  const total: number = plusOne();
  return <button onClick={() => { setOpt(!opt()); add(1); }}>{opt() ? 'liked' : 'like'}{total}</button>;
}
