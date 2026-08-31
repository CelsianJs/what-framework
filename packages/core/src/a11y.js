// What Framework - Accessibility Utilities
// Focus management, ARIA helpers, screen reader announcements

import { signal, effect } from './reactive.js';
import { h } from './h.js';
import { getCurrentComponent } from './dom.js';
import { getServerContext } from './server-context.js';

// --- Focus Management ---

// Track currently focused element
const focusedElement = signal(null);

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (e) => {
    focusedElement.set(e.target);
  });
}

export function useFocus() {
  return {
    current: () => focusedElement(),
    focus: (element) => element?.focus(),
    blur: () => /** @type {HTMLElement | null} */ (document.activeElement)?.blur(),
  };
}

// Capture/restore focus around transient UI (dialogs, popovers, drawers).
// Parent components can call capture() before opening and restore() on close.
export function useFocusRestore() {
  const previousFocusRef = { current: null };

  function capture(target) {
    if (typeof document === 'undefined') return;
    previousFocusRef.current = target || document.activeElement || null;
  }

  function restore(fallbackTarget) {
    const target = previousFocusRef.current || fallbackTarget;
    if (target && typeof target.focus === 'function') {
      target.focus();
    }
  }

  return {
    capture,
    restore,
    previous: () => previousFocusRef.current,
  };
}

// --- Focus Trap ---
// Keep focus within a container (for modals, dialogs, etc.)

export function useFocusTrap(containerRef) {
  /** @type {HTMLElement | null} */
  let previousFocus = null;

  function activate() {
    if (typeof document === 'undefined') return;

    previousFocus = /** @type {HTMLElement | null} */ (document.activeElement);
    const container = containerRef.current || containerRef;

    if (!container || typeof container.querySelectorAll !== 'function') return;

    // Find all focusable elements
    const focusables = getFocusableElements(container);
    if (focusables.length === 0) return;

    // Focus first element
    focusables[0].focus();

    // Handle Tab key
    function handleKeydown(e) {
      if (e.key !== 'Tab') return;

      const focusables = getFocusableElements(container);
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey) {
        // Shift+Tab: if on first, go to last
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Tab: if on last, go to first
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    container.addEventListener('keydown', handleKeydown);

    return () => {
      container.removeEventListener('keydown', handleKeydown);
    };
  }

  function deactivate() {
    if (previousFocus && typeof previousFocus.focus === 'function') {
      previousFocus.focus();
    }
  }

  return { activate, deactivate };
}

function getFocusableElements(container) {
  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  return Array.from(container.querySelectorAll(selector)).filter(el => {
    return el.offsetParent !== null; // Visible
  });
}

// --- Focus Scope ---
// Component wrapper that traps focus

export function FocusTrap({ children, active = true }) {
  const containerRef = { current: null };
  const refVersion = signal(0);
  const trap = useFocusTrap(containerRef);
  /** @type {(() => void) | null | undefined} */
  let trapCleanup = null;

  const setRef = (el) => {
    containerRef.current = el;
    refVersion.set(v => v + 1);
  };

  // Scope the effect to the component lifecycle so it disposes on unmount
  const dispose = effect(() => {
    // Re-run activation after the ref element is attached/updated.
    refVersion();

    if (trapCleanup) {
      trapCleanup();
      trapCleanup = null;
      trap.deactivate();
    }

    if (active && containerRef.current) {
      trapCleanup = trap.activate();
      return () => {
        trapCleanup?.();
        trapCleanup = null;
        trap.deactivate();
      };
    }
  });

  // Register cleanup on component context
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(() => {
      dispose();
      trapCleanup?.();
      trapCleanup = null;
      trap.deactivate();
    });
  }

  return h('div', { ref: setRef }, children);
}

// --- Screen Reader Announcements ---

/** @type {HTMLDivElement | null} */
let announcer = null;
let announcerId = 0;

function getAnnouncer() {
  if (typeof document === 'undefined') return null;

  if (!announcer) {
    announcer = document.createElement('div');
    announcer.id = 'what-announcer';
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    announcer.style.cssText = `
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    `;
    document.body.appendChild(announcer);
  }
  return announcer;
}

