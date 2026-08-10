// Team roster.

import { TEAM } from '../data.js';

export default function Team() {
  return (
    <div class="card">
      <div class="card-head"><h2>Team</h2></div>
      <table>
        <thead>
          <tr><th>Member</th><th>Role</th><th>Last seen</th></tr>
        </thead>
        <tbody data-team-body>
          {TEAM.map((m) => (
            <tr key={m.id} data-member={m.id}>
              <td>
                <div>{m.name}</div>
                <div class="muted mono">{m.email}</div>
              </td>
              <td>{m.role}</td>
              <td class="muted">{m.lastSeen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
