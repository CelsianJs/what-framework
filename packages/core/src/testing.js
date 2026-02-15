// What Framework - Testing Utilities
// Helpers for testing components, similar to @testing-library/react
// Works with Node.js test runner or any test framework

import { mount, h, signal, batch, effect } from './index.js';

// Minimal DOM implementation for Node.js
let container = null;

// --- Setup and Cleanup ---

export function setupDOM() {
  if (typeof document !== 'undefined') {
    // Browser environment
    container = document.createElement('div');
    container.id = 'test-root';
    document.body.appendChild(container);
  }
  return container;
}

export function cleanup() {
  if (container) {
    container.innerHTML = '';
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }
}

// --- Render ---

export function render(vnode, options = {}) {
  const { container: customContainer } = options;
  const target = customContainer || setupDOM();

  if (!target) {
    throw new Error('No DOM container available. Are you running in Node.js without jsdom?');
  }

  const unmount = mount(vnode, target);

  return {
    container: target,
    unmount,
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    getByRole: (role) => target.querySelector(`[role="${role}"]`),
    getAllByText: (text) => queryAllByText(target, text),
    queryByText: (text) => queryByText(target, text),
    queryByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    // Debug
    debug: () => console.log(target.innerHTML),
    // Async utilities
    findByText: (text, timeout) => waitFor(() => queryByText(target, text), { timeout }),
    findByTestId: (id, timeout) => waitFor(() => target.querySelector(`[data-testid="${id}"]`), { timeout }),
  };
}

// --- Query Helpers ---

function queryByText(container, text) {
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex
      ? regex.test(node.textContent)
      : node.textContent.includes(text);
    if (matches) {
      return node.parentElement;
    }
  }
  return null;
}

function queryAllByText(container, text) {
  const results = [];
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex
      ? regex.test(node.textContent)
      : node.textContent.includes(text);
    if (matches) {
      results.push(node.parentElement);
    }
  }
  return results;
}

// --- Fire Events ---

export const fireEvent = {
  click(element) {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: typeof window !== 'undefined' ? window : undefined,
    });
    element.dispatchEvent(event);
    return event;
  },

  change(element, value) {
    element.value = value;
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
    return changeEvent;
  },

  input(element, value) {
    element.value = value;
    const event = new Event('input', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  submit(element) {
    const event = new Event('submit', { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  },

  focus(element) {
    element.focus();
    const event = new FocusEvent('focus', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  blur(element) {
    element.blur();
    const event = new FocusEvent('blur', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  keyDown(element, key, options = {}) {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    element.dispatchEvent(event);
    return event;
  },

  keyUp(element, key, options = {}) {
    const event = new KeyboardEvent('keyup', {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    element.dispatchEvent(event);
    return event;
  },

  mouseEnter(element) {
    const event = new MouseEvent('mouseenter', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },

  mouseLeave(element) {
    const event = new MouseEvent('mouseleave', { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
};

// --- Wait Utilities ---

export async function waitFor(callback, options = {}) {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = callback();
      if (result) return result;
    } catch (e) {
      // Keep waiting
    }
    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

export async function waitForElementToBeRemoved(callback, options = {}) {
  const { timeout = 1000, interval = 50 } = options;
  const startTime = Date.now();

  // First, element should exist
  let element = callback();
  if (!element) {
    throw new Error('Element not found');
  }

  // Then wait for it to be removed
  while (Date.now() - startTime < timeout) {
    element = callback();
    if (!element) return;
    await new Promise(r => setTimeout(r, interval));
  }

  throw new Error(`Element still present after ${timeout}ms`);
}

// --- Act ---
// Ensure all effects and updates are flushed

export async function act(callback) {
  const result = await callback();
  // Wait for microtasks to flush
  await new Promise(r => queueMicrotask(r));
  // Wait for any scheduled effects
  await new Promise(r => setTimeout(r, 0));
  return result;
}

// --- Signal Testing Helpers ---

export function createTestSignal(initial) {
  const s = signal(initial);
  const history = [initial];

  // Track all changes
  effect(() => {
    history.push(s());
  });

  return {
    signal: s,
    get value() { return s(); },
    set value(v) { s.set(v); },
    history,
    reset() {
      history.length = 0;
      history.push(s());
    },
  };
}

// --- Mocking ---

export function mockComponent(name = 'MockComponent') {
  const calls = [];

  function Mock(props) {
    calls.push({ props, timestamp: Date.now() });
    return h('div', { 'data-testid': `mock-${name}` },
      JSON.stringify(props, null, 2)
    );
  }

  Mock.displayName = name;
  Mock.calls = calls;
  Mock.lastCall = () => calls[calls.length - 1];
  Mock.reset = () => { calls.length = 0; };

  return Mock;
}

// --- Assertions ---

export const expect = {
  toBeInTheDocument(element) {
    if (!element || !element.parentNode) {
      throw new Error('Expected element to be in the document');
    }
  },

  toHaveTextContent(element, text) {
    if (!element) {
      throw new Error('Element not found');
    }
    const content = element.textContent;
    const matches = text instanceof RegExp ? text.test(content) : content.includes(text);
    if (!matches) {
      throw new Error(`Expected "${content}" to contain "${text}"`);
    }
  },

  toHaveAttribute(element, attr, value) {
    if (!element) {
      throw new Error('Element not found');
    }
    const attrValue = element.getAttribute(attr);
    if (value !== undefined && attrValue !== value) {
      throw new Error(`Expected attribute "${attr}" to be "${value}", got "${attrValue}"`);
    }
    if (value === undefined && attrValue === null) {
      throw new Error(`Expected element to have attribute "${attr}"`);
    }
  },

  toHaveClass(element, className) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (!element.classList.contains(className)) {
      throw new Error(`Expected element to have class "${className}"`);
    }
  },

  toBeVisible(element) {
    if (!element) {
      throw new Error('Element not found');
    }
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      throw new Error('Expected element to be visible');
    }
  },

  toBeDisabled(element) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (!element.disabled) {
      throw new Error('Expected element to be disabled');
    }
  },

  toHaveValue(element, value) {
    if (!element) {
      throw new Error('Element not found');
    }
    if (element.value !== value) {
      throw new Error(`Expected value to be "${value}", got "${element.value}"`);
    }
  },
};

// --- Screen ---
// Global query object for convenience

export const screen = {
  getByText: (text) => queryByText(document.body, text),
  getByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  getByRole: (role) => document.querySelector(`[role="${role}"]`),
  getAllByText: (text) => queryAllByText(document.body, text),
  queryByText: (text) => queryByText(document.body, text),
  queryByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  debug: () => console.log(document.body.innerHTML),
};
