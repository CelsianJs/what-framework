// CRUD API for tasks — auto-discovered by ThenJS file-based routing
// GET /api/tasks, POST /api/tasks

interface Task {
  id: string;
  title: string;
  status: 'todo' | 'in-progress' | 'done';
  priority: 'low' | 'medium' | 'high';
  createdAt: number;
}

// In-memory store (shared across requests in dev)
const tasks = new Map<string, Task>([
  ['1', { id: '1', title: 'Set up ThenJS project', status: 'done', priority: 'high', createdAt: Date.now() - 7200000 }],
  ['2', { id: '2', title: 'Build dashboard page', status: 'done', priority: 'high', createdAt: Date.now() - 5400000 }],
  ['3', { id: '3', title: 'Add RPC procedures', status: 'in-progress', priority: 'medium', createdAt: Date.now() - 3600000 }],
  ['4', { id: '4', title: 'Connect SSE live updates', status: 'in-progress', priority: 'medium', createdAt: Date.now() - 1800000 }],
  ['5', { id: '5', title: 'Deploy to production', status: 'todo', priority: 'high', createdAt: Date.now() - 900000 }],
  ['6', { id: '6', title: 'Write documentation', status: 'todo', priority: 'low', createdAt: Date.now() }],
]);

export function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');

  let items = Array.from(tasks.values());
  if (status) items = items.filter(t => t.status === status);

  items.sort((a, b) => b.createdAt - a.createdAt);

  return Response.json({ tasks: items, total: items.length });
}

export async function POST(request: Request) {
  const body = await request.json();
  const { title, priority = 'medium' } = body;

  if (!title || typeof title !== 'string') {
    return Response.json({ error: 'title is required' }, { status: 400 });
  }

  const task: Task = {
    id: crypto.randomUUID(),
    title,
    status: 'todo',
    priority,
    createdAt: Date.now(),
  };

  tasks.set(task.id, task);
  return Response.json(task, { status: 201 });
}

export async function PUT(request: Request) {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  if (!id || !tasks.has(id)) {
    return Response.json({ error: 'Task not found' }, { status: 404 });
  }

  const body = await request.json();
  const task = tasks.get(id)!;

  if (body.title) task.title = body.title;
  if (body.status) task.status = body.status;
  if (body.priority) task.priority = body.priority;

  return Response.json(task);
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const id = url.pathname.split('/').pop();

  if (!id || !tasks.has(id)) {
    return Response.json({ error: 'Task not found' }, { status: 404 });
  }

  tasks.delete(id);
  return new Response(null, { status: 204 });
}
