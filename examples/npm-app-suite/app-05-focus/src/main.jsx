import { mount, useSignal, FocusTrap, useFocusRestore } from 'what-framework';

function App() {
  const open = useSignal(false);
  const focusRestore = useFocusRestore();
  let opener = null;

  function openModal() {
    focusRestore.capture(opener);
    open(true);
  }

  function closeModal() {
    open(false);
    focusRestore.restore(opener);
  }

  return (
    <main className="app-shell">
      <h1>App 05: Focus Management</h1>
      <p>Modal with `FocusTrap` plus parent-controlled `useFocusRestore`.</p>

      <button ref={(el) => { opener = el; }} onClick={openModal}>
        Open Modal
      </button>

      {open() ? (
        <div className="backdrop" onClick={closeModal}>
          <FocusTrap active={open()}>
            <div
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Demo modal"
              onClick={(e) => e.stopPropagation()}
            >
              <h2>Keyboard Test</h2>
              <p>Tab should loop between inputs and buttons in this dialog.</p>
              <label>
                First field
                <input type="text" placeholder="Focus starts here" />
              </label>
              <label>
                Second field
                <input type="text" placeholder="Then moves here" />
              </label>
              <div className="row">
                <button onClick={closeModal}>Close</button>
                <button onClick={() => alert('Action fired')}>Action</button>
              </div>
            </div>
          </FocusTrap>
        </div>
      ) : null}
    </main>
  );
}

mount(<App />, '#app');
