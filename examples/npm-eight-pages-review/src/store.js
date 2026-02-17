import { createStore, derived } from 'what-framework';

export const useTeamStore = createStore({
  people: [
    { id: 1, name: 'Ada', online: true },
    { id: 2, name: 'Linus', online: false },
    { id: 3, name: 'Ken', online: true },
  ],
  filter: 'all',

  visible: derived((state) => {
    if (state.filter === 'online') {
      return state.people.filter((person) => person.online);
    }
    if (state.filter === 'offline') {
      return state.people.filter((person) => !person.online);
    }
    return state.people;
  }),

  total: derived((state) => state.people.length),
  onlineCount: derived((state) => state.people.filter((person) => person.online).length),

  add(name) {
    const nextName = String(name || '').trim();
    if (!nextName) return;

    const nextId = this.people.reduce((max, person) => Math.max(max, person.id), 0) + 1;
    this.people = [...this.people, { id: nextId, name: nextName, online: false }];
  },

  toggle(id) {
    this.people = this.people.map((person) => {
      if (person.id !== id) return person;
      return { ...person, online: !person.online };
    });
  },

  setFilter(nextFilter) {
    this.filter = nextFilter;
  },
});
