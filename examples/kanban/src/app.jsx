// What Kanban — multi-board kanban with HTML5 drag-and-drop,
// what-router routes, and localStorage persistence.

import {
  mount,
  useSignal, useEffect, useRef,
  cls,
} from 'what-framework';
import { Router, Link, navigate, route } from 'what-router';

import { useKanban } from './store.js';

// --- Drag state (module-scope, intentional) -----------------
// Single-pointer DnD: we only ever track one drag at a time, and the
// payload is read inside `drop` handlers — so a plain module-level object
// is simpler (and faster) than threading dataTransfer through every node.

const drag = {
  cardId: null,
  fromColumnId: null,
  boardId: null,
};

function startDrag(boardId, columnId, cardId) {
  drag.cardId = cardId;
  drag.fromColumnId = columnId;
  drag.boardId = boardId;
}

function endDrag() {
  drag.cardId = null;
  drag.fromColumnId = null;
  drag.boardId = null;
}

// --- Card -------------------------------------------------

function Card({ card, columnId, boardId, index }) {
  const editing = useSignal(false);
  const title = useSignal(card.title);
  const store = useKanban();
  const dragging = useSignal(false);
  const dragOverPos = useSignal(null); // 'before' | 'after' | null

  // Keep local edit buffer in sync if card was renamed elsewhere.
  if (title() !== card.title && !editing()) {
    title.set(card.title);
  }

  const commitEdit = () => {
    const t = title().trim();
    if (t && t !== card.title) {
      store.updateCard(card.id, { title: t });
    } else {
      title.set(card.title);
    }
    editing.set(false);
  };

  return (
    <div
      class={() => cls(
        'card',
        dragging() && 'card--dragging',
        dragOverPos() === 'before' && 'card--drop-before',
        dragOverPos() === 'after' && 'card--drop-after',
      )}
      draggable={() => !editing() ? 'true' : 'false'}
      data-card-id={card.id}
      onDragstart={e => {
        if (editing()) { e.preventDefault(); return; }
        startDrag(boardId, columnId, card.id);
        dragging.set(true);
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require setData to fire drop reliably.
        try { e.dataTransfer.setData('text/plain', card.id); } catch {}
      }}
      onDragend={() => {
        dragging.set(false);
        dragOverPos.set(null);
        endDrag();
      }}
      onDragover={e => {
        if (!drag.cardId || drag.cardId === card.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = e.currentTarget.getBoundingClientRect();
        const isAfter = (e.clientY - rect.top) > rect.height / 2;
        dragOverPos.set(isAfter ? 'after' : 'before');
      }}
      onDragleave={() => dragOverPos.set(null)}
      onDrop={e => {
        if (!drag.cardId || drag.cardId === card.id) return;
        e.preventDefault();
        e.stopPropagation();
        const pos = dragOverPos();
        dragOverPos.set(null);
        const dstIndex = pos === 'after' ? index + 1 : index;
        store.moveCard(boardId, drag.cardId, columnId, dstIndex);
        endDrag();
      }}
    >
      {() => editing() ? (
        <textarea
          class="card__edit"
          autofocus
          rows="2"
          value={() => title()}
          onInput={e => title.set(e.target.value)}
          onBlur={commitEdit}
          onKeydown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commitEdit();
            } else if (e.key === 'Escape') {
              title.set(card.title);
              editing.set(false);
            }
          }}
        />
      ) : (
        <div class="card__view" onDblclick={() => editing.set(true)}>
          <span class="card__title">{card.title}</span>
          <button
            class="card__del"
            aria-label="Delete card"
            onClick={e => { e.stopPropagation(); store.removeCard(card.id); }}
          >×</button>
        </div>
      )}
    </div>
  );
}

// --- Column -----------------------------------------------

