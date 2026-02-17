// What Framework - Core
// The closest framework to vanilla JS.

// Reactive primitives
export { signal, computed, effect, memo as signalMemo, batch, untrack, flushSync, createRoot } from './reactive.js';

// Fine-grained rendering primitives
export { template, insert, mapArray, spread, setProp, delegateEvents, on, classList } from './render.js';

// Virtual DOM
export { h, Fragment, html } from './h.js';

// DOM mounting & rendering
export { mount } from './dom.js';

// Hooks (React-compatible API)
export {
  useState,
  useSignal,
  useComputed,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  useContext,
  useReducer,
  createContext,
  onMount,
  onCleanup,
  createResource,
} from './hooks.js';

// Component helpers
export { memo, lazy, Suspense, ErrorBoundary, Show, For, Switch, Match, Island } from './components.js';

// Store
export { createStore, derived, storeComputed, atom } from './store.js';

// Head management
export { Head, clearHead } from './head.js';

// Utilities
export {
  each,
  cls,
  style,
  debounce,
  throttle,
  useMediaQuery,
  useLocalStorage,
  useClickOutside,
  Portal,
  transition,
} from './helpers.js';

// DOM Scheduler (prevents layout thrashing)
export {
  scheduleRead,
  scheduleWrite,
  flushScheduler,
  measure,
  mutate,
  useScheduledEffect,
  nextFrame,
  raf,
  onResize,
  onIntersect,
  smoothScrollTo,
} from './scheduler.js';

// Testing utilities (import separately: 'what/testing')
// export * from './testing.js';

// Animation primitives
export {
  spring,
  tween,
  easings,
  useTransition,
  useGesture,
  useAnimatedValue,
  createTransitionClasses,
  cssTransition,
} from './animation.js';

// Accessibility utilities
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
  useId,
  useIds,
  useDescribedBy,
  useLabelledBy,
  Keys,
  onKey,
  onKeys,
} from './a11y.js';

// Skeleton loaders and loading states
export {
  Skeleton,
  SkeletonText,
  SkeletonAvatar,
  SkeletonCard,
  SkeletonTable,
  IslandSkeleton,
  useSkeleton,
  Placeholder,
  LoadingDots,
  Spinner,
} from './skeleton.js';

// Data fetching (SWR-like)
export {
  useFetch,
  useSWR,
  useQuery,
  useInfiniteQuery,
  invalidateQueries,
  prefetchQuery,
  setQueryData,
  getQueryData,
  clearCache,
} from './data.js';

// Form utilities
export {
  useForm,
  useField,
  rules,
  simpleResolver,
  zodResolver,
  yupResolver,
  Input,
  Textarea,
  Select,
  Checkbox,
  Radio,
  ErrorMessage,
} from './form.js';
