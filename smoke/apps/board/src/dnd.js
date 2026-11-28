// Dragging a card with pointer events. A press that moves 4 px starts a drag:
// the card follows the pointer (a transform, nothing re-renders), one drop
// line shows where it will land, and the release moves it in the board. The
// columns' and cards' positions are read once, when the drag starts.

import { columnIndex, moveCard } from './board.js';

let drag = null;
let line = null;

function placeLine(x, y, width) {
  if (!line) {
    line = document.createElement('div');
    line.className = 'drop-line';
    line.dataset.dropLine = '';
    document.body.appendChild(line);
  }
  line.style.transform = `translate(${x}px, ${y}px)`;
  line.style.width = `${width}px`;
  line.hidden = false;
}

function measure() {
  drag.columns = Array.from(document.querySelectorAll('[data-list]'), (list) => {
    const rect = list.getBoundingClientRect();
    const mids = [];
    for (const el of list.children) {
      if (el === drag.el) continue;
      const r = el.getBoundingClientRect();
      mids.push({ mid: r.top + r.height / 2, top: r.top, bottom: r.bottom });
    }
    return { col: columnIndex[list.dataset.list], rect, mids };
  });
}

function target(x, y) {
  const column = drag.columns.find((c) => x >= c.rect.left && x <= c.rect.right) ?? null;
  if (!column) return null;
  let index = 0;
  while (index < column.mids.length && column.mids[index].mid < y) index++;
  const edge = index < column.mids.length ? column.mids[index].top : (column.mids.at(-1)?.bottom ?? column.rect.top);
  return { col: column.col, index, x: column.rect.left, y: Math.max(column.rect.top, Math.min(edge, column.rect.bottom)), width: column.rect.width };
}

function onMove(e) {
  if (e.pointerId !== drag.pointerId) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  if (!drag.active) {
    if (Math.hypot(dx, dy) < 4) return;
    drag.active = true;
    drag.el.classList.add('dragging');
    measure();
  }
  drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
  drag.to = target(e.clientX, e.clientY);
  if (drag.to) placeLine(drag.to.x, drag.to.y, drag.to.width);
  else if (line) line.hidden = true;
}

function end(e, commit) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  const { el, active, from, to } = drag;
  drag = null;
  if (line) line.hidden = true;
  if (!active) return;
  el.classList.remove('dragging');
  el.style.transform = '';
  if (commit && to) moveCard(from, { col: to.col, index: to.index });
}

const onUp = (e) => end(e, true);
const onCancel = (e) => end(e, false);

export function startDrag(e, id) {
  if (e.button !== 0 || drag) return;
  const el = e.currentTarget;
  const list = el.parentElement;
  // The press is the drag's alone: no text selection or native drag starts
  // from it (a browser that starts one cancels the pointer, and the release
  // never comes), and the card holds the pointer, so the release reaches the
  // window wherever it happens.
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch { /* a pointer the browser no longer tracks */ }
  drag = {
    id,
    el,
    x: e.clientX,
    y: e.clientY,
    pointerId: e.pointerId,
    active: false,
    from: { col: columnIndex[list.dataset.list], index: Array.prototype.indexOf.call(list.children, el) },
    to: null,
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
}
