import { useSignal, useComputed } from 'what-framework';
import { useBoardStore } from '../store/board';
import { TaskCard } from './TaskCard';
import { AddTaskInput } from './AddTaskInput';

export function Column({ id, title, color, search }) {
  const store = useBoardStore();
  const isDragOver = useSignal(false);

  const columnTasks = useComputed(() => {
    if (id === 'todo') return store.todoTasks;
    if (id === 'in-progress') return store.inProgressTasks;
    if (id === 'done') return store.doneTasks;
    return [];
  });

  const filteredTasks = useComputed(() => {
    const q = search().toLowerCase().trim();
    const tasks = columnTasks();
    if (!q) return tasks;
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q)
    );
  });

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    isDragOver(true);
  };

  const handleDragLeave = (e) => {
    // Only trigger when leaving the column itself, not child elements
    if (e.currentTarget.contains(e.relatedTarget)) return;
    isDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    isDragOver(false);
    const taskId = e.dataTransfer.getData('text/plain');
    if (taskId) {
      store.moveTask(taskId, id);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={`
        background: ${isDragOver() ? '#1a1a2e' : '#111118'};
        border: 2px solid ${isDragOver() ? color : '#1e1e2e'};
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        transition: border-color 0.2s, background 0.2s;
        min-height: 300px;
      `}
    >
      {/* Column Header */}
      <div style={`
        padding: 1rem 1.25rem;
        border-bottom: 1px solid #1e1e2e;
        display: flex;
        align-items: center;
        justify-content: space-between;
      `}>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <div style={`
            width: 10px;
            height: 10px;
            border-radius: 50%;
            background: ${color};
          `} />
          <h2 style="font-size: 0.9375rem; font-weight: 600; color: #fff;">
            {title}
          </h2>
        </div>
        <span style={`
          background: ${color}20;
          color: ${color};
          font-size: 0.75rem;
          font-weight: 600;
          padding: 0.125rem 0.5rem;
          border-radius: 9999px;
          min-width: 1.5rem;
          text-align: center;
        `}>
          {() => filteredTasks().length}
        </span>
      </div>

      {/* Task List */}
      <div style="padding: 0.75rem; flex: 1; display: flex; flex-direction: column; gap: 0.5rem; overflow-y: auto;">
        {() => filteredTasks().map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
        {() => filteredTasks().length === 0 && search().trim() ? (
          <div style="color: #525252; font-size: 0.8125rem; text-align: center; padding: 2rem 1rem;">
            No matching tasks
          </div>
        ) : null}
      </div>

      {/* Add Task Input */}
      <div style="padding: 0.75rem; border-top: 1px solid #1e1e2e;">
        <AddTaskInput columnId={id} />
      </div>
    </div>
  );
}
