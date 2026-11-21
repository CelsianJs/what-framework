// what-framework/a11y (what-core/a11y): focus management, ARIA state helpers,
// live-region announcements, ids and keyboard helpers. useId is on the root
// entry, as in React.
export {
  useFocus,
  useFocusRestore,
  useFocusTrap,
  FocusTrap,
  announce,
  announceAssertive,
  SkipLink,
  useAriaExpanded,
  useAriaSelected,
  useAriaChecked,
  useRovingTabIndex,
  VisuallyHidden,
  LiveRegion,
  useIds,
  useDescribedBy,
  useLabelledBy,
  Keys,
  onKey,
  onKeys,
} from '../a11y.js';
