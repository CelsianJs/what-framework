const ROLE_COLORS = {
  Admin: { bg: '#1e1b4b', text: '#a78bfa', border: '#4c1d95' },
  Editor: { bg: '#1a2e05', text: '#86efac', border: '#166534' },
  Viewer: { bg: '#1c1917', text: '#fdba74', border: '#78350f' },
};

const STATUS_COLORS = {
  Active: '#22c55e',
  Inactive: '#ef4444',
  Pending: '#eab308',
};

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function TableRow({ user }) {
  const role = ROLE_COLORS[user.role] || ROLE_COLORS.Viewer;
  const statusColor = STATUS_COLORS[user.status] || '#888';

  return (
    <tr
      style="transition: background 0.15s; border-bottom: 1px solid #1a1a1a;"
      onMouseEnter={(e) => { e.currentTarget.style.background = '#111'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <td style="padding: 0.75rem 1rem; font-size: 0.875rem; color: #888; font-variant-numeric: tabular-nums;">
        {user.id}
      </td>
      <td style="padding: 0.75rem 1rem;">
        <div style="display: flex; flex-direction: column; gap: 0.125rem;">
          <span style="font-size: 0.875rem; font-weight: 500; color: #e5e5e5;">{user.name}</span>
          <span style="font-size: 0.75rem; color: #666;">{user.email}</span>
        </div>
      </td>
      <td style="padding: 0.75rem 1rem;">
        <span style={`display: inline-block; padding: 0.25rem 0.625rem; border-radius: 9999px; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.02em; background: ${role.bg}; color: ${role.text}; border: 1px solid ${role.border};`}>
          {user.role}
        </span>
      </td>
      <td style="padding: 0.75rem 1rem;">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span style={`display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${statusColor}; box-shadow: 0 0 6px ${statusColor}40;`}></span>
          <span style="font-size: 0.8125rem; color: #ccc;">{user.status}</span>
        </div>
      </td>
      <td style="padding: 0.75rem 1rem; font-size: 0.8125rem; color: #999;">
        {formatDate(user.joinDate)}
      </td>
      <td style="padding: 0.75rem 1rem; font-size: 0.8125rem; color: #999;">
        {formatDate(user.lastActive)}
      </td>
    </tr>
  );
}