function Column({ board, column }) {
  const store = useKanban();
  const adding = useSignal(false);
  const newTitle = useSignal('');
  const renaming = useSignal(false);
  const name = useSignal(column.name);
  const dropAtEnd = useSignal(false);
  const inputRef = useRef(null);

  // Keep local edit buffer in sync.
  if (name() !== column.name && !renaming()) {
    name.set(column.name);
  }

  useEffect(() => {
    if (adding() && inputRef.current) inputRef.current.focus();
  });

  const submitNew = () => {
    const t = newTitle().trim();
    if (t) {
      store.addCard(board.id, column.id, t);
      newTitle.set('');
      // Keep input open for rapid entry.
      setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      adding.set(false);
    }
  };

  const commitRename = () => {
    const t = name().trim();
    if (t && t !== column.name) {
      store.renameColumn(board.id, column.id, t);
    } else {
      name.set(column.name);
    }
    renaming.set(false);
  };

  return (
    <section
      class={() => cls('column', dropAtEnd() && 'column--drop-end')}
      onDragover={e => {
        // Allow drop onto empty space at column end.
        if (!drag.cardId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Only highlight the column-level drop zone if NOT over a card.
        const tgt = e.target;
        if (tgt && tgt.closest && tgt.closest('[data-card-id]')) {
          dropAtEnd.set(false);
        } else {
          dropAtEnd.set(true);
        }
      }}
      onDragleave={e => {
        // Only clear when leaving the column entirely.
        if (e.currentTarget.contains(e.relatedTarget)) return;
        dropAtEnd.set(false);
      }}
      onDrop={e => {
        if (!drag.cardId) return;
        // If a card-level drop handler already handled it, skip.
        if (e.defaultPrevented) { dropAtEnd.set(false); return; }
        e.preventDefault();
        const dstIndex = column.cardIds.length;
        store.moveCard(board.id, drag.cardId, column.id, dstIndex);
        dropAtEnd.set(false);
        endDrag();
      }}
    >
      <header class="column__header">
        {() => renaming() ? (
          <input
            class="column__name-input"
            value={() => name()}
            onInput={e => name.set(e.target.value)}
            onBlur={commitRename}
            onKeydown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') { name.set(column.name); renaming.set(false); }
            }}
            autofocus
          />
        ) : (
          <h3 class="column__name" onDblclick={() => renaming.set(true)}>
            {column.name}
            <span class="column__count">{() => column.cardIds.length}</span>
          </h3>
        )}
        <button
          class="column__del"
          aria-label="Delete column"
          title="Delete column"
          onClick={() => {
            if (column.cardIds.length === 0 || confirm(`Delete "${column.name}" and ${column.cardIds.length} card(s)?`)) {
              store.removeColumn(board.id, column.id);
            }
          }}
        >×</button>
      </header>

      <div class="column__cards">
        {column.cardIds.map((cardId, i) => {
          const card = store.cards[cardId];
          if (!card) return null;
          return <Card key={cardId} card={card} columnId={column.id} boardId={board.id} index={i} />;
        })}
      </div>

      {() => adding() ? (
        <div class="column__add-form">
          <textarea
            ref={inputRef}
            class="column__add-input"
            placeholder="Card title"
            rows="2"
            value={() => newTitle()}
            onInput={e => newTitle.set(e.target.value)}
            onKeydown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitNew();
              } else if (e.key === 'Escape') {
                newTitle.set('');
                adding.set(false);
              }
            }}
          />
          <div class="column__add-actions">
            <button class="btn btn--primary" onClick={submitNew}>Add</button>
            <button class="btn" onClick={() => { newTitle.set(''); adding.set(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button class="column__add-btn" onClick={() => adding.set(true)}>
          + Add card
        </button>
      )}
    </section>
  );
}

// --- BoardView (/board/:id) -------------------------------

