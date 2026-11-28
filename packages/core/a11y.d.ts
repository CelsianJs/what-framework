// what-core/a11y (what-framework/a11y): focus management, ARIA state helpers,
// announcements and keyboard helpers. useId is on the root entry.
import type { VNode, VNodeChild } from './index.js';

// --- Accessibility ---

export function useFocus(): {
  current: () => Element | null;
  focus: (element?: Element | null) => void;
  blur: () => void;
};

export function useFocusRestore(): {
  capture: (target?: Element | null) => void;
  restore: (fallbackTarget?: Element | null) => void;
  previous: () => Element | null;
};

export function useFocusTrap(containerRef: { current?: Element | null } | Element): {
  activate: () => void | (() => void);
  deactivate: () => void;
};

export function FocusTrap(props: { children?: VNodeChild; active?: boolean }): VNode;
export function announce(message: string, options?: { priority?: 'polite' | 'assertive'; timeout?: number }): void;
export function announceAssertive(message: string): void;
export function SkipLink(props: { href?: string; children?: VNodeChild }): VNode;

export function useAriaExpanded(initialExpanded?: boolean): {
  expanded: () => boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
  buttonProps: () => Record<string, any>;
  panelProps: () => Record<string, any>;
};

export function useAriaSelected<T = any>(initialSelected?: T): {
  selected: () => T;
  select: (value: T) => void;
  isSelected: (value: T) => boolean;
  itemProps: (value: T) => Record<string, any>;
};

export function useAriaChecked(initialChecked?: boolean): {
  checked: () => boolean;
  toggle: () => void;
  set: (value: boolean) => void;
  checkboxProps: () => Record<string, any>;
};

export interface RovingTabIndexOptions {
  /**
   * Container role, emitted by containerProps(). The hook emits NO role by
   * default: roving tabindex is the shared keyboard mechanic of toolbars,
   * menus, trees, grids, tablists, radiogroups and listboxes, and a default
   * spread last would silently overwrite the role the caller wrote beside it.
   */
  role?: string;
}

/**
 * Props for one roving item. `ref` is the item's REGISTRATION (the hook holds
 * the node through it and cannot move focus without it), so a `ref` passed via
 * `overrides` is chained rather than replaced. `tabIndex` is an accessor, not a
 * number: exactly one item is tabbable at a time and which one changes as focus
 * roves, so a resolved value could not survive the spread.
 */
export interface RovingItemProps {
  ref: { current: Element | null };
  tabIndex: () => number;
  onKeyDown: (e: KeyboardEvent) => void;
  onFocus: (e: Event) => void;
  [prop: string]: any;
}

export function useRovingTabIndex(
  itemCountOrSignal: number | (() => number),
  options?: RovingTabIndexOptions,
): {
  /** Active index, clamped to the current count so the group is never untabbable. */
  focusIndex: () => number;
  /**
   * Set the active index. Out-of-range indexes are REFUSED, not clamped. Moves
   * real focus only when the group already owns it, so syncing from application
   * state cannot steal focus from elsewhere on the page.
   */
  setFocusIndex: (index: number) => void;
  /**
   * Explicitly move focus to an item (a menu focusing its first item on open).
   * Returns the element it focused, or null when the index is out of range or
   * the item is not in the DOM.
   */
  focusItem: (index: number) => Element | null;
  getItemProps: (index: number, overrides?: Record<string, any>) => RovingItemProps;
  containerProps: (overrides?: Record<string, any>) => Record<string, any>;
};

export function VisuallyHidden(props: { children?: VNodeChild; as?: string }): VNode;
export function LiveRegion(props: { children?: VNodeChild; priority?: 'polite' | 'assertive'; atomic?: boolean }): VNode;
export function useIds(count: number, prefix?: string): string[];
export function useDescribedBy(description: VNodeChild): {
  descriptionId: string;
  descriptionProps: () => Record<string, any>;
  describedByProps: () => Record<string, any>;
  Description: () => VNode;
};
export function useLabelledBy(label: VNodeChild): {
  labelId: string;
  labelProps: () => Record<string, any>;
  labelledByProps: () => Record<string, any>;
};

export const Keys: {
  Enter: 'Enter';
  Space: ' ';
  Escape: 'Escape';
  ArrowUp: 'ArrowUp';
  ArrowDown: 'ArrowDown';
  ArrowLeft: 'ArrowLeft';
  ArrowRight: 'ArrowRight';
  Home: 'Home';
  End: 'End';
  Tab: 'Tab';
};

export function onKey(key: string, handler: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void;
export function onKeys(keys: string[], handler: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void;
