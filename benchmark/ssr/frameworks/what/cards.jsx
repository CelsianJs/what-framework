// What, h()/runtime JSX: the component page (shared/data.mjs buildCards), one
// Card component per card in a keyed .map(), each with a counter of its own
// shown through a thunk child.
import { signal } from 'what-framework';

function Card(props) {
  const count = signal(props.card.start);
  return (
    <div class="card" id={'card-' + props.card.id}>
      <h3 class="title">{props.card.title}</h3>
      <p class="note">Card {props.card.id} of {props.total}</p>
      <button type="button" class="inc" onclick={() => count(count() + 1)}>{() => count()}</button>
    </div>
  );
}

export function Cards(props) {
  return <div class="cards">{props.cards.map((card) => <Card key={card.id} card={card} total={props.cards.length} />)}</div>;
}