function BoardView({ params }) {
  const store = useKanban();
  const addingColumn = useSignal(false);
  const newColName = useSignal('');

  // Sync the routed board into the store. Components run once, so this
  // useEffect re-runs whenever route params or board list changes.
  useEffect(() => {
    const id = params.id;
    if (id && store.boards.some(b => b.id === id) && store.activeBoardId !== id) {
      store.setActiveBoard(id);
    }
  });

  // Read activeBoardId reactively but resolve columns inline so the column
  // iteration is its own reactive boundary — the compiler lowers .map() to
  // _$mapArray with keyed reconciliation, so moving one card only patches
  // the affected column, not the entire board.
  return (
    <div class="board">
      <header class="board__header">
        <Link href="/" class="board__back">← All boards</Link>
        {() => {
          const b = store.activeBoard;
          if (!b) return <span class="board__title">Board not found</span>;
          return <BoardTitle board={b} />;
        }}
        <div class="board__actions">
          <button class="btn" onClick={() => store.seedDemo(5)}>Seed 15 cards</button>
        </div>
      </header>

      <div class="board__columns">
        {() => {
          const b = store.activeBoard;
          if (!b) return null;
          return b.columns.map(col => (
            <Column key={col.id} board={b} column={col} />
          ));
        }}
        {() => {
          const b = store.activeBoard;
          if (!b) {
            return (
              <div class="empty">
                <p>This board doesn't exist (or was deleted).</p>
                <Link href="/" class="btn btn--primary">Back to boards</Link>
              </div>
            );
          }
          return addingColumn() ? (
            <div class="column column--new">
              <input
                class="column__name-input"
                autofocus
                placeholder="Column name"
                value={() => newColName()}
                onInput={e => newColName.set(e.target.value)}
                onKeydown={e => {
                  if (e.key === 'Enter') {
                    const t = newColName().trim();
                    if (t) store.addColumn(b.id, t);
                    newColName.set('');
                    addingColumn.set(false);
                  } else if (e.key === 'Escape') {
                    newColName.set('');
                    addingColumn.set(false);
                  }
                }}
                onBlur={() => {
                  const t = newColName().trim();
                  if (t) store.addColumn(b.id, t);
                  newColName.set('');
                  addingColumn.set(false);
                }}
              />
            </div>
          ) : (
            <button class="column column--add" onClick={() => addingColumn.set(true)}>
              + Add column
            </button>
          );
        }}
      </div>
    </div>
  );
}

function BoardTitle({ board }) {
  const editing = useSignal(false);
  const name = useSignal(board.name);
  const store = useKanban();

  if (!editing() && name() !== board.name) name.set(board.name);

  const commit = () => {
    const t = name().trim();
    if (t && t !== board.name) store.renameBoard(board.id, t);
    else name.set(board.name);
    editing.set(false);
  };

  return (() => editing() ? (
    <input
      class="board__title-input"
      autofocus
      value={() => name()}
      onInput={e => name.set(e.target.value)}
      onBlur={commit}
      onKeydown={e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { name.set(board.name); editing.set(false); }
      }}
    />
  ) : (
    <h1 class="board__title" onDblclick={() => editing.set(true)}>{board.name}</h1>
  ))();
}

// --- BoardList (/) ----------------------------------------

