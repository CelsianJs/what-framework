import { useSignal } from 'what-framework';
import { NoteListItem } from './NoteListItem';

export function Sidebar({ notes, activeId, onSelect, onNew, onDelete }) {
  const searchQuery = useSignal('');

  const filteredNotes = () => {
    const q = searchQuery().toLowerCase().trim();
    const all = notes();
    if (!q) return all;
    return all.filter(note =>
      note.title.toLowerCase().includes(q) ||
      note.content.toLowerCase().includes(q)
    );
  };

  return (
    <div style="width: 280px; min-width: 280px; background: #0f0f0f; border-right: 1px solid #1a1a1a; display: flex; flex-direction: column; height: 100%;">
      {/* Header */}
      <div style="padding: 1.25rem 1rem 0.75rem;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem;">
          <h2 style="font-size: 1rem; font-weight: 600; color: #f5f5f5; letter-spacing: -0.01em;">
            Notes
          </h2>
          <button
            onclick={onNew}
            style="padding: 0.375rem 0.75rem; background: #3b82f6; color: white; border: none; border-radius: 0.375rem; font-size: 0.75rem; font-weight: 500; cursor: pointer; transition: background 0.2s;"
            onmouseenter={(e) => { e.target.style.background = '#2563eb'; }}
            onmouseleave={(e) => { e.target.style.background = '#3b82f6'; }}
          >
            + New
          </button>
        </div>

        <input
          type="text"
          placeholder="Search notes..."
          value={searchQuery()}
          oninput={(e) => searchQuery(e.target.value)}
          style="width: 100%; padding: 0.5rem 0.75rem; background: #1a1a1a; border: 1px solid #282828; border-radius: 0.375rem; color: #e5e5e5; font-size: 0.8125rem; outline: none; transition: border-color 0.2s;"
          onfocus={(e) => { e.target.style.borderColor = '#444'; }}
          onblur={(e) => { e.target.style.borderColor = '#282828'; }}
        />
      </div>

      {/* Notes List */}
      <div style="flex: 1; overflow-y: auto; padding: 0.5rem 0.5rem;">
        {() => {
          const filtered = filteredNotes();
          const currentId = activeId();

          if (filtered.length === 0) {
            const hasQuery = searchQuery().trim().length > 0;
            return (
              <div style="text-align: center; padding: 2rem 1rem; color: #444;">
                <p style="font-size: 0.8125rem;">
                  {hasQuery ? 'No notes match your search.' : 'No notes yet.'}
                </p>
              </div>
            );
          }

          return filtered.map(note => (
            <NoteListItem
              key={note.id}
              note={note}
              isActive={note.id === currentId}
              onSelect={() => onSelect(note.id)}
              onDelete={() => onDelete(note.id)}
            />
          ));
        }}
      </div>

      {/* Footer: note count */}
      <div style="padding: 0.75rem 1rem; border-top: 1px solid #1a1a1a; font-size: 0.6875rem; color: #444;">
        {() => {
          const count = notes().length;
          return `${count} note${count !== 1 ? 's' : ''}`;
        }}
      </div>
    </div>
  );
}
