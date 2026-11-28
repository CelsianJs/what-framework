// React: the component page (shared/data.mjs buildCards), one Card component
// per card with a key, each with a counter of its own.
import { useState } from 'react';

function Card({ card, total }) {
  const [count, setCount] = useState(card.start);
  return (
    <div className="card" id={'card-' + card.id}>
      <h3 className="title">{card.title}</h3>
      <p className="note">Card {card.id} of {total}</p>
      <button type="button" className="inc" onClick={() => setCount(count + 1)}>{count}</button>
    </div>
  );
}

export function Cards({ cards }) {
  return <div className="cards">{cards.map((card) => <Card key={card.id} card={card} total={cards.length} />)}</div>;
}
