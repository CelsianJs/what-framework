import { useSignal, cls } from 'what-framework';
import { useBoardStore } from '../store/board';
import { InlineEditor } from './InlineEditor';

const priorityColors = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#22c55e',
};

export function TaskCard({ task }) {
  const store = useBoardStore();
  const isEditing = useSignal(false);
  const isDragging = useSignal(false);

  const priorityLabel = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);

  const priorityColor = priorityColors[task.priority] || '#737373';

  const handleDragStart = (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    isDragging(true);
    // Add a slight delay so the drag image shows properly
    requestAnimationFrame(() => {
      if (e.target && e.target.style) {
        e.target.style.opacity = '0.5';
      }
    });
  };

  const handleDragEnd = (e) => {
    isDragging(false);
    if (e.target && e.target.style) {
      e.target.style.opacity = '1';
    }
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    store.removeTask(task.id);
  };

  const handleClick = () => {
    isEditing(true);
  };

  const handleSave = (updates) => {
    store.updateTask(task.id, updates);
    isEditing(false);
  };

  const handleCancel = () => {
    isEditing(false);
  };

  if (isEditing()) {
    return (
      <InlineEditor
        task={task}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <div
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      class={cls(
        'task-card',
        isDragging() && 'task-card--dragging'
      )}
      style={`
        background: #16161e;
        border: 1px solid #2a2a3e;
        border-radius: 8px;
        padding: 0.875rem;
        cursor: grab;
        transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
        position: relative;
        user-select: none;
        opacity: ${isDragging() ? '0.5' : '1'};
      `}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = '#3a3a4e';
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = '#2a2a3e';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Delete Button */}
      <button
        onClick={handleDelete}
        style="
          position: absolute;
          top: 0.5rem;
          right: 0.5rem;
          background: none;
          border: none;
          color: #525252;
          font-size: 0.875rem;
          width: 1.5rem;
          height: 1.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: color 0.15s, background 0.15s;
          line-height: 1;
        "
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#ef4444';
          e.currentTarget.style.background = '#ef444420';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = '#525252';
          e.currentTarget.style.background = 'none';
        }}
        title="Delete task"
      >
        &times;
      </button>

      {/* Title */}
      <div style="font-size: 0.875rem; font-weight: 500; color: #e5e5e5; margin-bottom: 0.375rem; padding-right: 1.25rem;">
        {task.title}
      </div>

      {/* Description preview */}
      <div style="font-size: 0.75rem; color: #737373; margin-bottom: 0.625rem; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
        {task.description}
      </div>

      {/* Priority Badge */}
      <span style={`
        display: inline-block;
        font-size: 0.6875rem;
        font-weight: 600;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        background: ${priorityColor}18;
        color: ${priorityColor};
        border: 1px solid ${priorityColor}30;
        text-transform: uppercase;
        letter-spacing: 0.025em;
      `}>
        {priorityLabel}
      </span>
    </div>
  );
}
