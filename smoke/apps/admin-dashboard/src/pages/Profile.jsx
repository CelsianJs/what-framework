// Profile reads the session and theme MODULES directly.
//
// The natural thing would be useContext(Workspace), the way the topbar badge
// does it. It does not work here, and the reason is a framework defect rather
// than a choice: on the compiled path, render.js's insert() creates its
// reactive region without capturing the owning component, so anything the
// region builds on a RE-RUN gets parentCtx = null. Route pages are exactly
// that, so useContext falls through to the context default from the first
// navigation onwards and this page would render "--" forever. dom.js's
// equivalent branch captures and re-pushes the owner; render.js was never
// given the same fix. Repro and detail in the run report.

import { session } from '../state/session.js';
import { theme } from '../state/theme.js';

export default function Profile() {
  return (
    <div class="card">
      <div class="card-head"><h2>Your profile</h2></div>
      <dl class="detail-grid">
        <div>
          <dt>Name</dt>
          <dd data-profile-name>{() => session()?.name ?? '--'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd class="mono" data-profile-email>{() => session()?.email ?? '--'}</dd>
        </div>
        <div>
          <dt>Role</dt>
          <dd>{() => session()?.role ?? '--'}</dd>
        </div>
        <div>
          <dt>Theme</dt>
          <dd data-profile-theme>{() => theme()}</dd>
        </div>
      </dl>
    </div>
  );
}
