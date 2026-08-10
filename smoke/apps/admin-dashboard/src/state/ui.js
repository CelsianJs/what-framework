// Shell-level UI state. It lives in a module rather than in the Shell
// component so the topbar can open a dialog the shell renders, without either
// of them knowing about the other.

import { signal } from 'what-framework';

export const newOrderOpen = signal(false, 'ui:newOrderOpen');
export const draftOrders = signal([], 'ui:draftOrders');

export function openNewOrder() { newOrderOpen(true); }
export function closeNewOrder() { newOrderOpen(false); }

export function addDraftOrder(customer) {
  const n = draftOrders().length + 1;
  draftOrders((list) => [...list, { id: `NW-DRAFT-${n}`, customer }]);
  newOrderOpen(false);
}
