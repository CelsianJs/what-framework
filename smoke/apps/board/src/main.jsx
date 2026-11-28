// Tack: a release board of 1,000 cards in five columns. Cards are dragged
// with the pointer within and between columns; Ctrl+Z / Ctrl+Shift+Z undo and
// redo. Client-only; index.html ships an empty #app.

import './styles.css';

import { mount, onCleanup, onMount, useState } from 'what-framework';

import { board, cards, history, probes, redo, undo } from './board.js';
import { startDrag } from './dnd.js';

function Card({ id }) {
  const card = cards[id];
  const [open, setOpen] = useState(false);
  probes.created++;
  onCleanup(() => { probes.disposed++; });
  return (
    <li class="card" data-card={id} onPointerDown={(e) => startDrag(e, id)}>
      <div class="card-head">
        <span class={`tag ${card.tag}`}>{card.tag}</span>
        <b>{card.id}</b>
        <span class="pts">{card.points} pt</span>
        <button
          class="more"
          data-more
          aria-expanded={open() ? 'true' : 'false'}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen((o) => !o)}
        >
          {open() ? '–' : '+'}
        </button>
      </div>
      <p class="title">{card.title}</p>
      {open() ? <p class="detail" data-detail>{`${card.points} points · tagged ${card.tag}`}</p> : null}
    </li>
  );
}

// A column reads its column only in its JSX, so a move that replaces the
// column object keeps the column and every card in it that stays.
function Column({ column }) {
  return (
    <section class="column" data-column={column.id}>
      <header>
        <h2>{column.title}</h2>
        <span class="count" data-count>{column.cards.length}</span>
        <span class="muted" data-points>{`${column.cards.reduce((n, id) => n + cards[id].points, 0)} pt`}</span>
      </header>
      <ol class="cards" data-list={column.id}>
        {column.cards.map((id) => <Card key={id} id={id} />)}
      </ol>
    </section>
  );
}

function App() {
  onMount(() => {
    const keys = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  });
  return (
    <main class="page">
      <header class="masthead">
        <h1>Tack</h1>
        <span class="muted">release 4.2 · {board().reduce((n, c) => n + c.cards.length, 0)} cards</span>
        <div class="tools">
          <button data-undo disabled={history().undo === 0} onClick={undo}>Undo</button>
          <button data-redo disabled={history().redo === 0} onClick={redo}>Redo</button>
        </div>
      </header>
      <div class="board">
        {board().map((column) => <Column key={column.id} column={column} />)}
      </div>
    </main>
  );
}

mount(<App />, '#app');
