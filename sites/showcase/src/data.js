// Mock data layer — simulates API calls

export const PEOPLE = [
  { id: 1, name: 'Elena Vasquez', role: 'Lead Engineer', status: 'online', avatar: '#8b5cf6', initials: 'EV' },
  { id: 2, name: 'Marcus Chen', role: 'Product Designer', status: 'online', avatar: '#06b6d4', initials: 'MC' },
  { id: 3, name: 'Ava Patel', role: 'Frontend Developer', status: 'away', avatar: '#ec4899', initials: 'AP' },
  { id: 4, name: 'Liam O\'Brien', role: 'Backend Engineer', status: 'online', avatar: '#f59e0b', initials: 'LO' },
  { id: 5, name: 'Zara Kim', role: 'UX Researcher', status: 'offline', avatar: '#22c55e', initials: 'ZK' },
  { id: 6, name: 'Noah Rivera', role: 'DevOps Engineer', status: 'online', avatar: '#ef4444', initials: 'NR' },
  { id: 7, name: 'Iris Tanaka', role: 'Data Scientist', status: 'away', avatar: '#3b82f6', initials: 'IT' },
  { id: 8, name: 'Kai Johansson', role: 'Mobile Developer', status: 'online', avatar: '#a855f7', initials: 'KJ' },
  { id: 9, name: 'Sofia Dubois', role: 'Product Manager', status: 'online', avatar: '#14b8a6', initials: 'SD' },
  { id: 10, name: 'Ravi Sharma', role: 'QA Engineer', status: 'offline', avatar: '#f97316', initials: 'RS' },
  { id: 11, name: 'Maya Johnson', role: 'Security Engineer', status: 'online', avatar: '#06b6d4', initials: 'MJ' },
  { id: 12, name: 'Ethan Park', role: 'Staff Engineer', status: 'away', avatar: '#8b5cf6', initials: 'EP' },
];

export const PROJECTS = [
  { id: 'p1', name: 'Flux Dashboard', color: '#8b5cf6' },
  { id: 'p2', name: 'Mobile App', color: '#06b6d4' },
  { id: 'p3', name: 'API v3', color: '#22c55e' },
];

export const TASKS = [
  { id: 't1', title: 'Implement dark mode toggle', status: 'done', tag: 'feature', assignee: 1, project: 'p1', priority: 'high' },
  { id: 't2', title: 'Fix navigation overflow on mobile', status: 'done', tag: 'bug', assignee: 3, project: 'p1', priority: 'medium' },
  { id: 't3', title: 'Design onboarding flow', status: 'review', tag: 'design', assignee: 2, project: 'p2', priority: 'high' },
  { id: 't4', title: 'Add keyboard shortcuts', status: 'review', tag: 'feature', assignee: 1, project: 'p1', priority: 'medium' },
  { id: 't5', title: 'Migrate to new auth provider', status: 'progress', tag: 'chore', assignee: 4, project: 'p3', priority: 'high' },
  { id: 't6', title: 'Optimize query performance', status: 'progress', tag: 'feature', assignee: 6, project: 'p3', priority: 'medium' },
  { id: 't7', title: 'Implement infinite scroll', status: 'progress', tag: 'feature', assignee: 3, project: 'p1', priority: 'low' },
  { id: 't8', title: 'Update design tokens', status: 'todo', tag: 'design', assignee: 2, project: 'p2', priority: 'low' },
  { id: 't9', title: 'Write integration tests', status: 'todo', tag: 'chore', assignee: 10, project: 'p3', priority: 'medium' },
  { id: 't10', title: 'Implement WebSocket layer', status: 'todo', tag: 'feature', assignee: 4, project: 'p3', priority: 'high' },
  { id: 't11', title: 'Add analytics dashboard', status: 'todo', tag: 'feature', assignee: 7, project: 'p1', priority: 'medium' },
  { id: 't12', title: 'Redesign settings page', status: 'todo', tag: 'design', assignee: 2, project: 'p2', priority: 'low' },
];

export const ACTIVITY = [
  { id: 'a1', user: 'Elena', action: 'completed', target: 'Implement dark mode toggle', time: '2m ago', color: 'green' },
  { id: 'a2', user: 'Marcus', action: 'commented on', target: 'Design onboarding flow', time: '15m ago', color: 'blue' },
  { id: 'a3', user: 'Ava', action: 'moved', target: 'Fix nav overflow', extra: 'to Done', time: '1h ago', color: 'purple' },
  { id: 'a4', user: 'Liam', action: 'created', target: 'Migrate auth provider', time: '2h ago', color: 'yellow' },
  { id: 'a5', user: 'Noah', action: 'deployed', target: 'API v3.2.1', extra: 'to production', time: '3h ago', color: 'green' },
  { id: 'a6', user: 'Zara', action: 'shared', target: 'User research findings Q4', time: '5h ago', color: 'blue' },
  { id: 'a7', user: 'Sofia', action: 'updated', target: 'Sprint 24 goals', time: '6h ago', color: 'purple' },
];

export const CHART_DATA = {
  week: [
    { label: 'Mon', value: 12 },
    { label: 'Tue', value: 19 },
    { label: 'Wed', value: 8 },
    { label: 'Thu', value: 25 },
    { label: 'Fri', value: 17 },
    { label: 'Sat', value: 6 },
    { label: 'Sun', value: 3 },
  ],
  month: [
    { label: 'W1', value: 42 },
    { label: 'W2', value: 56 },
    { label: 'W3', value: 38 },
    { label: 'W4', value: 71 },
  ],
  quarter: [
    { label: 'Jan', value: 120 },
    { label: 'Feb', value: 145 },
    { label: 'Mar', value: 98 },
  ],
};

// Simulated API fetchers with realistic delays
export function fetchStats() {
  return new Promise(resolve => {
    setTimeout(() => resolve({
      tasksCompleted: 147,
      activeProjects: 12,
      teamMembers: 24,
      velocity: 89,
    }), 800);
  });
}

export function fetchPeople(query = '') {
  return new Promise(resolve => {
    setTimeout(() => {
      const q = query.toLowerCase();
      const results = q
        ? PEOPLE.filter(p => p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q))
        : PEOPLE;
      resolve(results);
    }, 600);
  });
}

export function fetchActivity() {
  return new Promise(resolve => {
    setTimeout(() => resolve(ACTIVITY), 500);
  });
}

export function fetchTasks() {
  return new Promise(resolve => {
    setTimeout(() => resolve(TASKS), 700);
  });
}
