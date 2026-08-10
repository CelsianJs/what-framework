// One context carries everything the shell needs: who is signed in, the theme
// and the way to change it, and the workspace label.
//
// The value is an object of ACCESSORS, not a snapshot. Provider destructures
// `value` once (components run once), so a plain string would freeze at the
// value it had when the provider first ran. Handing over functions keeps every
// consumer reactive no matter how deep it sits.

import { createContext } from 'what-framework';

export const Workspace = createContext({
  user: () => null,
  theme: () => 'night',
  toggleTheme: () => {},
  label: () => 'no workspace',
});
