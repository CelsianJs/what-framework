// packages/server/src/actions.js
import { signal, batch } from "what-core";
var actionRegistry = /* @__PURE__ */ new Map();
function getCsrfToken() {
  if (typeof document !== "undefined") {
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) {
      return meta.getAttribute("content");
    }
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}
function generateCsrfToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("[what] No secure random source available for CSRF token generation");
}
function validateCsrfToken(requestToken, sessionToken) {
  if (!requestToken || !sessionToken) return false;
  if (requestToken.length !== sessionToken.length) return false;
  let result = 0;
  for (let i = 0; i < requestToken.length; i++) {
    result |= requestToken.charCodeAt(i) ^ sessionToken.charCodeAt(i);
  }
  return result === 0;
}
function csrfMetaTag(token) {
  const escaped = String(token).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<meta name="what-csrf-token" content="${escaped}">`;
}
function generateActionId() {
  const rand = typeof crypto !== "undefined" && crypto.getRandomValues ? Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("") : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `a_${rand}`;
}
function action(fn, options = {}) {
  const id = options.id || generateActionId();
  const { onError, onSuccess, revalidate } = options;
  if (typeof window === "undefined") {
    actionRegistry.set(id, { fn, options });
  }
  async function callAction(...args) {
    if (typeof window === "undefined") {
      return fn(...args);
    }
    const timeout = options.timeout || 3e4;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const csrfToken = getCsrfToken();
      const headers = {
        "Content-Type": "application/json",
        "X-What-Action": id
      };
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const response = await fetch("/__what_action", {
        method: "POST",
        headers,
        credentials: "same-origin",
        signal: controller.signal,
        body: JSON.stringify({ args })
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: "Action failed" }));
        throw new Error(error.message || "Action failed");
      }
      const result = await response.json();
      if (onSuccess) onSuccess(result);
      if (revalidate) {
        for (const path of revalidate) {
          invalidatePath(path);
        }
      }
      return result;
    } catch (error) {
      if (error.name === "AbortError") {
        const timeoutError = new Error(`Action "${id}" timed out after ${timeout}ms`);
        timeoutError.code = "TIMEOUT";
        if (onError) onError(timeoutError);
        throw timeoutError;
      }
      if (onError) onError(error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
  callAction._actionId = id;
  callAction._isAction = true;
  return callAction;
}
function formAction(actionFn, options = {}) {
  const { onSuccess, onError, resetOnSuccess = true } = options;
  return async (formDataOrEvent) => {
    let formData;
    let form;
    if (formDataOrEvent instanceof Event) {
      formDataOrEvent.preventDefault();
      form = formDataOrEvent.target;
      formData = new FormData(form);
    } else {
      formData = formDataOrEvent;
    }
    const data = {};
    let hasFiles = false;
    for (const [key, value] of formData.entries()) {
      if (typeof File !== "undefined" && value instanceof File) {
        hasFiles = true;
      }
      if (data[key]) {
        if (Array.isArray(data[key])) {
          data[key].push(value);
        } else {
          data[key] = [data[key], value];
        }
      } else {
        data[key] = value;
      }
    }
    try {
      const result = hasFiles ? await actionFn(data, formData) : await actionFn(data);
      if (onSuccess) onSuccess(result, form);
      if (resetOnSuccess && form) form.reset();
      return result;
    } catch (error) {
      if (onError) onError(error, form);
      throw error;
    }
  };
}
function useAction(actionFn) {
  const isPending = signal(false);
  const error = signal(null);
  const data = signal(null);
  async function trigger(...args) {
    isPending.set(true);
    error.set(null);
    try {
      const result = await actionFn(...args);
      data.set(result);
      return result;
    } catch (e) {
      error.set(e);
      throw e;
    } finally {
      isPending.set(false);
    }
  }
  return {
    trigger,
    isPending: () => isPending(),
    error: () => error(),
    data: () => data(),
    reset: () => {
      error.set(null);
      data.set(null);
    }
  };
}
function useFormAction(actionFn, options = {}) {
  const { resetOnSuccess = true } = options;
  const formRef = { current: null };
  const actionState = useAction(formAction(actionFn, { resetOnSuccess }));
  function handleSubmit(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    formRef.current = e.target;
    return actionState.trigger(formData);
  }
  return {
    ...actionState,
    handleSubmit,
    formRef
  };
}
function useOptimistic(initialValue, reducer) {
  const value = signal(initialValue);
  const pending = signal([]);
  const baseValue = signal(initialValue);
  function addOptimistic(action2) {
    const optimisticValue = reducer(value.peek(), action2);
    batch(() => {
      pending.set([...pending.peek(), action2]);
      value.set(optimisticValue);
    });
  }
  function resolve(action2, serverValue) {
    batch(() => {
      pending.set(pending.peek().filter((a) => a !== action2));
      if (serverValue !== void 0) {
        baseValue.set(serverValue);
        let current = serverValue;
        for (const a of pending.peek()) {
          current = reducer(current, a);
        }
        value.set(current);
      }
    });
  }
  function rollback(action2, realValue) {
    batch(() => {
      const newPending = pending.peek().filter((a) => a !== action2);
      pending.set(newPending);
      const base = realValue !== void 0 ? realValue : baseValue.peek();
      baseValue.set(base);
      let current = base;
      for (const a of newPending) {
        current = reducer(current, a);
      }
      value.set(current);
    });
  }
  async function withOptimistic(action2, asyncFn) {
    addOptimistic(action2);
    try {
      const result = await asyncFn();
      resolve(action2, result);
      return result;
    } catch (e) {
      rollback(action2);
      throw e;
    }
  }
  return {
    value: () => value(),
    isPending: () => pending().length > 0,
    addOptimistic,
    resolve,
    rollback,
    withOptimistic,
    set: (v) => {
      value.set(v);
      baseValue.set(v);
    }
  };
}
var revalidationCallbacks = /* @__PURE__ */ new Map();
function onRevalidate(path, callback) {
  if (!revalidationCallbacks.has(path)) {
    revalidationCallbacks.set(path, /* @__PURE__ */ new Set());
  }
  revalidationCallbacks.get(path).add(callback);
  return () => {
    revalidationCallbacks.get(path)?.delete(callback);
  };
}
function invalidatePath(path) {
  const callbacks = revalidationCallbacks.get(path);
  if (callbacks) {
    for (const cb of callbacks) {
      try {
        cb();
      } catch (e) {
        console.error("[what] Revalidation error:", e);
      }
    }
  }
}
function handleActionRequest(req, actionId, args, options = {}) {
  const { csrfToken: sessionCsrfToken, skipCsrf = false } = options;
  if (!skipCsrf) {
    if (!sessionCsrfToken) {
      return Promise.resolve({
        status: 500,
        body: {
          message: "[what] CSRF token not configured. Pass { csrfToken: sessionToken } to handleActionRequest, or { skipCsrf: true } to explicitly opt out."
        }
      });
    }
    const requestCsrfToken = req?.headers?.["x-csrf-token"] || req?.headers?.["X-CSRF-Token"];
    if (!validateCsrfToken(requestCsrfToken, sessionCsrfToken)) {
      return Promise.resolve({ status: 403, body: { message: "Invalid CSRF token" } });
    }
  }
  const action2 = actionRegistry.get(actionId);
  if (!action2) {
    return Promise.resolve({ status: 404, body: { message: "Action not found" } });
  }
  if (!Array.isArray(args)) {
    return Promise.resolve({ status: 400, body: { message: "Invalid action arguments" } });
  }
  return action2.fn(...args).then((result) => ({ status: 200, body: result })).catch((error) => {
    console.error(`[what] Action "${actionId}" error:`, error);
    return {
      status: 500,
      body: { message: "Action failed" }
    };
  });
}
function getRegisteredActions() {
  return [...actionRegistry.keys()];
}
function useMutation(mutationFn, options = {}) {
  const { onSuccess, onError, onSettled } = options;
  const state = {
    isPending: signal(false),
    error: signal(null),
    data: signal(null)
  };
  async function mutate(...args) {
    state.isPending.set(true);
    state.error.set(null);
    try {
      const result = await mutationFn(...args);
      state.data.set(result);
      if (onSuccess) onSuccess(result, ...args);
      return result;
    } catch (error) {
      state.error.set(error);
      if (onError) onError(error, ...args);
      throw error;
    } finally {
      state.isPending.set(false);
      if (onSettled) onSettled(state.data.peek(), state.error.peek(), ...args);
    }
  }
  return {
    mutate,
    isPending: () => state.isPending(),
    error: () => state.error(),
    data: () => state.data(),
    reset: () => {
      state.error.set(null);
      state.data.set(null);
    }
  };
}
export {
  action,
  csrfMetaTag,
  formAction,
  generateCsrfToken,
  getRegisteredActions,
  handleActionRequest,
  invalidatePath,
  onRevalidate,
  useAction,
  useFormAction,
  useMutation,
  useOptimistic,
  validateCsrfToken
};
//# sourceMappingURL=actions.js.map