function BoardList() {
  const store = useKanban();
  const newName = useSignal('');
  const creating = useSignal(false);

  const submit = () => {
    const t = newName().trim();
    if (!t) { creating.set(false); newName.set(''); return; }
    const id = store.addBoard(t);
    newName.set('');
    creating.set(false);
    navigate(`/board/${id}`);
  };

  return (
    <div class="boards">
      <header class="boards__header">
        <h1 class="boards__title">What Kanban</h1>
        <p class="boards__sub">
          {() => store.boards.length} board{() => store.boards.length === 1 ? '' : 's'}
          {' · '}
          {() => store.cardCount} card{() => store.cardCount === 1 ? '' : 's'} total
        </p>
      </header>

      <div class="boards__grid">
        {() => store.boards.map(b => (
          <Link key={b.id} href={`/board/${b.id}`} class="board-card">
            <div class="board-card__name">{b.name}</div>
            <div class="board-card__meta">
              {() => store.boardCardCounts[b.id] || 0} card{() => (store.boardCardCounts[b.id] || 0) === 1 ? '' : 's'}
              {' · '}
              {b.columns.length} column{b.columns.length === 1 ? '' : 's'}
            </div>
            <button
              class="board-card__del"
              aria-label="Delete board"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm(`Delete "${b.name}" and all its cards?`)) {
                  store.removeBoard(b.id);
                }
              }}
            >×</button>
          </Link>
        ))}

        {() => creating() ? (
          <div class="board-card board-card--new">
            <input
              class="board-card__new-input"
              autofocus
              placeholder="Board name"
              value={() => newName()}
              onInput={e => newName.set(e.target.value)}
              onKeydown={e => {
                if (e.key === 'Enter') submit();
                if (e.key === 'Escape') { newName.set(''); creating.set(false); }
              }}
              onBlur={submit}
            />
          </div>
        ) : (
          <button class="board-card board-card--add" onClick={() => creating.set(true)}>
            + New board
          </button>
        )}
      </div>

      <footer class="boards__footer">
        <button class="btn" onClick={() => {
          if (confirm('Reset everything? This wipes all boards and cards.')) store.resetAll();
        }}>Reset all data</button>
      </footer>
    </div>
  );
}

// --- App / Router -----------------------------------------

function NotFound() {
  return (
    <div class="empty">
      <h2>404</h2>
      <p>No such route: <code>{route.path}</code></p>
      <Link href="/" class="btn btn--primary">Home</Link>
    </div>
  );
}

function App() {
  return (
    <Router
      routes={[
        { path: '/', component: BoardList },
        { path: '/board/:id', component: BoardView },
      ]}
      fallback={NotFound}
    />
  );
}

// --- Styles -----------------------------------------------

