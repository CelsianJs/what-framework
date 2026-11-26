// The new-project wizard's draft. It lives in sessionStorage, so a reload in
// the middle of the wizard comes back to the same step with the same answers,
// and back/forward between steps finds what was entered.

import { createStore, effect } from 'what-framework';

const KEY = 'atlas:draft';
const EMPTY = { name: '', kind: 'launch', owner: '', members: [], notes: '' };
const read = () => { try { return { ...EMPTY, ...JSON.parse(sessionStorage.getItem(KEY)) }; } catch { return { ...EMPTY }; } };

export const useDraft = createStore({
  draft: read(),
  update(patch) {
    this.draft = { ...this.draft, ...patch };
  },
  reset() {
    this.draft = { ...EMPTY };
  },
});

effect(() => {
  sessionStorage.setItem(KEY, JSON.stringify(useDraft().draft));
});

export const detailsDone = (d) => d.name.trim().length >= 3 && !!d.owner;
export const teamDone = (d) => d.members.length > 0;
