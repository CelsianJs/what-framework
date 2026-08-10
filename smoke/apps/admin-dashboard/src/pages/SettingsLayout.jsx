// The nested layout.
//
// Attached with nestedRoutes('/settings', [...], { layout: SettingsLayout }), so
// the router wraps every /settings/* page in it and hands the page over as
// props.children. It sits INSIDE the shell's outlet: the DOM nesting the smoke
// check asserts is [data-shell] > [data-outlet] > [data-settings] > the page.

import { Link } from 'what-router';

export function SettingsLayout(props) {
  return (
    <div data-settings>
      <div class="page-head">
        <div>
          <h1>Settings</h1>
          <p>Workspace configuration for Northwind Ops.</p>
        </div>
      </div>

      <div class="settings-layout">
        <nav class="settings-nav">
          <Link href="/settings/profile" prefetch={false} data-settings-nav="profile">Profile</Link>
          <Link href="/settings/team" prefetch={false} data-settings-nav="team">Team</Link>
        </nav>
        <div data-settings-page>{props.children}</div>
      </div>
    </div>
  );
}
