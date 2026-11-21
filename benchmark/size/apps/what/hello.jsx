import { mount, signal } from 'what-framework';

function App() {
  const count = signal(0);
  return (
    <main>
      <h1>Hello</h1>
      <button type="button" onclick={() => count(n => n + 1)}>Count: {count()}</button>
    </main>
  );
}

mount(<App />, document.getElementById('app'));
