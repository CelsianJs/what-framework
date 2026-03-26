// TodoItem — Individual todo component
// Demonstrates: useSignal, useEffect, useRef, event handling,
// conditional rendering, CSS class toggling, double-click to edit

import { useSignal, useRef, useEffect } from 'what-framework';

export function TodoItem({ todo, onToggle, onDestroy, onEdit }) {
  const editing = useSignal(false);
  const editText = useSignal(todo.title);
  const editRef = useRef(null);

  // Focus the edit input when entering edit mode
  useEffect(() => {
    if (editing() && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(
        editRef.current.value.length,
        editRef.current.value.length
      );
    }
  });

  function handleEdit() {
    editing.set(true);
    editText.set(todo.title);
  }

  function handleSubmit() {
    const val = editText().trim();
    if (val) {
      onEdit(todo.id, val);
      editing.set(false);
    } else {
      onDestroy(todo.id);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      editText.set(todo.title);
      editing.set(false);
    } else if (e.key === 'Enter') {
      handleSubmit();
    }
  }

  return (
    <li class={() => {
      const classes = [];
      if (todo.completed) classes.push('completed');
      if (editing()) classes.push('editing');
      return classes.join(' ');
    }}>
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={todo.completed}
          onChange={() => onToggle(todo.id)}
        />
        <label onDblClick={handleEdit}>{todo.title}</label>
        <button class="destroy" onClick={() => onDestroy(todo.id)} />
      </div>
      {() => editing() ? (
        <input
          ref={editRef}
          class="edit"
          value={editText()}
          onInput={(e) => editText.set(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
        />
      ) : null}
    </li>
  );
}