export function announce(message, options = {}) {
  const { priority = 'polite', timeout = 1000 } = options;
  const announcer = getAnnouncer();
  if (!announcer) return;

  announcer.setAttribute('aria-live', priority);

  // Clear and re-announce (required for some screen readers)
  const id = ++announcerId;
  announcer.textContent = '';

  requestAnimationFrame(() => {
    if (announcerId === id) {
      announcer.textContent = message;
    }
  });

  // Clear after timeout
  setTimeout(() => {
    if (announcerId === id) {
      announcer.textContent = '';
    }
  }, timeout);
}

export function announceAssertive(message) {
  return announce(message, { priority: 'assertive' });
}

// --- Skip Link ---
// Accessible skip navigation

export function SkipLink({ href = '#main', children = 'Skip to content' }) {
  return h('a', {
    href,
    class: 'what-skip-link',
    onClick: (e) => {
      e.preventDefault();
      const target = /** @type {HTMLElement | null} */ (document.querySelector(href));
      if (target) {
        target.focus();
        target.scrollIntoView();
      }
    },
    style: {
      position: 'absolute',
      top: '-40px',
      left: '0',
      padding: '8px',
      background: '#000',
      color: '#fff',
      textDecoration: 'none',
      zIndex: '10000',
    },
    onFocus: (e) => {
      e.target.style.top = '0';
    },
    onBlur: (e) => {
      e.target.style.top = '-40px';
    },
  }, children);
}

// --- ARIA Helpers ---

// Every *Props() helper below returns ACCESSOR-valued ARIA props, never a
// resolved value.
//
// The obvious and documented way to consume them is a spread,
//
//     <button {...buttonProps()}>
//
// and a spread evaluates its argument exactly once. When the helper read the
// signal itself (`'aria-expanded': expanded()`), that single evaluation baked
// the state at mount into a plain boolean: an accordion announced
// aria-expanded="false" forever, no matter how many times it opened. Components
// run once in What, so nothing ever re-called buttonProps() to refresh it.
// Handing back a thunk instead moves the read to where the renderer can track
// it. Both spread paths already treat a function-valued prop as a reactive
// accessor and wrap it in a micro-effect (render.js spread() for compiled JSX,
// dom.js setProp() for h()), and renderToString() calls it during SSR, so the
// same object works on all three.
//
// The values are coerced to the STRINGS "true"/"false" rather than left as
// booleans. aria-*/role are enumerated attributes: `aria-checked=""` is not a
// valid value and an absent aria-expanded means "unsupported" to assistive
// technology rather than "collapsed". The render paths normalize this too (see
// _isAriaAttr in dom.js), but the helper is the layer that knows the attribute
// is ARIA, so it should not depend on a downstream branch ordering to be
// correct, and callers who log or diff the returned object see the real value.
function ariaBool(value) {
  return value ? 'true' : 'false';
}

export function useAriaExpanded(initialExpanded = false) {
  const expanded = signal(initialExpanded);

  return {
    expanded: () => expanded(),
    toggle: () => expanded.set(!expanded.peek()),
    open: () => expanded.set(true),
    close: () => expanded.set(false),
    buttonProps: () => ({
      'aria-expanded': () => ariaBool(expanded()),
      onClick: () => expanded.set(!expanded.peek()),
    }),
    panelProps: () => ({
      // `hidden` is a genuine HTML boolean attribute, so it stays a boolean:
      // present-or-absent is the correct serialization here, unlike ARIA.
      hidden: () => !expanded(),
    }),
  };
}

export function useAriaSelected(initialSelected = null) {
  const selected = signal(initialSelected);

  return {
    selected: () => selected(),
    select: (value) => selected.set(value),
    isSelected: (value) => selected() === value,
    itemProps: (value) => ({
      'aria-selected': () => ariaBool(selected() === value),
      onClick: () => selected.set(value),
    }),
  };
}

