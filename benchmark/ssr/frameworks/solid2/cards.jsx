// Solid: the component page (shared/data.mjs buildCards), one Card component
// per card under <For>, each with a counter of its own.
import { createSignal, For } from 'solid-js';

function Card(props) {
  const [count, setCount] = createSignal(props.card.start);
  return (
    <div class="card" id={'card-' + props.card.id}>
      <h3 class="title">{props.card.title}</h3>
      <p class="note">Card {props.card.id} of {props.total}</p>
      <button type="button" class="inc" onClick={() => setCount(count() + 1)}>{count()}</button>
    </div>
  );
}

export function Cards(props) {
  return <div class="cards"><For each={props.cards}>{(card) => <Card card={card} total={props.cards.length} />}</For></div>;
}
