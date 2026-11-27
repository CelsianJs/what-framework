// The editor desk: which chapters readers marked, and a sign-out. Its own
// chunk, behind the sign-in guard, so a reader who is not an editor never
// downloads it.

import { onCleanup } from 'what-framework';

import { CHAPTERS } from '../chapters.js';
import { readMarks, session, stats } from '../state.js';

export default function Desk() {
  stats.deskMounts++;
  onCleanup(() => { stats.deskMounts--; });
  return (
    <section class="desk" data-desk>
      <h1>Editor desk</h1>
      <p>Signed in as <b data-desk-user>{session()?.name}</b></p>
      <table>
        <thead><tr><th>Chapter</th><th>Part</th><th>Read</th></tr></thead>
        <tbody>
          {CHAPTERS.map((c) => (
            <tr><td>{c.title}</td><td>{c.part}</td><td>{readMarks()[c.slug] ? 'yes' : '–'}</td></tr>
          ))}
        </tbody>
      </table>
      <button data-signout onClick={() => session(null)}>Sign out</button>
    </section>
  );
}
