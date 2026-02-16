import { useSignal, useLocalStorage, useContext } from 'what-framework';
import { ThemeContext } from './context/ThemeContext';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';

function createDefaultNote() {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    title: 'Untitled',
    content: '',
    updatedAt: new Date().toISOString(),
  };
}

function extractTitle(content) {
  if (!content) return 'Untitled';
  // Try to extract a heading
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch) return headingMatch[1].trim();
  // Otherwise use first non-empty line
  const firstLine = content.split('\n').find(l => l.trim());
  if (firstLine) {
    const cleaned = firstLine.replace(/[#*`\[\]()-]/g, '').trim();
    return cleaned.length > 50 ? cleaned.slice(0, 50) + '...' : cleaned || 'Untitled';
  }
  return 'Untitled';
}

function AppContent() {
  const theme = useContext(ThemeContext);
  const notes = useLocalStorage('markdown-notes-data', []);
  const activeNoteId = useSignal(null);

  // Initialize with a note if empty
  if (notes().length === 0) {
    const welcomeNote = {
      id: 'welcome',
      title: 'Welcome',
      content: `# Welcome to Markdown Notes

This is your first note. Start typing to see the **live preview** on the right.

## Features

- **Bold text** with double asterisks
- *Italic text* with single asterisks
- \`Inline code\` with backticks
- [Links](https://example.com) in Markdown format

## Code Blocks

\`\`\`
function hello() {
  console.log("Hello, World!");
}
\`\`\`

- Easy to use
- Dark theme
- Auto-saves to local storage

Happy writing!`,
      updatedAt: new Date().toISOString(),
    };
    notes([welcomeNote]);
    activeNoteId('welcome');
  } else if (!activeNoteId()) {
    activeNoteId(notes()[0].id);
  }

  const activeNote = () => {
    const id = activeNoteId();
    if (!id) return null;
    return notes().find(n => n.id === id) || null;
  };

  const handleNewNote = () => {
    const newNote = createDefaultNote();
    notes([newNote, ...notes()]);
    activeNoteId(newNote.id);
  };

  const handleSelectNote = (id) => {
    activeNoteId(id);
  };

  const handleDeleteNote = (id) => {
    const updated = notes().filter(n => n.id !== id);
    notes(updated);
    if (activeNoteId() === id) {
      activeNoteId(updated.length > 0 ? updated[0].id : null);
    }
  };

  const handleUpdateContent = (content) => {
    const id = activeNoteId();
    if (!id) return;
    const updated = notes().map(n => {
      if (n.id === id) {
        return {
          ...n,
          content,
          title: extractTitle(content),
          updatedAt: new Date().toISOString(),
        };
      }
      return n;
    });
    notes(updated);
  };

  return (
    <div style="display: flex; height: calc(100vh - 4rem); background: #0a0a0a; border: 1px solid #1a1a1a; border-radius: 0.75rem; overflow: hidden;">
      <Sidebar
        notes={notes}
        activeId={activeNoteId}
        onSelect={handleSelectNote}
        onNew={handleNewNote}
        onDelete={handleDeleteNote}
      />

      <div style="flex: 1; display: flex; min-width: 0;">
        <Editor
          note={activeNote}
          onUpdate={handleUpdateContent}
        />
        <Preview
          note={activeNote}
        />
      </div>
    </div>
  );
}

export function App() {
  return (
    <ThemeContext.Provider value="dark">
      <header style="margin-bottom: 1.5rem;">
        <h1 style="font-size: 1.5rem; font-weight: 700; color: #f5f5f5; letter-spacing: -0.025em;">
          Markdown Notes
        </h1>
        <p style="color: #555; font-size: 0.8125rem; margin-top: 0.25rem;">
          Write in Markdown, preview in real-time
        </p>
      </header>

      <AppContent />
    </ThemeContext.Provider>
  );
}
