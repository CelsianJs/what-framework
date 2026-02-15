// What Framework - Accessibility Utilities
// Focus management, ARIA helpers, screen reader announcements

import { signal, effect } from './reactive.js';
import { h } from './h.js';
import { getCurrentComponent } from './dom.js';

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
    blur: () => document.activeElement?.blur(),
  };
}

// --- Focus Trap ---
// Keep focus within a container (for modals, dialogs, etc.)

export function useFocusTrap(containerRef) {
  let previousFocus = null;

  function activate() {
    if (typeof document === 'undefined') return;

    previousFocus = document.activeElement;
    const container = containerRef.current || containerRef;

    if (!container) return;

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
  const trap = useFocusTrap(containerRef);

  // Scope the effect to the component lifecycle so it disposes on unmount
  const dispose = effect(() => {
    if (active) {
      const cleanup = trap.activate();
      return () => {
        cleanup?.();
        trap.deactivate();
      };
    }
  });

  // Register cleanup on component context
  const ctx = getCurrentComponent?.();
  if (ctx) {
    ctx._cleanupCallbacks = ctx._cleanupCallbacks || [];
    ctx._cleanupCallbacks.push(dispose);
  }

  return h('div', { ref: containerRef }, children);
}

// --- Screen Reader Announcements ---

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
      const target = document.querySelector(href);
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

export function useAriaExpanded(initialExpanded = false) {
  const expanded = signal(initialExpanded);

  return {
    expanded: () => expanded(),
    toggle: () => expanded.set(!expanded.peek()),
    open: () => expanded.set(true),
    close: () => expanded.set(false),
    buttonProps: () => ({
      'aria-expanded': expanded(),
      onClick: () => expanded.set(!expanded.peek()),
    }),
    panelProps: () => ({
      hidden: !expanded(),
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
      'aria-selected': selected() === value,
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
      'aria-checked': checked(),
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

export function useRovingTabIndex(itemCountOrSignal) {
  // Accept either a static number or a signal/getter for dynamic lists
  const getCount = typeof itemCountOrSignal === 'function'
    ? itemCountOrSignal
    : () => itemCountOrSignal;
  const focusIndex = signal(0);

  function handleKeyDown(e) {
    const count = getCount();
    if (count <= 0) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault();
        focusIndex.set((focusIndex.peek() + 1) % count);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault();
        focusIndex.set((focusIndex.peek() - 1 + count) % count);
        break;
      case 'Home':
        e.preventDefault();
        focusIndex.set(0);
        break;
      case 'End':
        e.preventDefault();
        focusIndex.set(count - 1);
        break;
    }
  }

  return {
    focusIndex: () => focusIndex(),
    setFocusIndex: (i) => focusIndex.set(i),
    getItemProps: (index) => ({
      tabIndex: focusIndex() === index ? 0 : -1,
      onKeyDown: handleKeyDown,
      onFocus: () => focusIndex.set(index),
    }),
    containerProps: () => ({
      role: 'listbox',
    }),
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

let idCounter = 0;

export function useId(prefix = 'what') {
  const id = `${prefix}-${++idCounter}`;
  return () => id;
}

export function useIds(count, prefix = 'what') {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(`${prefix}-${++idCounter}`);
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

export function useLabelledBy(label) {
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
