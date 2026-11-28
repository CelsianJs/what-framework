// The visitor's workspace state: who is signed in, the wizard's draft, and
// the projects. On a server one module serves every request at once, so none
// of this can live at module scope: App creates it for each render from what
// the loader read (the request's cookies, the database), and the pages reach
// it through context. In the browser the same state writes itself back to
// the cookies, so the next server render (a reload) sees it.

import { createContext, effect, signal, useContext } from 'what-framework';
import { DRAFT_COOKIE, EMPTY_DRAFT, USER_COOKIE, writeCookie } from './data.js';

export const Workspace = createContext(null);
export const useWorkspace = () => useContext(Workspace);

export function createWorkspace({ user, draft, projects }) {
  const session = signal(user);
  const current = signal({ ...EMPTY_DRAFT, ...draft });
  const list = signal(projects);

  if (typeof document !== 'undefined') {
    effect(() => writeCookie(USER_COOKIE, session()));
    effect(() => writeCookie(DRAFT_COOKIE, current()));
  }

  return {
    session,
    signIn: (name) => session.set({ name: String(name).trim() }),
    signOut: () => session.set(null),
    draft: current,
    updateDraft: (patch) => current.set((d) => ({ ...d, ...patch })),
    resetDraft: () => current.set({ ...EMPTY_DRAFT }),
    projects: list,
    addProject: (p) => list.set((all) => [...all, p]),
  };
}

export const detailsDone = (d) => d.name.trim().length >= 3 && !!d.owner;
export const teamDone = (d) => d.members.length > 0;
