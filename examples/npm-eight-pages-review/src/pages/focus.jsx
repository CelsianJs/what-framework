import { Show, VisuallyHidden, announce, useEffect, useFocus, useFocusTrap, useSignal } from 'what-framework';

export const page = {
  mode: 'client',
};

export default function FocusPage() {
  const isOpen = useSignal(false);
  const focus = useFocus();
  const modalRef = { current: null };
  const trap = useFocusTrap(modalRef);
  let triggerButton = null;
  let previousFocus = null;
  let trapCleanup = null;

  const openDialog = () => {
    previousFocus = focus.current() || triggerButton;
    isOpen(true);
    requestAnimationFrame(() => {
      if (!modalRef.current || typeof modalRef.current.querySelectorAll !== 'function') {
        return;
      }
      trapCleanup?.();
      trapCleanup = trap.activate();
    });
    announce('Dialog opened');
  };

  const closeDialog = () => {
    trapCleanup?.();
    trapCleanup = null;
    trap.deactivate();
    isOpen(false);
    const target = previousFocus || triggerButton;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
    announce('Dialog closed');
  };

  useEffect(() => {
    if (!isOpen()) return;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeDialog();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen()]);

  return (
    <section>
      <h1 class="page-title">Focus management</h1>
      <p class="lead">Uses <code>FocusTrap</code>, <code>useFocus</code>, and screen-reader announcements.</p>

      <div class="card">
        <button
          class="btn btn-primary"
          ref={(el) => { triggerButton = el; }}
          onClick={openDialog}
        >
          Open modal
        </button>
      </div>

      <Show when={isOpen()}>
        <div class="modal-backdrop" onClick={closeDialog}>
          <div
            class="modal-panel"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-dialog-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeDialog();
            }}
          >
            <h2 id="focus-dialog-title">Focus trap test</h2>
            <p>Tab should stay inside this panel while open.</p>

            <label class="field">
              <span>First field</span>
              <input class="text-input" placeholder="Type here" />
            </label>

            <label class="field">
              <span>Second field</span>
              <input class="text-input" placeholder="Then here" />
            </label>

            <div class="button-row">
              <button class="btn" onClick={closeDialog}>Cancel</button>
              <button class="btn btn-primary" onClick={closeDialog}>
                <VisuallyHidden>Confirm and close dialog</VisuallyHidden>
                Confirm
              </button>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}
