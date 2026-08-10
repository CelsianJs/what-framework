// A dialog rendered through Portal into #modal-root, which lives outside #app
// in index.html. The button that opens it sits in the topbar, so if the modal
// were rendered in place it would be clipped by the topbar's stacking context
// and its backdrop could never cover the page. That is the whole reason Portal
// exists, and it is what the smoke check asserts: the dialog is NOT a
// descendant of the shell.

import { Portal, signal } from 'what-framework';
import { addDraftOrder, closeNewOrder } from '../state/ui.js';

export function NewOrderModal() {
  const customer = signal('', 'modal:customer');

  return (
    <Portal target="#modal-root">
      <div class="modal-backdrop" data-modal-backdrop onclick={closeNewOrder}>
        <div
          class="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Create order"
          data-modal
          onclick={(e) => e.stopPropagation()}
        >
          <h2>Create order</h2>
          <p class="muted">Drafts stay local to this session.</p>
          <label class="field">
            Customer
            <input
              data-modal-customer
              placeholder="Ada Lovelace"
              value={() => customer()}
              oninput={(e) => customer(e.target.value)}
            />
          </label>
          <div class="modal-actions">
            <button class="ghost" data-modal-cancel onclick={closeNewOrder}>Cancel</button>
            <button
              class="primary"
              data-modal-save
              onclick={() => addDraftOrder(customer().trim() || 'Unnamed customer')}
            >
              Create draft
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
