// ContactCard — displays a single contact with edit/delete
// Demonstrates: useState for local UI state, useRef for DOM refs,
// event handlers, conditional rendering

import { useState, useRef } from 'what-framework';
import { useContacts } from '../store.js';

export function ContactCard({ contact }) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(contact.name);
  const [editEmail, setEditEmail] = useState(contact.email);
  const inputRef = useRef(null);
  const store = useContacts();

  function startEdit() {
    setEditName(contact.name);
    setEditEmail(contact.email);
    setEditing(true);
    // Focus after DOM updates
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function save() {
    const name = editName.trim();
    const email = editEmail.trim();
    if (name && email) {
      store.update(contact.id, { name, email });
    }
    setEditing(false);
  }

  function cancel() {
    setEditing(false);
  }

  if (editing) {
    return (
      <div class="card card-editing">
        <input
          ref={inputRef}
          class="input"
          value={editName}
          onInput={e => setEditName(e.target.value)}
          placeholder="Name"
          onKeydown={e => e.key === 'Enter' && save()}
        />
        <input
          class="input"
          value={editEmail}
          onInput={e => setEditEmail(e.target.value)}
          placeholder="Email"
          onKeydown={e => e.key === 'Enter' && save()}
        />
        <div class="card-actions">
          <button class="btn btn-sm btn-primary" onClick={save}>Save</button>
          <button class="btn btn-sm" onClick={cancel}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div class="card">
      <div class="card-body">
        <div class="card-avatar">{contact.name.charAt(0).toUpperCase()}</div>
        <div class="card-info">
          <div class="card-name">{contact.name}</div>
          <div class="card-email">{contact.email}</div>
          {contact.phone && <div class="card-phone">{contact.phone}</div>}
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-sm" onClick={startEdit}>Edit</button>
        <button class="btn btn-sm btn-danger" onClick={() => store.remove(contact.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}
