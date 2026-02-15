// AddContact — form for creating a new contact
// Demonstrates: useState for form state, form submission,
// validation, programmatic navigation after action

import { useState } from 'what-framework';
import { navigate } from 'what-router';
import { useContacts } from '../store.js';

export function AddContact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const store = useContacts();

  function handleSubmit(e) {
    e.preventDefault();

    // Basic validation
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setError('Name is required');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Valid email is required');
      return;
    }

    // Add to store and navigate home
    store.add({
      name: trimmedName,
      email: trimmedEmail,
      phone: phone.trim() || null,
    });

    navigate('/');
  }

  return (
    <div>
      <h2 class="page-title">Add Contact</h2>

      <form class="form" onSubmit={handleSubmit}>
        {error && <p class="form-error">{error}</p>}

        <label class="field">
          <span class="field-label">Name *</span>
          <input
            class="input"
            type="text"
            value={name}
            onInput={e => { setName(e.target.value); setError(''); }}
            placeholder="Jane Doe"
          />
        </label>

        <label class="field">
          <span class="field-label">Email *</span>
          <input
            class="input"
            type="email"
            value={email}
            onInput={e => { setEmail(e.target.value); setError(''); }}
            placeholder="jane@example.com"
          />
        </label>

        <label class="field">
          <span class="field-label">Phone</span>
          <input
            class="input"
            type="tel"
            value={phone}
            onInput={e => setPhone(e.target.value)}
            placeholder="+1 555-1234"
          />
        </label>

        <div class="form-actions">
          <button class="btn btn-primary" type="submit">Add Contact</button>
          <button class="btn" type="button" onClick={() => navigate('/')}>Cancel</button>
        </div>
      </form>

      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
      .page-title { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
      .form { display: flex; flex-direction: column; gap: 16px; max-width: 400px; }
      .field { display: flex; flex-direction: column; gap: 4px; }
      .field-label { font-size: 13px; font-weight: 600; color: var(--text-muted); }
      .input {
        padding: 8px 12px; font-size: 14px;
        border: 1px solid var(--border); border-radius: var(--radius);
        background: var(--surface); color: var(--text); outline: none;
      }
      .input:focus { border-color: var(--primary); }
      .form-error {
        padding: 8px 12px; border-radius: var(--radius);
        background: #fef2f2; color: var(--danger); font-size: 13px;
        border: 1px solid #fecaca;
      }
      .form-actions { display: flex; gap: 8px; padding-top: 8px; }
      .btn {
        padding: 8px 16px; font-size: 14px; font-weight: 500;
        border: 1px solid var(--border); border-radius: 6px;
        background: var(--surface); color: var(--text);
        cursor: pointer; transition: all 0.15s;
      }
      .btn:hover { border-color: var(--text-muted); }
      .btn-primary { background: var(--primary); color: #fff; border-color: var(--primary); }
      .btn-primary:hover { background: var(--primary-hover); }
    `}</style>
  );
}
