import { createStore, derived } from 'what-framework';

const useBoardStore = createStore({
  tasks: [
    { id: '1', title: 'Design homepage layout', column: 'todo', priority: 'high', description: 'Create wireframes and mockups for the main landing page' },
    { id: '2', title: 'Set up CI/CD pipeline', column: 'todo', priority: 'medium', description: 'Configure GitHub Actions for automated testing and deployment' },
    { id: '3', title: 'Write API documentation', column: 'todo', priority: 'low', description: 'Document all REST endpoints with examples and response schemas' },
    { id: '4', title: 'Implement auth flow', column: 'in-progress', priority: 'high', description: 'OAuth2 login with Google and GitHub providers' },
    { id: '5', title: 'Build dashboard components', column: 'in-progress', priority: 'medium', description: 'Charts, stats cards, and data tables for the admin panel' },
    { id: '6', title: 'Database schema migration', column: 'done', priority: 'high', description: 'Migrate from v1 to v2 schema with zero downtime' },
    { id: '7', title: 'Unit tests for utils', column: 'done', priority: 'medium', description: 'Cover all utility functions with comprehensive test cases' },
    { id: '8', title: 'Fix mobile nav bug', column: 'done', priority: 'low', description: 'Hamburger menu not closing on route change in Safari' },
  ],

  // Derived values
  todoTasks: derived(s => s.tasks.filter(t => t.column === 'todo')),
  inProgressTasks: derived(s => s.tasks.filter(t => t.column === 'in-progress')),
  doneTasks: derived(s => s.tasks.filter(t => t.column === 'done')),
  taskCount: derived(s => s.tasks.length),

  // Actions
  addTask(task) {
    this.tasks = [...this.tasks, { ...task, id: Date.now().toString() }];
  },

  removeTask(id) {
    this.tasks = this.tasks.filter(t => t.id !== id);
  },

  moveTask(id, toColumn) {
    this.tasks = this.tasks.map(t => t.id === id ? { ...t, column: toColumn } : t);
  },

  updateTask(id, updates) {
    this.tasks = this.tasks.map(t => t.id === id ? { ...t, ...updates } : t);
  },

  setTasks(tasks) {
    this.tasks = tasks;
  },
});

export { useBoardStore };
