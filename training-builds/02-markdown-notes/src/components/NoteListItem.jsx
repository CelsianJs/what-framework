import { memo, cls } from 'what-framework';

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncate(text, len) {
  if (!text) return 'Empty note';
  const firstLine = text.split('\n').find(l => l.trim() && !l.startsWith('#')) || text.split('\n')[0] || '';
  const cleaned = firstLine.replace(/[#*`\[\]()-]/g, '').trim();
  if (!cleaned) return 'Empty note';
  return cleaned.length > len ? cleaned.slice(0, len) + '...' : cleaned;
}

const NoteListItem = memo(function NoteListItem({ note, isActive, onSelect, onDelete }) {
  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete();
  };

  return (
    <div
      onClick={onSelect}
      style={`
        padding: 0.75rem 1rem;
        cursor: pointer;
        border-radius: 0.5rem;
        transition: all 0.15s;
        border: 1px solid ${isActive ? '#3b82f644' : 'transparent'};
        background: ${isActive ? '#3b82f611' : 'transparent'};
        margin-bottom: 0.25rem;
        position: relative;
      `}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = '#ffffff08';
        const btn = e.currentTarget.querySelector('.delete-btn');
        if (btn) btn.style.opacity = '1';
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = 'transparent';
        const btn = e.currentTarget.querySelector('.delete-btn');
        if (btn) btn.style.opacity = '0';
      }}
    >
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style={`font-size: 0.875rem; font-weight: 500; color: ${isActive ? '#f5f5f5' : '#ccc'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0;`}>
          {note.title || 'Untitled'}
        </div>
        <button
          class="delete-btn"
          onClick={handleDelete}
          style="opacity: 0; padding: 0.125rem 0.375rem; background: transparent; border: 1px solid #333; border-radius: 0.25rem; color: #666; font-size: 0.625rem; cursor: pointer; transition: all 0.15s; flex-shrink: 0; margin-left: 0.5rem;"
          onMouseEnter={(e) => { e.target.style.borderColor = '#ef4444'; e.target.style.color = '#ef4444'; }}
          onMouseLeave={(e) => { e.target.style.borderColor = '#333'; e.target.style.color = '#666'; }}
          title="Delete note"
        >
          x
        </button>
      </div>
      <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.25rem;">
        <span style="font-size: 0.75rem; color: #555; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;">
          {truncate(note.content, 40)}
        </span>
        <span style="font-size: 0.6875rem; color: #444; white-space: nowrap; margin-left: 0.5rem;">
          {formatDate(note.updatedAt)}
        </span>
      </div>
    </div>
  );
});

export { NoteListItem };
