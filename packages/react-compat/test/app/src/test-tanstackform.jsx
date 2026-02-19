import React from 'react';
import { useForm } from '@tanstack/react-form';

export function TanStackFormTest() {
  const form = useForm({
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
    },
    onSubmit: async ({ value }) => {
      alert(JSON.stringify(value, null, 2));
    },
  });

  return (
    <div style={{ padding: 16, border: '1px solid #ccc', borderRadius: 8 }}>
      <h3>@tanstack/react-form</h3>
      <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 300 }}>
        <form.Field name="firstName">
          {(field) => (
            <input
              placeholder="First name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4 }}
            />
          )}
        </form.Field>
        <form.Field name="lastName">
          {(field) => (
            <input
              placeholder="Last name"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4 }}
            />
          )}
        </form.Field>
        <form.Field name="email">
          {(field) => (
            <input
              type="email"
              placeholder="Email"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              style={{ padding: '6px 12px', border: '1px solid #ddd', borderRadius: 4 }}
            />
          )}
        </form.Field>
        <button type="submit" style={{ padding: '6px 12px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>Submit</button>
      </form>
      <p style={{ marginTop: 8, color: 'green', fontWeight: 'bold' }}>PASS — @tanstack/react-form renders</p>
    </div>
  );
}
