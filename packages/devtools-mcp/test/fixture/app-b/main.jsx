// A second app on another dev server origin: the bridge must refuse it while
// app A is attached, and nothing it does may reach app A's session.
import { signal, effect, mount } from 'what-framework';

const startup = signal(0, 'startup');
effect(function otherEffect() {
  if (startup()) throw new Error('Other app effect failed');
});
startup(1);

function App() {
  return <main><h1>Other Todos</h1><p id="startup">{startup()}</p></main>;
}
mount(<App />, '#app');
