import { useSignal } from 'what-framework';
import { useBoardStore } from '../store/board';

export function AddTaskInput({ columnId }) {
  const store = useBoardStore();
  const value = useSignal('');

  const handleSubmit = (e) => {
    if (e.key !== 'Enter') return;
    const title = value().trim();
    if (!title) return;

    store.addTask({
      title,
      column: columnId,
      priority: 'medium',
      description: '',
    });

    value('');
  };

  return (
    <input
      type="text"
      placeholder="+ Add a task..."
      value={value()}
      oninput={(e) => value(e.target.value)}
      onkeydown={handleSubmit}
      style="
        width: 100%;
        background: transparent;
        border: 1px dashed #2a2a3e;
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        color: #737373;
        font-size: 0.8125rem;
        outline: none;
        transition: border-color 0.15s, color 0.15s;
      "
      onfocus={(e) => {
        e.target.style.borderColor = '#3a3a4e';
        e.target.style.color = '#e5e5e5';
      }}
      onblur={(e) => {
        e.target.style.borderColor = '#2a2a3e';
        e.target.style.color = '#737373';
      }}
    />
  );
}
