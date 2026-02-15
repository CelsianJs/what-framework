// Home — contact list with search and sorting
// Demonstrates: store usage, computed/derived values,
// controlled inputs, conditional rendering, list rendering

import { useContacts } from '../store.js';
import { ContactCard } from '../components/ContactCard.jsx';

export function Home() {
  const store = useContacts();

  return (
    <div>
      <div class="toolbar">
        <input
          class="input search-input"
          type="text"
          placeholder="Search contacts..."
          value={store.search}
          onInput={e => store.setSearch(e.target.value)}
        />
        <select
          class="select"
          value={store.sortBy}
          onChange={e => store.setSortBy(e.target.value)}
        >
          <option value="name">Sort by Name</option>
          <option value="recent">Sort by Recent</option>
        </select>
      </div>

      <p class="count">{store.count} contact{store.count !== 1 ? 's' : ''}</p>

      <div class="card-list">
        {store.filtered.length > 0
          ? store.filtered.map(contact =>
              <ContactCard key={contact.id} contact={contact} />
            )
          : <EmptyState hasContacts={store.count > 0} />
        }
      </div>

      <Style />
    </div>
  );
}

function EmptyState({ hasContacts }) {
  if (hasContacts) {
    return <p class="empty">No contacts match your search.</p>;
  }
  return (
    <div class="empty">
      <p class="empty-title">No contacts yet</p>
      <p>Add your first contact to get started.</p>
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .toolbar { display: flex; gap: 8px; margin-bottom: 16px; }
      .search-input { flex: 1; }
      .input {
        padding: 8px 12px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface); color: var(--text); outline: none;
      }
      .input:focus { border-color: var(--primary); }
      .select {
        padding: 8px 12px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface); color: var(--text); outline: none;
      }
      .count { font-size: 13px; color: var(--text-muted); margin-bottom: 12px; }
      .card-list { display: flex; flex-direction: column; gap: 8px; }
      .card {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px; background: var(--surface);
        border: 1px solid var(--border); border-radius: var(--radius);
        box-shadow: var(--shadow);
      }
      .card-editing {
        flex-direction: column; gap: 8px; align-items: stretch;
      }
      .card-editing .input { width: 100%; }
      .card-body { display: flex; align-items: center; gap: 12px; }
      .card-avatar {
        width: 36px; height: 36px; border-radius: 50%;
        background: var(--primary); color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-weight: 600; font-size: 14px; flex-shrink: 0;
      }
      .card-name { font-weight: 600; font-size: 14px; }
      .card-email { font-size: 13px; color: var(--text-muted); }
      .card-phone { font-size: 12px; color: var(--text-faint); }
      .card-actions { display: flex; gap: 6px; }
      .btn {
        padding: 6px 12px; font-size: 13px; font-weight: 500;
        border: 1px solid var(--border); border-radius: 6px;
        background: var(--surface); color: var(--text);
        cursor: pointer; transition: all 0.15s;
      }
      .btn:hover { border-color: var(--text-muted); }
      .btn-sm { padding: 4px 10px; font-size: 12px; }
      .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
      .btn-primary:hover { background: var(--primary-hover); }
      .btn-danger { color: var(--danger); border-color: var(--danger); background: transparent; }
      .btn-danger:hover { background: var(--danger); color: #fff; }
      .empty { text-align: center; padding: 40px; color: var(--text-muted); }
      .empty-title { font-weight: 600; margin-bottom: 4px; }
    `}</style>
  );
}
