import { useSignal, useRef, useClickOutside, untrack } from 'what-framework';

export function InlineEditor({ task, onSave, onCancel }) {
  const editorRef = useRef(null);

  // Initialize with current task data using untrack to avoid subscribing
  const title = useSignal(untrack(() => task.title));
  const description = useSignal(untrack(() => task.description));
  const priority = useSignal(untrack(() => task.priority));

  const save = () => {
    const t = untrack(() => title()).trim();
    if (!t) {
      onCancel();
      return;
    }
    onSave({
      title: t,
      description: untrack(() => description()),
      priority: untrack(() => priority()),
    });
  };

  useClickOutside(editorRef, () => {
    save();
  });

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div
      ref={editorRef}
      style="
        background: #1a1a2e;
        border: 2px solid #6366f1;
        border-radius: 8px;
        padding: 0.875rem;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      "
      onclick={(e) => e.stopPropagation()}
    >
      {/* Title Input */}
      <input
        type="text"
        value={title()}
        oninput={(e) => title(e.target.value)}
        onkeydown={handleKeyDown}
        placeholder="Task title"
        style="
          background: #111118;
          border: 1px solid #2a2a3e;
          border-radius: 6px;
          padding: 0.5rem 0.625rem;
          color: #e5e5e5;
          font-size: 0.875rem;
          font-weight: 500;
          outline: none;
          width: 100%;
          transition: border-color 0.15s;
        "
        onfocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
        onblur={(e) => { e.target.style.borderColor = '#2a2a3e'; }}
      />

      {/* Description Textarea */}
      <textarea
        value={description()}
        oninput={(e) => description(e.target.value)}
        onkeydown={handleKeyDown}
        placeholder="Description (optional)"
        rows="2"
        style="
          background: #111118;
          border: 1px solid #2a2a3e;
          border-radius: 6px;
          padding: 0.5rem 0.625rem;
          color: #e5e5e5;
          font-size: 0.8125rem;
          outline: none;
          resize: vertical;
          width: 100%;
          min-height: 3rem;
          transition: border-color 0.15s;
          font-family: inherit;
        "
        onfocus={(e) => { e.target.style.borderColor = '#6366f1'; }}
        onblur={(e) => { e.target.style.borderColor = '#2a2a3e'; }}
      />

      {/* Priority Select & Actions */}
      <div style="display: flex; align-items: center; gap: 0.5rem;">
        <select
          value={priority()}
          onchange={(e) => priority(e.target.value)}
          style="
            background: #111118;
            border: 1px solid #2a2a3e;
            border-radius: 6px;
            padding: 0.375rem 0.5rem;
            color: #e5e5e5;
            font-size: 0.8125rem;
            outline: none;
            flex: 1;
            cursor: pointer;
          "
        >
          <option value="low">Low Priority</option>
          <option value="medium">Medium Priority</option>
          <option value="high">High Priority</option>
        </select>

        <button
          onclick={save}
          style="
            background: #6366f1;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 0.375rem 0.75rem;
            font-size: 0.8125rem;
            font-weight: 500;
            transition: background 0.15s;
          "
          onmouseenter={(e) => { e.currentTarget.style.background = '#4f46e5'; }}
          onmouseleave={(e) => { e.currentTarget.style.background = '#6366f1'; }}
        >
          Save
        </button>
        <button
          onclick={onCancel}
          style="
            background: transparent;
            color: #737373;
            border: 1px solid #2a2a3e;
            border-radius: 6px;
            padding: 0.375rem 0.75rem;
            font-size: 0.8125rem;
            transition: color 0.15s, border-color 0.15s;
          "
          onmouseenter={(e) => {
            e.currentTarget.style.color = '#e5e5e5';
            e.currentTarget.style.borderColor = '#3a3a4e';
          }}
          onmouseleave={(e) => {
            e.currentTarget.style.color = '#737373';
            e.currentTarget.style.borderColor = '#2a2a3e';
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
