// What Framework - Server Actions
// Call server-side functions from client code seamlessly.
// Similar to Next.js Server Actions / SolidStart server functions.
//
// Usage:
//   // Define on server
//   const saveUser = action(async (formData) => {
//     'use server';
//     const user = await db.users.create(formData);
//     return { success: true, id: user.id };
//   });
//
//   // Call from client
//   const result = await saveUser({ name: 'John' });

import { signal, batch } from 'what-core';

// Registry of server actions
const actionRegistry = new Map();
let actionIdCounter = 0;

// --- CSRF Protection ---
// Server generates a token per session; client sends it with every action request.
// The token is injected into the page via a meta tag or embedded in the server response.

// Client: read the CSRF token from the page meta tag or cookie
// Re-reads on every call to handle token rotation
function getCsrfToken() {
  if (typeof document !== 'undefined') {
    // Try meta tag first
    const meta = document.querySelector('meta[name="what-csrf-token"]');
    if (meta) {
      return meta.getAttribute('content');
    }
    // Try cookie
    const match = document.cookie.match(/(?:^|;\s*)what-csrf=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }
  return null;
}

// Server: generate a CSRF token (call this per session/request)
export function generateCsrfToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Server: validate CSRF token from request header against session token
export function validateCsrfToken(requestToken, sessionToken) {
  if (!requestToken || !sessionToken) return false;
  // Constant-time comparison to prevent timing attacks
  if (requestToken.length !== sessionToken.length) return false;
  let result = 0;
  for (let i = 0; i < requestToken.length; i++) {
    result |= requestToken.charCodeAt(i) ^ sessionToken.charCodeAt(i);
  }
  return result === 0;
}

// Server: middleware helper to inject CSRF meta tag into HTML
export function csrfMetaTag(token) {
  // HTML-escape the token to prevent XSS if a non-standard value is used
  const escaped = String(token).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<meta name="what-csrf-token" content="${escaped}">`;
}

// --- Define a server action ---

function generateActionId() {
  // Generate a random ID that's not easily enumerable
  const rand = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('')
    : Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `a_${rand}`;
}

export function action(fn, options = {}) {
  const id = options.id || generateActionId();
  const { onError, onSuccess, revalidate } = options;

  // Server-side: register the action
  if (typeof window === 'undefined') {
    actionRegistry.set(id, { fn, options });
  }

  // Create the callable wrapper
  async function callAction(...args) {
    // Server-side: call directly
    if (typeof window === 'undefined') {
      return fn(...args);
    }

    // Client-side: call via fetch with timeout support
    const timeout = options.timeout || 30000; // Default 30s timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const csrfToken = getCsrfToken();
      const headers = {
        'Content-Type': 'application/json',
        'X-What-Action': id,
      };
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

      const response = await fetch('/__what_action', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        signal: controller.signal,
        body: JSON.stringify({ args }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Action failed' }));
        throw new Error(error.message || 'Action failed');
      }

      const result = await response.json();

      if (onSuccess) onSuccess(result);
      if (revalidate) {
        // Trigger revalidation of specified paths
        for (const path of revalidate) {
          invalidatePath(path);
        }
      }

      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Action "${id}" timed out after ${timeout}ms`);
        timeoutError.code = 'TIMEOUT';
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

// --- Form action helper ---
// For forms that submit to server actions.

export function formAction(actionFn, options = {}) {
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

    // Convert FormData to plain object
    const data = {};
    for (const [key, value] of formData.entries()) {
      if (data[key]) {
        // Handle multiple values (e.g., checkboxes)
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
      const result = await actionFn(data);
      if (onSuccess) onSuccess(result, form);
      if (resetOnSuccess && form) form.reset();
      return result;
    } catch (error) {
      if (onError) onError(error, form);
      throw error;
    }
  };
}

// --- useAction hook ---
// Returns action state and trigger function.

export function useAction(actionFn) {
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
    },
  };
}

// --- useFormAction hook ---
// Combines useAction with form handling.

export function useFormAction(actionFn, options = {}) {
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
    formRef,
  };
}

// --- Optimistic updates ---

