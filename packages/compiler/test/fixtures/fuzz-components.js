// Components under test for the lowering-parity fuzzer.
//
// Both arms of the fuzz import THIS module, so the component bodies cannot
// drift between them and any divergence the fuzzer reports is a difference in
// how the CALL SITE was lowered — which is the only thing being tested.
//
// The bodies are written with h() rather than JSX on purpose: compiling them
// would put the thing under test on both sides of the comparison, so a lowering
// bug inside a component body could cancel out the same bug at the call site
// and the fuzzer would report agreement.
//
// Each component renders a digest of every prop it was handed. That is what
// makes a props-merge bug VISIBLE: a dropped spread, a key resolved in the
// wrong order, or an accessor that got called instead of copied all change the
// digest string, and the fuzzer compares digests as ordinary DOM text.

import { h } from '../../../core/src/index.js';

// Every prop except `children`, sorted, so the comparison is over the key SET
// and the VALUES rather than over insertion order. Key order is not part of the
// contract: `{a, ...s}` and Object.assign produce the same order anyway, but a
// lone spread is handed through by reference and carries whatever order the
// caller's object had, and asserting on that would pin an implementation detail.
//
// A function value is CALLED, because a prop whose value is an accessor is how
// this framework spells "reactive prop". Calling it here, inside the thunk this
// digest runs in, is what subscribes the region: a merge that invoked accessors
// eagerly instead of copying them through would freeze this text, and the write
// half of the fuzz would catch it.
function digest(props) {
  const keys = Object.keys(props).filter(k => k !== 'children').sort();
  if (keys.length === 0) return '-';
  return keys.map(k => {
    const value = props[k];
    return `${k}=${typeof value === 'function' ? value() : value}`;
  }).join(',');
}

// Children in the MIDDLE, between two static siblings. A component that
// inserts its children at the wrong offset still looks right when they are the
// only thing in the subtree, so both neighbours are load-bearing.
export function Box(props) {
  return h(
    'div',
    { 'data-c': 'Box' },
    h('u', {}, () => digest(props)),
    props.children,
    h('em', {}, 'end'),
  );
}

// The mirror image: children FIRST, digest after, under a different tag. Two
// shapes rather than one so a bug that depends on whether children lead or
// trail cannot hide behind a single layout.
export function Wrap(props) {
  return h(
    'section',
    { 'data-c': 'Wrap' },
    props.children,
    h('u', {}, () => digest(props)),
  );
}

// The island arm hydrates THIS one. It is deliberately the same shape as Box so
// the island comparison is about the props Island was handed and nothing else.
export function Chart(props) {
  return h(
    'div',
    { 'data-c': 'Chart' },
    h('u', {}, () => digest(props)),
    props.children,
  );
}
