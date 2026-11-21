// React habits the declarations reject on the async surface. Each mistake is
// on its own line and names the error it must raise; async-types.test.js
// checks every line errors with that code, and nothing else does.
import { computed, useMemo, useOptimistic, useState, useTransition, For, Suspense } from 'what-framework';

type User = { name: string; id: number };
declare const api: { user(id: number): Promise<User> };

export function Pending() {
  const [isPending] = useTransition();
  return <div>{isPending && <span />}</div>; // TS2774
}

export function Memo() {
  const user = useMemo(() => api.user(1));
  return <h1>{user().name}</h1>; // TS2339
}

export async function AsyncProfile() {
  const user = await api.user(1);
  return <h1>{user.name}</h1>;
}
export const UsesAsync = () => <Suspense fallback={<p />}><AsyncProfile /></Suspense>; // TS2786

export function OptimisticArray() {
  const [todos] = useState<User[]>([]);
  const [opt] = useOptimistic(todos);
  return <ul>{opt.map((x: User) => <li>{x.name}</li>)}</ul>; // TS2339
}

export function KeyedRowReadAsValue() {
  const users = computed(async () => [await api.user(1)]);
  return <ul><For each={users} key={(u) => u.id}>{(u) => <li>{u.id}</li>}</For></ul>; // TS2339
}