export function useOptimistic(initialValue, reducer) {
  const value = signal(initialValue);
  const pending = signal([]);
  const baseValue = signal(initialValue); // Track the confirmed server value

  function addOptimistic(action) {
    const optimisticValue = reducer(value.peek(), action);
    batch(() => {
      pending.set([...pending.peek(), action]);
      value.set(optimisticValue);
    });
  }

  function resolve(action, serverValue) {
    batch(() => {
      pending.set(pending.peek().filter(a => a !== action));
      if (serverValue !== undefined) {
        baseValue.set(serverValue);
        // Recompute optimistic state from new base + remaining pending actions
        let current = serverValue;
        for (const a of pending.peek()) {
          current = reducer(current, a);
        }
        value.set(current);
      }
    });
  }

  function rollback(action, realValue) {
    batch(() => {
      const newPending = pending.peek().filter(a => a !== action);
      pending.set(newPending);
      const base = realValue !== undefined ? realValue : baseValue.peek();
      baseValue.set(base);
      // Recompute from base + remaining pending actions
      let current = base;
      for (const a of newPending) {
        current = reducer(current, a);
      }
      value.set(current);
    });
  }

  // Auto-rollback helper: wraps an async action with automatic rollback on error
  async function withOptimistic(action, asyncFn) {
    addOptimistic(action);
    try {
      const result = await asyncFn();
      resolve(action, result);
      return result;
    } catch (e) {
      rollback(action);
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
    set: (v) => { value.set(v); baseValue.set(v); },
  };
}

// --- Path revalidation ---

const revalidationCallbacks = new Map();

export function onRevalidate(path, callback) {
  if (!revalidationCallbacks.has(path)) {
    revalidationCallbacks.set(path, new Set());
  }
  revalidationCallbacks.get(path).add(callback);

  return () => {
    revalidationCallbacks.get(path)?.delete(callback);
  };
}

export function invalidatePath(path) {
  const callbacks = revalidationCallbacks.get(path);
  if (callbacks) {
    for (const cb of callbacks) {
      try { cb(); } catch (e) { console.error('[what] Revalidation error:', e); }
    }
  }
}

// --- Server-side action handler ---
// Add this to your server middleware.

export function handleActionRequest(req, actionId, args, options = {}) {
  const { csrfToken: sessionCsrfToken, skipCsrf = false } = options;

  // Validate CSRF token unless explicitly skipped
  if (!skipCsrf) {
    if (!sessionCsrfToken) {
      // Fail closed: no CSRF token configured means the developer forgot to set it up.
      // This prevents silent security vulnerabilities in production.
      return Promise.resolve({
        status: 500,
        body: {
          message: '[what] CSRF token not configured. ' +
            'Pass { csrfToken: sessionToken } to handleActionRequest, ' +
            'or { skipCsrf: true } to explicitly opt out.'
        }
      });
    }
    const requestCsrfToken = req?.headers?.['x-csrf-token'] || req?.headers?.['X-CSRF-Token'];
    if (!validateCsrfToken(requestCsrfToken, sessionCsrfToken)) {
      return Promise.resolve({ status: 403, body: { message: 'Invalid CSRF token' } });
    }
  }

  const action = actionRegistry.get(actionId);
  if (!action) {
    return Promise.resolve({ status: 404, body: { message: 'Action not found' } });
  }

  // Validate args is an array to prevent prototype pollution
  if (!Array.isArray(args)) {
    return Promise.resolve({ status: 400, body: { message: 'Invalid action arguments' } });
  }

  return action.fn(...args)
    .then(result => ({ status: 200, body: result }))
    .catch(error => {
      // Log the full error server-side, return generic message to client
      console.error(`[what] Action "${actionId}" error:`, error);
      return {
        status: 500,
        body: { message: 'Action failed' },
      };
    });
}

// --- Get all registered actions (for SSR/build) ---

export function getRegisteredActions() {
  return [...actionRegistry.keys()];
}

// --- Mutation helper ---
// Like useSWR mutation but simpler.

export function useMutation(mutationFn, options = {}) {
  const { onSuccess, onError, onSettled } = options;

  const state = {
    isPending: signal(false),
    error: signal(null),
    data: signal(null),
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
    },
  };
}