const css = `
  .btn {
    background: var(--surface-2); color: var(--text);
    padding: 6px 12px; border-radius: 6px; font-size: 13px;
    border: 1px solid var(--border); transition: background 0.15s, border-color 0.15s;
  }
  .btn:hover { background: var(--border); }
  .btn--primary { background: var(--accent); border-color: var(--accent); color: white; }
  .btn--primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }

  /* Boards landing */
  .boards { max-width: 980px; margin: 0 auto; padding: 32px 20px; width: 100%; }
  .boards__header { margin-bottom: 24px; }
  .boards__title { font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }
  .boards__sub { color: var(--muted); font-size: 13px; margin-top: 4px; }

  .boards__grid {
    display: grid; gap: 12px;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  }

  .board-card {
    position: relative;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 14px; color: var(--text); text-decoration: none;
    display: flex; flex-direction: column; gap: 4px; min-height: 80px;
    transition: border-color 0.15s, transform 0.05s;
  }
  .board-card:hover { border-color: var(--accent); text-decoration: none; }
  .board-card:active { transform: translateY(1px); }
  .board-card__name { font-weight: 600; font-size: 15px; }
  .board-card__meta { color: var(--muted); font-size: 12px; }
  .board-card__del {
    position: absolute; top: 6px; right: 8px; color: var(--muted);
    font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 4px;
    opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  }
  .board-card:hover .board-card__del { opacity: 1; }
  .board-card__del:hover { color: var(--danger); background: rgba(239,68,68,0.12); }
  .board-card--new, .board-card--add {
    border-style: dashed; color: var(--muted);
    align-items: center; justify-content: center; cursor: pointer;
    font-size: 14px;
  }
  .board-card--add:hover { color: var(--accent); border-color: var(--accent); }
  .board-card__new-input { width: 100%; text-align: center; font-weight: 600; }

  .boards__footer { margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border); }

  /* Board view */
  .board { display: flex; flex-direction: column; flex: 1; min-width: 0; }
  .board__header {
    display: flex; align-items: center; gap: 16px;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .board__back { font-size: 13px; color: var(--muted); }
  .board__back:hover { color: var(--text); text-decoration: none; }
  .board__title { font-size: 18px; font-weight: 600; flex: 1; }
  .board__title-input { font-size: 18px; font-weight: 600; flex: 1; max-width: 360px; }
  .board__actions { display: flex; gap: 8px; }

  .board__columns {
    flex: 1; display: flex; gap: 12px; padding: 16px 20px;
    overflow-x: auto; align-items: flex-start;
  }

  /* Column */
  .column {
    flex: 0 0 280px; max-height: calc(100vh - 120px);
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    display: flex; flex-direction: column;
    transition: border-color 0.15s, background 0.15s;
  }
  .column--drop-end { border-color: var(--accent); background: rgba(99,102,241,0.06); }
  .column--add {
    align-items: center; justify-content: center; color: var(--muted);
    border-style: dashed; cursor: pointer; min-height: 60px; padding: 16px;
    background: transparent;
  }
  .column--add:hover { color: var(--accent); border-color: var(--accent); }
  .column--new { padding: 8px; }

  .column__header {
    display: flex; align-items: center; gap: 6px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
  }
  .column__name {
    flex: 1; font-size: 13px; font-weight: 600; letter-spacing: 0.02em;
    text-transform: uppercase; color: var(--muted); cursor: text;
    display: flex; align-items: center; gap: 8px;
  }
  .column__name-input { flex: 1; font-weight: 600; }
  .column__count {
    font-size: 11px; color: var(--faint); background: var(--surface-2);
    padding: 1px 6px; border-radius: 10px; font-weight: 500;
    text-transform: none; letter-spacing: 0;
  }
  .column__del {
    color: var(--muted); font-size: 16px; line-height: 1; padding: 2px 6px; border-radius: 4px;
    opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  }
  .column:hover .column__del { opacity: 1; }
  .column__del:hover { color: var(--danger); background: rgba(239,68,68,0.1); }

  .column__cards {
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
    overflow-y: auto; flex: 1;
  }

  .column__add-btn {
    padding: 8px 12px; margin: 4px 8px 8px; color: var(--muted);
    border-radius: 6px; text-align: left; font-size: 13px;
    transition: background 0.15s, color 0.15s;
  }
  .column__add-btn:hover { background: var(--surface-2); color: var(--text); }
  .column__add-form { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .column__add-input { resize: none; }
  .column__add-actions { display: flex; gap: 6px; }

  /* Card */
  .card {
    position: relative;
    background: var(--surface-2); border: 1px solid transparent; border-radius: 6px;
    padding: 8px 10px; cursor: grab; user-select: none;
    transition: border-color 0.1s, box-shadow 0.1s, transform 0.05s, opacity 0.15s;
    box-shadow: var(--shadow);
  }
  .card:active { cursor: grabbing; }
  .card:hover { border-color: var(--border); }
  .card--dragging { opacity: 0.4; }
  .card--drop-before { border-top: 2px solid var(--accent); padding-top: 6px; }
  .card--drop-after { border-bottom: 2px solid var(--accent); padding-bottom: 6px; }
  .card__view { display: flex; gap: 6px; align-items: flex-start; }
  .card__title { flex: 1; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  .card__del {
    color: var(--muted); font-size: 14px; line-height: 1; padding: 0 4px; border-radius: 3px;
    opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s;
  }
  .card:hover .card__del { opacity: 1; }
  .card__del:hover { color: var(--danger); background: rgba(239,68,68,0.12); }
  .card__edit { width: 100%; resize: vertical; min-height: 48px; }

  /* Empty / 404 */
  .empty {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 12px; padding: 40px; color: var(--muted); text-align: center;
  }
  .empty code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px; color: var(--text); }
`;

if (typeof document !== 'undefined') {
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
}

mount(<App />, '#app');
