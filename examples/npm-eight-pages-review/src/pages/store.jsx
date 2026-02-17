import { useSignal } from 'what-framework';
import { useTeamStore } from '../store.js';

export const page = {
  mode: 'client',
};

export default function StorePage() {
  const store = useTeamStore();
  const draft = useSignal('');

  const addPerson = () => {
    store.add(draft());
    draft('');
  };

  return (
    <section>
      <h1 class="page-title">Global store and derived values</h1>
      <p class="lead">Uses <code>createStore</code> and <code>derived</code> from a shared module.</p>

      <div class="card">
        <p>
          Total: <strong>{store.total}</strong> | Online: <strong>{store.onlineCount}</strong>
        </p>

        <div class="button-row">
          <input
            class="text-input"
            value={draft()}
            onInput={(e) => draft(e.target.value)}
            placeholder="Add teammate"
          />
          <button class="btn btn-primary" onClick={addPerson}>Add</button>
        </div>

        <div class="button-row">
          <button class="btn" onClick={() => store.setFilter('all')}>All</button>
          <button class="btn" onClick={() => store.setFilter('online')}>Online</button>
          <button class="btn" onClick={() => store.setFilter('offline')}>Offline</button>
        </div>

        <ul class="stack-list">
          {store.visible.map((person) => (
            <li class="row">
              <span>{person.name}</span>
              <div class="button-row">
                <span class="badge">{person.online ? 'online' : 'offline'}</span>
                <button class="btn btn-ghost" onClick={() => store.toggle(person.id)}>Toggle</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
