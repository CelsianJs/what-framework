import {
  createRoot,
  effect,
  flushSync,
  mount,
  signal
} from "./chunk-AW3BAPIK.js";
import {
  h
} from "./chunk-AZP2EOGX.js";

// packages/core/src/testing.js
var container = null;
function setupDOM() {
  if (typeof document !== "undefined") {
    container = document.createElement("div");
    container.id = "test-root";
    document.body.appendChild(container);
  }
  return container;
}
function cleanup() {
  if (container) {
    container.innerHTML = "";
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
    container = null;
  }
}
function render(vnode, options = {}) {
  const { container: customContainer } = options;
  const target = customContainer || setupDOM();
  if (!target) {
    throw new Error("No DOM container available. Are you running in Node.js without jsdom?");
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
    findByTestId: (id, timeout) => waitFor(() => target.querySelector(`[data-testid="${id}"]`), { timeout })
  };
}
function renderTest(Component, props) {
  const target = setupDOM();
  if (!target) {
    throw new Error("No DOM container available. Are you running in Node.js without jsdom?");
  }
  const signalRegistry = {};
  let rootDispose = null;
  let unmountFn;
  createRoot((dispose) => {
    rootDispose = dispose;
    const vnode = h(Component, props || {});
    unmountFn = mount(vnode, target);
  });
  return {
    container: target,
    // Proxy to access component signals by name
    signals: new Proxy(signalRegistry, {
      get(obj, prop) {
        if (prop in obj) return obj[prop];
        return void 0;
      },
      set(obj, prop, value) {
        obj[prop] = value;
        return true;
      }
    }),
    // Synchronous flush: run all pending effects immediately
    update() {
      flushSync();
    },
    unmount() {
      if (unmountFn) unmountFn();
      if (rootDispose) rootDispose();
      cleanup();
    },
    // Query helpers
    getByText: (text) => queryByText(target, text),
    getByTestId: (id) => target.querySelector(`[data-testid="${id}"]`),
    queryByText: (text) => queryByText(target, text),
    debug: () => console.log(target.innerHTML)
  };
}
function flushEffects() {
  flushSync();
}
function trackSignals(fn) {
  const accessed = [];
  const written = [];
  const _origSignal = signal;
  const trackedSignals = /* @__PURE__ */ new Map();
  const trackRead = (name) => {
    if (!accessed.includes(name)) accessed.push(name);
  };
  const trackWrite = (name) => {
    if (!written.includes(name)) written.push(name);
  };
  let dispose;
  createRoot((d) => {
    dispose = d;
    const e = effect(() => {
      fn();
    });
  });
  if (dispose) dispose();
  return { accessed, written };
}
function mockSignal(name, initialValue) {
  const history = [initialValue];
  let setCount = 0;
  const s = signal(initialValue, name);
  const origSet = s.set;
  s.set = function(next) {
    const nextVal = typeof next === "function" ? next(s.peek()) : next;
    if (!Object.is(s.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origSet(nextVal);
  };
  const origFn = s;
  const mock = function(...args) {
    if (args.length === 0) {
      return origFn();
    }
    const nextVal = typeof args[0] === "function" ? args[0](origFn.peek()) : args[0];
    if (!Object.is(origFn.peek(), nextVal)) {
      setCount++;
      history.push(nextVal);
    }
    return origFn(nextVal);
  };
  mock._signal = true;
  mock.peek = s.peek;
  mock.set = s.set;
  mock.subscribe = s.subscribe;
  if (s._debugName) mock._debugName = s._debugName;
  if (s._subs) mock._subs = s._subs;
  Object.defineProperty(mock, "history", {
    get() {
      return history;
    }
  });
  Object.defineProperty(mock, "setCount", {
    get() {
      return setCount;
    }
  });
  mock.reset = function(value) {
    const resetVal = value !== void 0 ? value : initialValue;
    history.length = 0;
    history.push(resetVal);
    setCount = 0;
    origFn(resetVal);
  };
  return mock;
}
function queryByText(container2, text) {
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container2,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex ? regex.test(node.textContent) : node.textContent.includes(text);
    if (matches) {
      return node.parentElement;
    }
  }
  return null;
}
function queryAllByText(container2, text) {
  const results = [];
  const regex = text instanceof RegExp ? text : null;
  const walker = document.createTreeWalker(
    container2,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const matches = regex ? regex.test(node.textContent) : node.textContent.includes(text);
    if (matches) {
      results.push(node.parentElement);
    }
  }
  return results;
}
var fireEvent = {
  click(element) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: typeof window !== "undefined" ? window : void 0
    });
    element.dispatchEvent(event);
    return event;
  },
  change(element, value) {
    element.value = value;
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
    const changeEvent = new Event("change", { bubbles: true });
    element.dispatchEvent(changeEvent);
    return changeEvent;
  },
  input(element, value) {
    element.value = value;
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  submit(element) {
    const event = new Event("submit", { bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return event;
  },
  focus(element) {
    element.focus();
    const event = new FocusEvent("focus", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  blur(element) {
    element.blur();
    const event = new FocusEvent("blur", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  keyDown(element, key, options = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options
    });
    element.dispatchEvent(event);
    return event;
  },
  keyUp(element, key, options = {}) {
    const event = new KeyboardEvent("keyup", {
      bubbles: true,
      cancelable: true,
      key,
      ...options
    });
    element.dispatchEvent(event);
    return event;
  },
  mouseEnter(element) {
    const event = new MouseEvent("mouseenter", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  },
  mouseLeave(element) {
    const event = new MouseEvent("mouseleave", { bubbles: true });
    element.dispatchEvent(event);
    return event;
  }
};
async function waitFor(callback, options = {}) {
  const { timeout = 1e3, interval = 50 } = options;
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const result = callback();
      if (result) return result;
    } catch (e) {
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}
async function waitForElementToBeRemoved(callback, options = {}) {
  const { timeout = 1e3, interval = 50 } = options;
  const startTime = Date.now();
  let element = callback();
  if (!element) {
    throw new Error("Element not found");
  }
  while (Date.now() - startTime < timeout) {
    element = callback();
    if (!element) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`Element still present after ${timeout}ms`);
}
async function act(callback) {
  const result = await callback();
  flushSync();
  await new Promise((r) => queueMicrotask(r));
  await new Promise((r) => setTimeout(r, 0));
  return result;
}
function createTestSignal(initial) {
  const s = signal(initial);
  const history = [initial];
  effect(() => {
    history.push(s());
  });
  return {
    signal: s,
    get value() {
      return s();
    },
    set value(v) {
      s.set(v);
    },
    history,
    reset() {
      history.length = 0;
      history.push(s());
    }
  };
}
function mockComponent(name = "MockComponent") {
  const calls = [];
  function Mock(props) {
    calls.push({ props, timestamp: Date.now() });
    return h(
      "div",
      { "data-testid": `mock-${name}` },
      JSON.stringify(props, null, 2)
    );
  }
  Mock.displayName = name;
  Mock.calls = calls;
  Mock.lastCall = () => calls[calls.length - 1];
  Mock.reset = () => {
    calls.length = 0;
  };
  return Mock;
}
var expect = {
  toBeInTheDocument(element) {
    if (!element || !element.parentNode) {
      throw new Error("Expected element to be in the document");
    }
  },
  toHaveTextContent(element, text) {
    if (!element) {
      throw new Error("Element not found");
    }
    const content = element.textContent;
    const matches = text instanceof RegExp ? text.test(content) : content.includes(text);
    if (!matches) {
      throw new Error(`Expected "${content}" to contain "${text}"`);
    }
  },
  toHaveAttribute(element, attr, value) {
    if (!element) {
      throw new Error("Element not found");
    }
    const attrValue = element.getAttribute(attr);
    if (value !== void 0 && attrValue !== value) {
      throw new Error(`Expected attribute "${attr}" to be "${value}", got "${attrValue}"`);
    }
    if (value === void 0 && attrValue === null) {
      throw new Error(`Expected element to have attribute "${attr}"`);
    }
  },
  toHaveClass(element, className) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (!element.classList.contains(className)) {
      throw new Error(`Expected element to have class "${className}"`);
    }
  },
  toBeVisible(element) {
    if (!element) {
      throw new Error("Element not found");
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      throw new Error("Expected element to be visible");
    }
  },
  toBeDisabled(element) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (!element.disabled) {
      throw new Error("Expected element to be disabled");
    }
  },
  toHaveValue(element, value) {
    if (!element) {
      throw new Error("Element not found");
    }
    if (element.value !== value) {
      throw new Error(`Expected value to be "${value}", got "${element.value}"`);
    }
  }
};
var screen = {
  getByText: (text) => queryByText(document.body, text),
  getByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  getByRole: (role) => document.querySelector(`[role="${role}"]`),
  getAllByText: (text) => queryAllByText(document.body, text),
  queryByText: (text) => queryByText(document.body, text),
  queryByTestId: (id) => document.querySelector(`[data-testid="${id}"]`),
  debug: () => console.log(document.body.innerHTML)
};
export {
  act,
  cleanup,
  createTestSignal,
  expect,
  fireEvent,
  flushEffects,
  mockComponent,
  mockSignal,
  render,
  renderTest,
  screen,
  setupDOM,
  trackSignals,
  waitFor,
  waitForElementToBeRemoved
};
//# sourceMappingURL=testing.js.map