export function useAriaChecked(initialChecked = false) {
  const checked = signal(initialChecked);

  return {
    checked: () => checked(),
    toggle: () => checked.set(!checked.peek()),
    set: (value) => checked.set(value),
    checkboxProps: () => ({
      role: 'checkbox',
      'aria-checked': () => ariaBool(checked()),
      tabIndex: 0,
      onClick: () => checked.set(!checked.peek()),
      onKeyDown: (e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          checked.set(!checked.peek());
        }
      },
    }),
  };
}

// --- Roving Tab Index ---
// For keyboard navigation in lists, toolbars, etc.

export function useRovingTabIndex(itemCountOrSignal, options = {}) {
  // Accept either a static number or a signal/getter for dynamic lists
  const getCount = typeof itemCountOrSignal === 'function'
    ? itemCountOrSignal
    : () => itemCountOrSignal;
  const focusIndex = signal(0);

  // The container role belongs to the CALLER, so this hook emits none of its
  // own. Every call site has the shape
  //
  //     <div role="toolbar" {...containerProps()}>
  //
  // and a default inside containerProps() wins that object literal by being
  // spread last, so a hard-coded role="listbox" silently relabelled every
  // toolbar, menu, tablist and radiogroup built on the hook. containerProps()
  // cannot see the props written beside it, so the ONLY way for the caller's
  // role to survive is to not emit one. A role can still be asked for
  // explicitly, per hook (useRovingTabIndex(n, { role: 'menu' })) or per call
  // site (containerProps({ role: 'menu' })). Roving tabindex is the shared
  // keyboard mechanic of toolbars, menus, trees, grids, tablists, radiogroups
  // and listboxes; guessing one of those for the caller is wrong more often
  // than it is right.
  const configuredRole = options?.role || null;

  // --- Item registration ---
  //
  // The hook holds the item nodes DIRECTLY, through a ref object per index that
  // getItemProps() hands back for the caller to install.
  //
  // It must not hold anything else. The previous attempt located items with
  // document.querySelector on a `data-what-roving` group id allocated from the
  // useId counter, and that counter is not stable in the architecture What
  // ships as a headline feature: render.js hydrate() calls __resetIdCounter()
  // on EVERY invocation and islands hydrate one at a time, each through its own
  // hydrate() call. So (1) a single island on a page where anything earlier
  // consumed a useId computes a different id than the server wrote, the
  // selector matches nothing and focus never moves, and (2) two islands both
  // restart the counter at 1, both compute the SAME id, and the second one's
  // selector resolves into the first one's subtree, so ArrowRight moved focus
  // out of the widget the user was in and into an unrelated one. Worse, the
  // static `data-what-roving` attribute is never reconciled during hydration
  // (hydrateElementProps skips static props), so the DOM keeps the server's id
  // and the mismatch is invisible in the markup. An identifier that a later
  // render can renumber cannot be the thing that identifies an element.
  //
  // A ref OBJECT rather than a callback ref, because all three prop paths
  // accept an object and only two accept a function: render.js spread() treats
  // any function-valued prop as a reactive accessor and would CALL a callback
  // ref with no arguments. An object is assigned `.current` by dom.js
  // applyProps (h()), render.js setProp() (compiled spread) and
  // hydrateElementProps() (SSR) alike, and renderToString() skips `ref`
  // entirely, so nothing lands in the HTML and there is no hydration mismatch
  // to have.
  const itemEls = [];
  const itemRefs = [];
  const callerRefs = [];

  function refFor(index) {
    let ref = itemRefs[index];
    if (!ref) {
      ref = {
        get current() { return itemEls[index] || null; },
        set current(el) {
          itemEls[index] = el || null;
          // Forward to a ref the caller passed through
          // getItemProps(index, { ref }). Ours has to be the one in the props
          // object, so wanting the node back must not cost them focus movement.
          const caller = callerRefs[index];
          if (typeof caller === 'function') caller(el);
          else if (caller && typeof caller === 'object') caller.current = el;
        },
      };
      itemRefs[index] = ref;
    }
    return ref;
  }

  // Nothing clears a ref on unmount, so an index can still hold a node from a
  // previous render. focus() on a detached node is a silent no-op that leaves
  // document.activeElement on <body>, so an element that has left the document
  // counts as missing. (`isConnected === false` rather than a truthiness test:
  // a DOM shim without the property should not disable the whole hook.)
  function itemElement(index) {
    const el = itemEls[index];
    if (!el) return null;
    return el.isConnected === false ? null : el;
  }

  // Move REAL DOM focus onto the active item. This is the whole point of the
  // WAI-ARIA roving tabindex pattern and it was missing: arrow keys only
  // shuffled a tabIndex value between props objects, so the user pressed
  // ArrowDown and focus never left the first item (and a screen reader stayed
  // on it). Holding the node means this is correct inside a shadow root, a
  // portal or a second island for free, none of which a selector was.
  function focusItemElement(index) {
    const el = itemElement(index);
    if (!el || typeof el.focus !== 'function') return null;
    // Re-focusing the already-focused element would fire a redundant focus
    // event, and the handler in getItemProps writes focusIndex on focus.
    if (typeof document === 'undefined' || document.activeElement !== el) el.focus();
    return el;
  }

  // True when focus is already inside this group, so a programmatic index
  // change can follow it without yanking focus off an unrelated widget. An
  // item may itself contain the focused node (a link inside a grid cell), so
  // containment counts, not just identity.
  function groupHasFocus() {
    if (typeof document === 'undefined') return false;
    const active = document.activeElement;
    if (!active) return false;
    for (let i = 0; i < itemEls.length; i++) {
      const el = itemEls[i];
      if (!el) continue;
      if (el === active) return true;
      if (typeof el.contains === 'function' && el.contains(active)) return true;
    }
    return false;
  }

  // WAI-ARIA requires exactly one tabbable item in a roving group at all times.
  // A dynamic list that shrinks below focusIndex (End on four items, then the
  // list filters down to two) would otherwise leave the index pointing past the
  // last item, every item at tabindex="-1", and the whole widget silently out
  // of the tab order. Clamping happens on READ rather than on write because the
  // count can shrink without anyone calling into the hook, and reading
  // getCount() here is what makes a signal-backed count re-run the tabIndex
  // effects. The stored index is left alone so a list that filters and then
  // restores puts the user back where they were.
  function clampIndex(index, count) {
    if (!(count > 0)) return 0;
    if (index < 0) return 0;
    if (index > count - 1) return count - 1;
    return index;
  }

  function activeIndex() {
    return clampIndex(focusIndex(), getCount());
  }

  // Out-of-range indexes handed in from application code are REFUSED rather
  // than clamped. focusItem(99) used to write 99 into the signal and return
  // null: no item matched, so every item went to tabindex="-1" and the widget
  // dropped out of the tab order entirely. Clamping instead would move focus
  // somewhere the caller never asked for, which is a worse surprise than
  // ignoring an index that does not exist.
  function isValidIndex(i) {
    return Number.isInteger(i) && i >= 0 && i < getCount();
  }

  function handleKeyDown(e) {
    const count = getCount();
    if (count <= 0) return;
    const current = clampIndex(focusIndex.peek(), count);
    let next = current;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = (current + 1) % count;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        next = (current - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    focusIndex.set(next);
    focusItemElement(next);
  }

  return {
    focusIndex: () => activeIndex(),
    // Follows focus only when the group already owns it, so syncing the index
    // from application state cannot steal focus from elsewhere on the page.
    // Use focusItem() when moving focus is the intent.
    setFocusIndex: (i) => {
      if (!isValidIndex(i)) return;
      focusIndex.set(i);
      if (groupHasFocus()) focusItemElement(i);
    },
    // Explicitly move focus to an item, e.g. a menu focusing its first item on
    // open. Returns the element it focused, or null when the index is out of
    // range or the item is not in the DOM.
    focusItem: (i) => {
      if (!isValidIndex(i)) return null;
      focusIndex.set(i);
      return focusItemElement(i);
    },
    // `overrides` are spread last and win, except for `ref`, which is chained
    // (see refFor) because this hook needs the node to move focus at all.
    getItemProps: (index, overrides) => {
      const { ref: callerRef, ...rest } = overrides || {};
      callerRefs[index] = callerRef || null;
      return {
        ref: refFor(index),
        // Accessor, not a snapshot: exactly one item is tabbable at a time and
        // which one has to change as focus roves. See the ariaBool note above
        // for why a resolved value cannot survive a spread.
        tabIndex: () => (activeIndex() === index ? 0 : -1),
        onKeyDown: handleKeyDown,
        // The ref is the registration; this is a free corrective for it. A call
        // site that spreads its own ref AFTER getItemProps() replaces ours, and
        // an element reporting its own focus event is first-hand evidence of
        // which node index `index` rendered to.
        onFocus: (e) => {
          const el = e && (e.currentTarget || e.target);
          if (el) itemEls[index] = el;
          focusIndex.set(index);
        },
        ...rest,
      };
    },
    containerProps: (overrides) => (
      configuredRole ? { role: configuredRole, ...overrides } : { ...overrides }
    ),
  };
}

// --- Visually Hidden ---
// Hide content visually but keep accessible to screen readers

export function VisuallyHidden({ children, as = 'span' }) {
  return h(as, {
    style: {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    },
  }, children);
}

// --- Live Region Component ---

export function LiveRegion({ children, priority = 'polite', atomic = true }) {
  return h('div', {
    'aria-live': priority,
    'aria-atomic': atomic,
  }, children);
}

// --- ID Generator ---
// Generate unique IDs for ARIA attributes

// The counter is render-scoped on the server and module-global on the client.
//
// A bare module-global counter is wrong on the server in two independent ways.
// Ids drift between the SSR pass and hydration, which breaks exactly the
// relationships useId exists to create (`for`/`id`, `aria-labelledby`,
// `aria-describedby`), and concurrent requests interleave into each other's
// sequence, so two visitors can be served HTML whose ids were allocated in the
// order the event loop happened to run. Every framework in the cohort ships this
// primitive as SSR-stable because that is the whole point of shipping it.
//
// getServerContext() is the render-scoped store the SSR keystone already
// maintains (AsyncLocalStorage-backed in Node), so this is wiring rather than
// new machinery, and it adds no public API.
let idCounter = 0;

function nextIdSuffix() {
  const ctx = getServerContext();
  if (ctx) {
    ctx.idCounter = (ctx.idCounter || 0) + 1;
    return ctx.idCounter;
  }
  return ++idCounter;
}

/**
 * Reset the client-side counter. Called at the start of hydration so the client
 * reproduces the server's id sequence instead of continuing past it.
 * @internal
 */
export function __resetIdCounter() {
  idCounter = 0;
}

export function useId(prefix = 'what') {
  const id = `${prefix}-${nextIdSuffix()}`;
  return () => id;
}

export function useIds(count, prefix = 'what') {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}-${nextIdSuffix()}`);
  }
  return ids;
}

// --- Describe ---
// Associate description with an element

export function useDescribedBy(description) {
  const id = useId('desc');

  return {
    descriptionId: id,
    descriptionProps: () => ({
      id: id(),
      style: { display: 'none' },
    }),
    describedByProps: () => ({
      'aria-describedby': id(),
    }),
    Description: () => h('div', {
      id: id(),
      style: { display: 'none' },
    }, description),
  };
}

// --- Labelledby ---

export function useLabelledBy(_label) {
  const id = useId('label');

  return {
    labelId: id,
    labelProps: () => ({
      id: id(),
    }),
    labelledByProps: () => ({
      'aria-labelledby': id(),
    }),
  };
}

// --- Keyboard Navigation Helpers ---

export const Keys = {
  Enter: 'Enter',
  Space: ' ',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  Tab: 'Tab',
};

export function onKey(key, handler) {
  return (e) => {
    if (e.key === key) {
      handler(e);
    }
  };
}

export function onKeys(keys, handler) {
  return (e) => {
    if (keys.includes(e.key)) {
      handler(e);
    }
  };
}
